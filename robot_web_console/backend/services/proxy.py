"""反向代理 - 转发请求到后端服务 API"""
import logging

import httpx
from fastapi import Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

logger = logging.getLogger(__name__)


def _is_status_endpoint(path: str) -> bool:
    """判断是否为状态/健康检查端点"""
    return path.endswith("/status") or path.endswith("/health")


async def proxy_request(
    request: Request,
    target_url: str,
    path_prefix: str = "",
    target_prefix: str = "",
    timeout: float = 30.0
) -> Response:
    """
    反向代理请求到目标服务

    Args:
        request: 原始 FastAPI Request
        target_url: 目标服务基础 URL (如 http://localhost:8081)
        path_prefix: 从原始路径中去掉的前缀 (如 /api/robot)
        target_prefix: 转发时补回的前缀 (如 /api) —— 后端服务路由都在 /api/* 下
        timeout: 请求超时(秒)

    Returns:
        Response 对象,携带目标服务的响应

    例: 原始 /api/robot/status, path_prefix=/api/robot, target_prefix=/api
        -> 去前缀得 /status -> 补 target_prefix -> /api/status
        -> 转发到 http://localhost:8081/api/status
    """
    # 构建目标 URL
    original_path = request.url.path
    if path_prefix and original_path.startswith(path_prefix):
        target_path = original_path[len(path_prefix):]
    else:
        target_path = original_path

    # 补回目标服务的路由前缀(避免重复补:若已以 target_prefix 开头则跳过)
    if target_prefix and not target_path.startswith(target_prefix + "/") and target_path != target_prefix:
        target_path = target_prefix + target_path

    target_full_url = f"{target_url.rstrip('/')}{target_path}"
    if request.url.query:
        target_full_url += f"?{request.url.query}"

    # 准备请求参数
    headers = dict(request.headers)
    # 移除 host header,避免冲突
    headers.pop("host", None)

    body = await request.body()

    # MJPEG 流:检测到 stream 路径,用流式转发避免缓冲整帧
    is_stream = target_path.endswith("/stream")

    try:
        if is_stream:
            return await _proxy_stream(request.method, target_full_url, headers, body)

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method=request.method,
                url=target_full_url,
                headers=headers,
                content=body,
            )
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers=dict(response.headers),
            )

    except httpx.TimeoutException:
        logger.warning(f"Proxy timeout: {request.method} {target_full_url}")
        # 状态/健康检查端点在超时时返回 200 + connected=false
        if _is_status_endpoint(target_path):
            return JSONResponse(
                status_code=200,
                content={
                    "connected": False,
                    "error": "Request timeout",
                    "status": "timeout"
                }
            )
        return JSONResponse(
            status_code=504,
            content={"error": "Gateway timeout", "target": target_url}
        )

    except httpx.ConnectError:
        logger.warning(f"Proxy connection failed: {target_full_url}")
        # 状态/健康检查端点在服务不可达时返回 200 + connected=false，而不是 502
        if _is_status_endpoint(target_path):
            return JSONResponse(
                status_code=200,
                content={
                    "connected": False,
                    "error": "Service unavailable",
                    "status": "offline"
                }
            )
        return JSONResponse(
            status_code=502,
            content={"error": "Bad gateway - service unavailable", "target": target_url}
        )

    except Exception as e:
        logger.exception(f"Proxy error: {request.method} {target_full_url}")
        return JSONResponse(
            status_code=500,
            content={"error": "Internal proxy error", "detail": str(e)}
        )


async def _proxy_stream(method: str, url: str, headers: dict, body: bytes) -> StreamingResponse:
    """流式转发 MJPEG 等长连接响应,不缓冲整帧。"""
    # 客户端用 None 超时,流式读取直到客户端断开
    client = httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=None, write=10.0, pool=5.0))
    req = client.build_request(method=method, url=url, headers=headers, content=body)
    response = await client.send(req, stream=True)

    async def iter_chunks():
        try:
            async for chunk in response.aiter_raw():
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    # 透传必要的头(去掉 hop-by-hop)
    out_headers = {
        k: v for k, v in response.headers.items()
        if k.lower() not in ("transfer-encoding", "connection", "content-length")
    }
    return StreamingResponse(
        iter_chunks(),
        status_code=response.status_code,
        headers=out_headers,
        media_type=response.headers.get("content-type"),
    )
