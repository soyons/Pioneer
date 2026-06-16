#!/bin/bash
# robot_web_console 启动脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 检查依赖
if ! python3 -c "import fastapi, uvicorn" 2>/dev/null; then
    echo "Installing dependencies..."
    pip install -r requirements.txt
fi

# 读取配置里的 host/port/mode
HOST=$(python3 -c "from backend.config import load_settings; print(load_settings().console.host)")
PORT=$(python3 -c "from backend.config import load_settings; print(load_settings().console.port)")
MODE=$(python3 -c "from backend.config import load_settings; print(load_settings().mode)")

echo "Starting robot_web_console on http://${HOST}:${PORT} (mode=${MODE})"

# development 模式启用热重载
RELOAD_FLAG=""
if [ "$MODE" = "development" ]; then
    RELOAD_FLAG="--reload"
fi

# 用 uvicorn 直接启动(比 python3 -m backend.main 更稳定)
exec uvicorn backend.main:app --host "$HOST" --port "$PORT" $RELOAD_FLAG
