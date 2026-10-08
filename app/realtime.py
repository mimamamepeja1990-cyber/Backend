"""In-process realtime transport shared by the single FastAPI worker.

The database remains authoritative.  This module only distributes committed
changes to connected clients and keeps a small replay window for reconnects.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Set

from fastapi import WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder


_ACTION_TYPES = {
    "created": "product.created",
    "updated": "product.updated",
    "deleted": "product.deleted",
    "bulk_updated": "product.bulk.updated",
    "imported": "product.bulk.imported",
    "order_created": "order.created",
    "order_updated": "order.updated",
    "orders_changed": "order.collection.changed",
    "driver_location": "driver.location.updated",
    "driver_location_offline": "driver.location.offline",
    "consumos-updated": "consumos.updated",
    "filters-updated": "filters.updated",
    "product-categories-updated": "product_categories.updated",
    "promotions-updated": "promotions.updated",
    "promotions_updated": "promotions.updated",
}


def _clean_topic(value: Any) -> str:
    return str(value or "").strip().lower().replace("-", "_")


def _event_type(raw: Dict[str, Any]) -> str:
    explicit = str(raw.get("type") or "").strip()
    if explicit:
        return _ACTION_TYPES.get(explicit, explicit.replace("-", "."))
    action = str(raw.get("action") or "").strip()
    if action in _ACTION_TYPES:
        return _ACTION_TYPES[action]
    if action:
        return action.replace("-", ".")
    return "system.event"


def _entity_for(event_type: str, raw: Dict[str, Any]) -> str:
    explicit = str(raw.get("entity") or "").strip()
    if explicit:
        return explicit
    return event_type.split(".", 1)[0] or "system"


def _entity_id(entity: str, raw: Dict[str, Any]) -> Any:
    if raw.get("id") is not None:
        return raw.get("id")
    nested = raw.get(entity)
    if isinstance(nested, dict):
        return nested.get("id") or nested.get(f"{entity}_id")
    if entity == "product" and isinstance(raw.get("products"), list):
        return None
    return None


def _scope_for(raw: Dict[str, Any]) -> str:
    value = raw.get("scope")
    if value is None:
        value = raw.get("business_scope")
    if value is None and isinstance(raw.get("order"), dict):
        value = raw["order"].get("customer_type")
    value = _clean_topic(value)
    return value if value in {"mayorista", "minorista", "all"} else "all"


@dataclass
class RealtimeClient:
    client_id: str
    websocket: WebSocket
    scope: str = "all"
    topics: Set[str] = field(default_factory=set)
    connected_at: float = field(default_factory=time.time)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class RealtimeManager:
    """Connection registry and bounded event replay for one worker process."""

    def __init__(self, logger, history_size: int = 256) -> None:
        self.logger = logger
        self.clients: Dict[str, RealtimeClient] = {}
        self.history = deque(maxlen=max(32, int(history_size)))
        self._lock = asyncio.Lock()
        self._sequence = 0
        self.events_sent = 0
        self.events_broadcast = 0

    @property
    def active_count(self) -> int:
        return len(self.clients)

    async def connect(self, websocket: WebSocket, scope: Optional[str] = None) -> RealtimeClient:
        await websocket.accept()
        client = RealtimeClient(
            client_id=uuid.uuid4().hex,
            websocket=websocket,
            scope=_clean_topic(scope) if _clean_topic(scope) in {"mayorista", "minorista"} else "all",
        )
        async with self._lock:
            self.clients[client.client_id] = client
        self.logger.info("[WS] connect client=%s active=%s scope=%s", client.client_id[:8], self.active_count, client.scope)
        return client

    async def disconnect(self, client: Optional[RealtimeClient], reason: str = "closed") -> None:
        if client is None:
            return
        async with self._lock:
            self.clients.pop(client.client_id, None)
        self.logger.info("[WS] disconnect client=%s reason=%s active=%s", client.client_id[:8], reason, self.active_count)

    def _matches(self, client: RealtimeClient, event: Dict[str, Any]) -> bool:
        event_scope = str(event.get("scope") or "all")
        if client.scope != "all" and event_scope not in {"all", client.scope}:
            return False
        if not client.topics:
            return True
        event_type = str(event.get("type") or "")
        entity = str(event.get("entity") or "")
        return event_type in client.topics or entity in client.topics or "*" in client.topics

    def normalize(self, raw_data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        raw = dict(raw_data or {})
        encoded = jsonable_encoder(raw)
        event_type = _event_type(encoded)
        entity = _entity_for(event_type, encoded)
        event_scope = _scope_for(encoded)
        self._sequence += 1
        event = {
            "type": event_type,
            "entity": entity,
            "id": _entity_id(entity, encoded),
            "data": encoded,
            "seq": self._sequence,
            "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
            "scope": event_scope,
        }
        # Keep the legacy top-level shape during the compatibility window.
        event.update(encoded)
        event["type"] = event_type
        event["entity"] = entity
        event["id"] = event.get("id") if event.get("id") is not None else _entity_id(entity, encoded)
        event["data"] = encoded
        event["seq"] = self._sequence
        event["timestamp"] = event["timestamp"]
        event["scope"] = event_scope
        if not event.get("action"):
            event["action"] = event_type.replace(".", "-")
        return event

    async def _send(self, client: RealtimeClient, event: Dict[str, Any]) -> bool:
        try:
            async with client.send_lock:
                await client.websocket.send_json(event)
            self.events_sent += 1
            return True
        except Exception as exc:
            self.logger.info("[WS] send_failed client=%s error=%s", client.client_id[:8], type(exc).__name__)
            return False

    async def publish(self, raw_data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        event = self.normalize(raw_data)
        self.history.append(event)
        async with self._lock:
            clients = [client for client in self.clients.values() if self._matches(client, event)]
        self.events_broadcast += 1
        if clients:
            results = await asyncio.gather(*(self._send(client, event) for client in clients), return_exceptions=True)
            dead = [client for client, ok in zip(clients, results) if ok is not True]
            for client in dead:
                await self.disconnect(client, reason="send_error")
        self.logger.info("[WS] broadcast type=%s seq=%s targets=%s active=%s", event["type"], event["seq"], len(clients), self.active_count)
        return event

    async def configure(self, client: RealtimeClient, message: Dict[str, Any]) -> List[Dict[str, Any]]:
        if not isinstance(message, dict):
            return []
        scope = _clean_topic(message.get("scope"))
        if scope in {"mayorista", "minorista", "all"}:
            client.scope = scope
        topics = message.get("topics") or message.get("subscribe")
        if isinstance(topics, str):
            topics = [topics]
        if isinstance(topics, Iterable):
            client.topics = {_clean_topic(topic) for topic in topics if _clean_topic(topic)}
        requested_replay = "since" in message
        try:
            since = max(0, int(message.get("since") or 0))
        except Exception:
            since = 0
        if not requested_replay:
            return []
        return [event for event in list(self.history) if int(event.get("seq") or 0) > since and self._matches(client, event)]

    async def send_replay(self, client: RealtimeClient, events: List[Dict[str, Any]]) -> None:
        for event in events:
            if not await self._send(client, event):
                await self.disconnect(client, reason="replay_send_error")
                break
