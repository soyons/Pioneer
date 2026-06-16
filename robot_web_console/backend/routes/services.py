"""服务管理路由 - 查询各服务状态"""
from typing import Dict

from fastapi import APIRouter, Depends

from ..services.monitor import ServiceMonitor

router = APIRouter(prefix="/api/services", tags=["services"])


def get_monitor() -> ServiceMonitor:
    """依赖注入 - 获取 ServiceMonitor 实例"""
    from ..main import app
    return app.state.monitor


@router.get("/status")
async def get_all_services_status(monitor: ServiceMonitor = Depends(get_monitor)):
    """获取所有服务状态"""
    status = monitor.get_all_status()

    return {
        "services": {
            key: {
                "name": s.name,
                "online": s.online,
                "last_check": s.last_check.isoformat() if s.last_check else None,
                "response_time_ms": s.response_time_ms,
                "error": s.error,
            }
            for key, s in status.items()
        }
    }


@router.get("/status/{service_key}")
async def get_service_status(service_key: str, monitor: ServiceMonitor = Depends(get_monitor)):
    """获取单个服务状态"""
    status = monitor.get_status(service_key)
    if not status:
        return {"error": f"Unknown service: {service_key}"}, 404

    return {
        "name": status.name,
        "online": status.online,
        "last_check": status.last_check.isoformat() if status.last_check else None,
        "response_time_ms": status.response_time_ms,
        "error": status.error,
    }


@router.post("/check")
async def trigger_health_check(monitor: ServiceMonitor = Depends(get_monitor)):
    """手动触发一次健康检查"""
    await monitor.check_all()
    return {"message": "Health check triggered"}
