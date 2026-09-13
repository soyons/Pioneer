"""服务状态监控 - 异步 Health Check"""
import asyncio
import logging
from datetime import datetime
from typing import Dict, Optional

import httpx

from ..config import ServiceConfig

logger = logging.getLogger(__name__)


class ServiceStatus:
    """单个服务状态"""
    def __init__(self, name: str):
        self.name = name
        self.online: bool = False
        self.last_check: Optional[datetime] = None
        self.response_time_ms: Optional[float] = None
        self.error: Optional[str] = None


class ServiceMonitor:
    """服务状态监控器 - 定期探测各服务健康状态"""

    def __init__(self, services: Dict[str, ServiceConfig], check_interval: float = 5.0):
        """
        Args:
            services: 服务配置字典 {service_key: ServiceConfig}
            check_interval: 检查间隔(秒)
        """
        self.services = services
        self.check_interval = check_interval
        self.status: Dict[str, ServiceStatus] = {
            key: ServiceStatus(config.name) for key, config in services.items()
        }
        self._task: Optional[asyncio.Task] = None
        self._running = False
        # 复用同一个 client：三个服务的健康探测是固定周期的短请求，
        # 每次新建 client 会重复握手并丢弃连接池。
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=2.0,
                limits=httpx.Limits(max_keepalive_connections=4, max_connections=8),
            )
        return self._client

    async def check_service(self, key: str, config: ServiceConfig) -> None:
        """检查单个服务健康状态"""
        status = self.status[key]
        url = "{}/{}".format(config.api_url.rstrip('/'), config.health_endpoint.lstrip('/'))

        start = asyncio.get_event_loop().time()
        try:
            response = await self._get_client().get(url)
            elapsed_ms = (asyncio.get_event_loop().time() - start) * 1000

            status.online = response.status_code == 200
            status.response_time_ms = elapsed_ms
            status.error = None if status.online else "HTTP {}".format(response.status_code)
            status.last_check = datetime.now()

        except httpx.TimeoutException:
            status.online = False
            status.response_time_ms = None
            status.error = "Timeout"
            status.last_check = datetime.now()

        except httpx.ConnectError:
            status.online = False
            status.response_time_ms = None
            status.error = "Connection refused"
            status.last_check = datetime.now()

        except Exception as e:
            status.online = False
            status.response_time_ms = None
            status.error = str(e)
            status.last_check = datetime.now()
            logger.error("Health check failed for {}: {}".format(config.name, e))

    async def check_all(self) -> None:
        """并发检查所有服务"""
        tasks = [
            self.check_service(key, config)
            for key, config in self.services.items()
        ]
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _monitor_loop(self) -> None:
        """后台监控循环"""
        logger.info("Service monitor started (interval=%.1fs)", self.check_interval)
        while self._running:
            await self.check_all()
            await asyncio.sleep(self.check_interval)
        logger.info("Service monitor stopped")

    async def start(self) -> None:
        """启动监控"""
        if self._running:
            return
        self._running = True
        # Python 3.6 兼容：使用 ensure_future 而非 create_task
        self._task = asyncio.ensure_future(self._monitor_loop())

    async def stop(self) -> None:
        """停止监控"""
        if not self._running:
            return
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def get_status(self, key: str) -> Optional[ServiceStatus]:
        """获取单个服务状态"""
        return self.status.get(key)

    def get_all_status(self) -> Dict[str, ServiceStatus]:
        """获取所有服务状态"""
        return self.status
