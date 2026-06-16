"""robot_web_console backend"""
# 注意:不在此处 import app,避免 `python3 -m backend.main` 时模块被执行两次
# (会触发 RuntimeWarning 并导致后台运行不稳定)。
# 需要 app 时直接 `from backend.main import app`。

from .config import get_settings, load_settings

__all__ = ["get_settings", "load_settings"]
