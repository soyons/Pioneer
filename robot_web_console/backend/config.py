"""配置管理 - 使用 Pydantic Settings"""
from pathlib import Path
from typing import Dict, Literal, Optional

import yaml
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings


class DevConfig(BaseModel):
    """开发模式服务启动配置"""
    enabled: bool = True
    command: list[str]
    cwd: str
    env: Dict[str, str] = Field(default_factory=dict)


class ServiceConfig(BaseModel):
    """单个服务配置"""
    name: str
    api_url: str
    health_endpoint: str = "/api/health"
    dev: Optional[DevConfig] = None


class ConsoleConfig(BaseModel):
    """Web Console 自身配置"""
    host: str = "0.0.0.0"
    port: int = 3000
    static_dir: str = "../frontend"


class LoggingConfig(BaseModel):
    """日志配置"""
    level: str = "INFO"
    format: str = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"


class Settings(BaseSettings):
    """全局配置"""
    mode: Literal["production", "development"] = "production"
    console: ConsoleConfig = Field(default_factory=ConsoleConfig)
    services: Dict[str, ServiceConfig]
    logging: LoggingConfig = Field(default_factory=LoggingConfig)

    @classmethod
    def from_yaml(cls, config_path: Path) -> "Settings":
        """从 YAML 文件加载配置"""
        with open(config_path, "r") as f:
            data = yaml.safe_load(f)
        return cls(**data)


# 全局配置实例
_settings: Optional[Settings] = None


def load_settings(config_path: Optional[Path] = None) -> Settings:
    """加载配置(单例)"""
    global _settings
    if _settings is None:
        if config_path is None:
            config_path = Path(__file__).parent.parent / "config" / "default.yaml"
        _settings = Settings.from_yaml(config_path)
    return _settings


def get_settings() -> Settings:
    """获取配置实例"""
    if _settings is None:
        return load_settings()
    return _settings
