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


def _record_sql_duration(duration_ms: float) -> None:
    metrics = current_request_metrics()
    request_id = metrics.request_id if metrics else "-"
    endpoint = f"{metrics.method} {metrics.path}" if metrics else "background"
    if metrics:
        metrics.query_count += 1
        metrics.sql_time_ms += duration_ms

    if duration_ms >= _slow_sql_threshold_ms():
        logger.warning(
            "[SLOW SQL][%s] endpoint=%s duration=%.1fms",
            request_id,
            endpoint,
            duration_ms,
        )


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
    _record_sql_duration((time.perf_counter_ns() - started_ns) / 1_000_000.0)


def _handle_sql_error(exception_context):
    context = getattr(exception_context, "execution_context", None)
    started_ns = getattr(context, "_catalog_observability_started_ns", None)
    if started_ns is not None:
        _record_sql_duration((time.perf_counter_ns() - started_ns) / 1_000_000.0)


def configure_sqlalchemy_instrumentation(engine) -> None:
    """Attach non-invasive SQL timing listeners once per SQLAlchemy engine."""
    if getattr(engine, "_catalog_observability_configured", False):
        return
    event.listen(engine, "before_cursor_execute", _before_cursor_execute)
    event.listen(engine, "after_cursor_execute", _after_cursor_execute)
    event.listen(engine, "handle_error", _handle_sql_error)
    setattr(engine, "_catalog_observability_configured", True)
    logger.info(
        "[OBSERVABILITY] SQL instrumentation enabled slow_sql_threshold_ms=%.1f",
        _slow_sql_threshold_ms(),
    )
