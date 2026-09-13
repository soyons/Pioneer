"""服务管理路由 - 查询和管理平台服务"""
import asyncio
from pathlib import Path
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException

from ..services.monitor import ServiceMonitor

router = APIRouter(prefix="/api/services", tags=["services"])
_platform_lock = asyncio.Lock()


def _platform_script() -> Path:
    return Path(__file__).resolve().parents[3] / "scripts" / "platform.sh"


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


@router.post("/platform/{action}")
async def platform_action(action: str):
    """一键启动/停止/重启本机 camera、coach、controller 和 console。"""
    allowed = {"start", "stop", "restart", "status", "start-services", "stop-services", "restart-services"}
    if action not in allowed:
        raise HTTPException(status_code=400, detail="不支持的 platform action")
    script = _platform_script()
    if not script.is_file():
        raise HTTPException(status_code=500, detail=f"platform script not found: {script}")

    async with _platform_lock:
        process = await asyncio.create_subprocess_exec(
            str(script), action,
            cwd=str(script.parent.parent),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        try:
            stdout, _ = await asyncio.wait_for(process.communicate(), timeout=30)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise HTTPException(status_code=504, detail="platform operation timed out")
        output = stdout.decode(errors="replace") if stdout else ""
        if process.returncode != 0:
            raise HTTPException(status_code=500, detail=output[-2000:] or "platform operation failed")
        return {"action": action, "ok": True, "output": output[-4000:]}
