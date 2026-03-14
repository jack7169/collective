import asyncio
import logging
from typing import Dict, Set

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self._connections: Dict[int, Set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, scan_id: int, websocket: WebSocket):
        await websocket.accept()
        async with self._lock:
            if scan_id not in self._connections:
                self._connections[scan_id] = set()
            self._connections[scan_id].add(websocket)
        logger.info("WebSocket connected for scan %d", scan_id)

    async def disconnect(self, scan_id: int, websocket: WebSocket):
        async with self._lock:
            if scan_id in self._connections:
                self._connections[scan_id].discard(websocket)
                if not self._connections[scan_id]:
                    del self._connections[scan_id]
        logger.info("WebSocket disconnected for scan %d", scan_id)

    async def broadcast(self, scan_id: int, message: dict):
        async with self._lock:
            connections = set(self._connections.get(scan_id, set()))
        dead = []
        for ws in connections:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(scan_id, ws)

    async def broadcast_all(self, message: dict):
        async with self._lock:
            all_scan_ids = list(self._connections.keys())
        for scan_id in all_scan_ids:
            await self.broadcast(scan_id, message)


manager = ConnectionManager()
