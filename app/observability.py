"""Request and SQL observability helpers.

This module deliberately records timings and aggregates only. SQL text,
parameters, credentials and request headers are never written to the logs.
"""

from __future__ import annotations

import contextvars
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional

from sqlalchemy import event
from sqlalchemy.pool import QueuePool


logger = logging.getLogger("catalog_api")

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_request_metrics: contextvars.ContextVar[Optional["RequestMetrics"]] = contextvars.ContextVar(
    "request_metrics",
    default=None,
)


def new_request_id(candidate: Optional[str] = None) -> str:
    """Return a short, log-safe request id."""
    value = str(candidate or "").strip()
    if value and _REQUEST_ID_RE.fullmatch(value):
        return value
    return uuid.uuid4().hex[:12]


@dataclass
class RequestMetrics:
    request_id: str
    method: str
    path: str
    query_count: int = 0
    sql_time_ms: float = 0.0
    pool_wait_ms: float = 0.0
    pool_connect_ms: float = 0.0
    pool_checkout_count: int = 0
    pool_checkin_count: int = 0
    pool_active: int = 0
    pool_overflow: int = 0


def begin_request_metrics(request_id: str, method: str, path: str):
    """Install request metrics in a context that SQLAlchemy event handlers can read."""
    return _request_metrics.set(RequestMetrics(request_id, method, path))


def reset_request_metrics(token) -> None:
    _request_metrics.reset(token)


def current_request_metrics() -> Optional[RequestMetrics]:
    return _request_metrics.get()


def _slow_sql_threshold_ms() -> float:
    try:
        return max(0.0, float(os.environ.get("SLOW_SQL_MS", "500")))
    except (TypeError, ValueError):
        return 500.0


def _safe_sql_shape(statement: Any) -> str:
    try:
        value = re.sub(r"'([^']|'')*'", "'?'", str(statement or ""))
        value = re.sub(r"\b\d+(?:\.\d+)?\b", "?", value)
        value = re.sub(r"\s+", " ", value).strip()
        return value[:600]
    except Exception:
        return "<unavailable>"


def _record_sql_duration(duration_ms: float, statement: Any = None) -> None:
    metrics = current_request_metrics()
    request_id = metrics.request_id if metrics else "-"
    endpoint = f"{metrics.method} {metrics.path}" if metrics else "background"
    if metrics:
        metrics.query_count += 1
        metrics.sql_time_ms += duration_ms

    if duration_ms >= _slow_sql_threshold_ms():
        if str(os.environ.get("SLOW_SQL_SHAPES") or "").strip().lower() in {"1", "true", "yes", "on"}:
            logger.warning(
                "[SLOW SQL][%s] endpoint=%s duration=%.1fms sql_shape=%s",
                request_id,
                endpoint,
                duration_ms,
                _safe_sql_shape(statement),
            )
        else:
            logger.warning(
                "[SLOW SQL][%s] endpoint=%s duration=%.1fms",
                request_id,
                endpoint,
                duration_ms,
            )


class InstrumentedQueuePool(QueuePool):
    """QueuePool variant that records acquisition versus connection creation time."""

    def _create_connection(self):
        started_ns = time.perf_counter_ns()
        record = super()._create_connection()
        try:
            record.info["_catalog_pool_created_at_ns"] = started_ns
            record.info["_catalog_pool_connect_ms"] = (time.perf_counter_ns() - started_ns) / 1_000_000.0
        except Exception:
            pass
        return record

    def _do_get(self):
        started_ns = time.perf_counter_ns()
        record = super()._do_get()
        try:
            total_ms = (time.perf_counter_ns() - started_ns) / 1_000_000.0
            created_at_ns = int(record.info.get("_catalog_pool_created_at_ns") or 0)
            connect_ms = 0.0
            if created_at_ns >= started_ns:
                connect_ms = float(record.info.get("_catalog_pool_connect_ms") or 0.0)
            record.info["_catalog_pool_last_acquire"] = {
                "total_ms": total_ms,
                "wait_ms": max(0.0, total_ms - connect_ms),
                "connect_ms": max(0.0, connect_ms),
            }
        except Exception:
            pass
        return record


def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    # Store timing on SQLAlchemy's execution context, not in a global, so
    # concurrent requests cannot overwrite one another.
    try:
        context._catalog_observability_started_ns = time.perf_counter_ns()
    except Exception:
        pass


def _after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    started_ns = getattr(context, "_catalog_observability_started_ns", None)
    if started_ns is None:
        return
    _record_sql_duration((time.perf_counter_ns() - started_ns) / 1_000_000.0, statement)


def _handle_sql_error(exception_context):
    context = getattr(exception_context, "execution_context", None)
    started_ns = getattr(context, "_catalog_observability_started_ns", None)
    if started_ns is not None:
        _record_sql_duration(
            (time.perf_counter_ns() - started_ns) / 1_000_000.0,
            getattr(context, "statement", None),
        )


def _record_pool_checkout(engine, connection_record) -> None:
    details = {}
    try:
        details = connection_record.info.pop("_catalog_pool_last_acquire", {}) or {}
    except Exception:
        details = {}
    wait_ms = float(details.get("wait_ms") or 0.0)
    connect_ms = float(details.get("connect_ms") or 0.0)
    metrics = current_request_metrics()
    if metrics is not None:
        metrics.pool_wait_ms += wait_ms
        metrics.pool_connect_ms += connect_ms
        metrics.pool_checkout_count += 1
        try:
            metrics.pool_active = int(engine.pool.checkedout())
            metrics.pool_overflow = max(0, int(engine.pool.overflow()))
        except Exception:
            pass
    try:
        threshold = max(0.0, float(os.environ.get("POOL_SLOW_WAIT_MS", "250")))
    except (TypeError, ValueError):
        threshold = 250.0
    if wait_ms >= threshold:
        request_id = metrics.request_id if metrics else "-"
        logger.warning(
            "[POOL WAIT][%s] wait=%.1fms connect=%.1fms active=%s overflow=%s",
            request_id,
            wait_ms,
            connect_ms,
            getattr(engine.pool, "checkedout", lambda: "?")(),
            max(0, int(getattr(engine.pool, "overflow", lambda: 0)())),
        )


def _record_pool_checkin(engine, connection_record) -> None:
    metrics = current_request_metrics()
    if metrics is not None:
        metrics.pool_checkin_count += 1
        try:
            metrics.pool_active = int(engine.pool.checkedout())
            metrics.pool_overflow = max(0, int(engine.pool.overflow()))
        except Exception:
            pass


def configure_sqlalchemy_instrumentation(engine) -> None:
    """Attach non-invasive SQL timing listeners once per SQLAlchemy engine."""
    if getattr(engine, "_catalog_observability_configured", False):
        return
    event.listen(engine, "before_cursor_execute", _before_cursor_execute)
    event.listen(engine, "after_cursor_execute", _after_cursor_execute)
    event.listen(engine, "handle_error", _handle_sql_error)
    event.listen(engine, "checkout", lambda dbapi_conn, record, proxy: _record_pool_checkout(engine, record))
    event.listen(engine, "checkin", lambda dbapi_conn, record: _record_pool_checkin(engine, record))
    setattr(engine, "_catalog_observability_configured", True)
    logger.info(
        "[OBSERVABILITY] SQL instrumentation enabled slow_sql_threshold_ms=%.1f",
        _slow_sql_threshold_ms(),
    )
