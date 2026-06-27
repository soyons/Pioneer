"""robot_web_console 主入口 - FastAPI 应用"""
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings, load_settings
from .routes import proxy, services, system, datasets
from .services.monitor import ServiceMonitor


# 创建 FastAPI 应用（Python 3.6兼容：使用 on_event 而非 lifespan）
app = FastAPI(
    title="Robot Web Console",
    description="统一 Web 控制台 - 管理 camera/teleop/robot 服务",
    version="1.0.0",
)


@app.on_event("startup")
async def startup_event():
    """应用启动事件"""
    settings = get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.logging.level),
        format=settings.logging.format
    )
    logger = logging.getLogger(__name__)
    logger.info("Starting robot_web_console in {} mode".format(settings.mode))

    # 初始化服务监控
    monitor = ServiceMonitor(settings.services, check_interval=2.0)
    await monitor.start()
    app.state.monitor = monitor

    logger.info("Web console ready on http://{}:{}".format(
        settings.console.host, settings.console.port))


@app.on_event("shutdown")
async def shutdown_event():
    """应用关闭事件"""
    logger = logging.getLogger(__name__)
    logger.info("Shutting down robot_web_console")
    if hasattr(app.state, 'monitor'):
        await app.state.monitor.stop()


# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(services.router)
app.include_router(system.router)
app.include_router(datasets.router)
app.include_router(proxy.camera_router)
app.include_router(proxy.teleop_router)
app.include_router(proxy.robot_router)


@app.get("/api/health")
async def health_check():
    """健康检查端点"""
    return {"status": "ok", "service": "robot_web_console"}


@app.get("/api/info")
async def get_info():
    """获取 Console 信息"""
    settings = get_settings()
    return {
        "mode": settings.mode,
        "services": {
            key: {
                "name": config.name,
                "api_url": config.api_url,
            }
            for key, config in settings.services.items()
        }
    }


# 挂载静态文件(前端) - static_dir 解析为 robot_web_console/<static_dir>
settings = get_settings()
project_root = Path(__file__).parent.parent  # robot_web_console/
static_dir = project_root / settings.console.static_dir
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
else:
    logging.warning("Static directory not found: {}".format(static_dir))


if __name__ == "__main__":
    import uvicorn
    settings = load_settings()
    # reload 仅在 development 模式启用(生产/后台运行用 reload 会 fork 子进程,不稳定)
    use_reload = settings.mode == "development"
    uvicorn.run(
        "backend.main:app",
        host=settings.console.host,
        port=settings.console.port,
        reload=use_reload,
    )
