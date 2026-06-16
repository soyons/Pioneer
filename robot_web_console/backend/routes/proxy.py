"""反向代理路由 - 转发请求到 camera/teleop/robot 服务

三个后端服务的路由都在 /api/* 下。前端用 /api/<svc>/<X> 访问,
代理需:剥掉 /api/<svc> 前缀,再补回 /api,转发到 <url>/api/<X>。
"""
from fastapi import APIRouter, Request

from ..config import get_settings
from ..services.proxy import proxy_request

# Camera Service 代理
camera_router = APIRouter(prefix="/api/camera", tags=["camera"])

@camera_router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_to_camera(request: Request, path: str):
    """转发所有 /api/camera/* 请求到 camera_service"""
    settings = get_settings()
    camera_url = settings.services["camera"].api_url
    return await proxy_request(request, camera_url, path_prefix="/api/camera", target_prefix="/api")


# Teleop Service 代理
teleop_router = APIRouter(prefix="/api/teleop", tags=["teleop"])

@teleop_router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_to_teleop(request: Request, path: str):
    """转发所有 /api/teleop/* 请求到 teleop"""
    settings = get_settings()
    teleop_url = settings.services["teleop"].api_url
    return await proxy_request(request, teleop_url, path_prefix="/api/teleop", target_prefix="/api")


# Robot Controller 代理
robot_router = APIRouter(prefix="/api/robot", tags=["robot"])

@robot_router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_to_robot(request: Request, path: str):
    """转发所有 /api/robot/* 请求到 robot_controller"""
    settings = get_settings()
    robot_url = settings.services["robot"].api_url
    return await proxy_request(request, robot_url, path_prefix="/api/robot", target_prefix="/api")
