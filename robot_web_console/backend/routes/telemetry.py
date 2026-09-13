"""WebSocket relay from the console to robot_controller telemetry."""

import asyncio
import logging
from urllib.parse import urlparse, urlunparse

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["telemetry"])


def _controller_ws_url() -> str:
    api_url = get_settings().services["robot"].api_url
    parsed = urlparse(api_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    path = parsed.path.rstrip("/") + "/ws/telemetry"
    return urlunparse((scheme, parsed.netloc, path, "", "", ""))


@router.websocket("/ws/telemetry")
async def telemetry_relay(websocket: WebSocket):
    await websocket.accept()
    upstream_url = _controller_ws_url()
    try:
        try:
            import websockets
        except ImportError:
            logger.error("Telemetry relay requires the 'websockets' package")
            await websocket.close(code=1011)
            return
        async with websockets.connect(upstream_url, max_size=4 * 1024 * 1024) as upstream:
            async def upstream_to_browser():
                async for message in upstream:
                    await websocket.send_text(message)

            async def browser_disconnect_watch():
                # Starlette returns the disconnect message once; calling receive()
                # again raises RuntimeError, so stop as soon as it arrives.
                while True:
                    message = await websocket.receive()
                    if message.get("type") == "websocket.disconnect":
                        return

            tasks = [
                asyncio.ensure_future(upstream_to_browser()),
                asyncio.ensure_future(browser_disconnect_watch()),
            ]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                error = task.exception()
                if error and not isinstance(error, WebSocketDisconnect):
                    raise error
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Telemetry WebSocket relay failed: %s", upstream_url)
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
