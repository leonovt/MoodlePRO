import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from redis.asyncio import Redis

from app.services.queue import subscribe_all_segments

logger = logging.getLogger(__name__)
router = APIRouter()


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}

    async def connect(self, job_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(job_id, set()).add(websocket)

    def disconnect(self, job_id: str, websocket: WebSocket) -> None:
        connections = self._connections.get(job_id)
        if connections is None:
            return
        connections.discard(websocket)
        if not connections:
            self._connections.pop(job_id, None)

    async def broadcast(self, job_id: str, message: dict) -> None:
        for websocket in list(self._connections.get(job_id, [])):
            try:
                await websocket.send_json(message)
            except Exception:
                logger.exception("Failed to send WS message for job %s", job_id)


manager = ConnectionManager()


async def relay_segments_forever(redis: Redis) -> None:
    """Background task: forwards every Redis pub/sub segment/completion event to its job's websockets."""
    async for event in subscribe_all_segments(redis):
        await manager.broadcast(event["job_id"], event)


@router.websocket("/ws/jobs/{job_id}")
async def job_websocket(websocket: WebSocket, job_id: str) -> None:
    await manager.connect(job_id, websocket)
    try:
        while True:
            # Client doesn't need to send anything; just keep the connection alive.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(job_id, websocket)
