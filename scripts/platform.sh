#!/usr/bin/env bash
# 一键管理整个平台：camera + robot_controller + coach + web console。
# 用法: ./scripts/platform.sh {start|stop|restart|status}
# Web Console 使用 start-services/restart-services，只操作后端，不重启当前页面。

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${PLATFORM_RUNTIME_DIR:-$ROOT_DIR/.runtime/platform}"
LOG_DIR="$RUNTIME_DIR/logs"
mkdir -p "$LOG_DIR"

info() { echo "[platform] $*"; }
warn() { echo "[platform] WARNING: $*" >&2; }

pid_file() { echo "$RUNTIME_DIR/$1.pid"; }
log_file() { echo "$LOG_DIR/$1.log"; }

is_running() {
    local name="$1" pid_file_path pid
    pid_file_path="$(pid_file "$name")"
    [ -s "$pid_file_path" ] || return 1
    pid="$(cat "$pid_file_path" 2>/dev/null || true)"
    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
    kill -0 "$pid" 2>/dev/null
}

launch() {
    local name="$1"; shift
    if is_running "$name"; then
        info "$name already running (pid $(cat "$(pid_file "$name")"))"
        return 0
    fi
    rm -f "$(pid_file "$name")"
    info "starting $name"
    nohup "$@" >>"$(log_file "$name")" 2>&1 </dev/null &
    echo $! >"$(pid_file "$name")"
    sleep 0.3
    if ! is_running "$name"; then
        warn "$name exited during startup; see $(log_file "$name")"
        return 1
    fi
}

stop_one() {
    local name="$1" pid_file_path pid deadline
    pid_file_path="$(pid_file "$name")"
    if ! is_running "$name"; then
        rm -f "$pid_file_path"
        return 0
    fi
    pid="$(cat "$pid_file_path")"
    info "stopping $name (pid $pid)"
    kill "$pid" 2>/dev/null || true
    deadline=$((SECONDS + 12))
    while is_running "$name" && [ "$SECONDS" -lt "$deadline" ]; do sleep 0.2; done
    if is_running "$name"; then
        warn "$name did not stop gracefully; sending SIGKILL"
        kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file_path"
}

start_services() {
    if [ -z "${NO_CAMERA:-}" ] && [ "${FORCE_CAMERA:-0}" != "1" ] \
            && ! compgen -G "/dev/video*" >/dev/null; then
        NO_CAMERA=1
        info "未检测到 /dev/video*，自动跳过 camera_service（可用 FORCE_CAMERA=1 强制启动）"
    fi
    # start_all owns camera + controller as one process group and already
    # performs ROS/message setup and camera checks.
    launch "backend" env \
        SKIP_CAMERA_CHECK="${SKIP_CAMERA_CHECK:-}" \
        NO_CAMERA="${NO_CAMERA:-}" \
        NO_CONTROLLER="${NO_CONTROLLER:-}" \
        CONTROLLER_CONFIG="${CONTROLLER_CONFIG:-}" \
        "$ROOT_DIR/scripts/start_all.sh"

    if [ -z "${NO_COACH:-}" ]; then
        launch "coach" env \
            PYTHONPATH="$ROOT_DIR/coach/src:${PYTHONPATH:-}" \
            "$ROOT_DIR/coach/scripts/start.sh"
    fi
}

start_platform() {
    start_services

    if [ -z "${NO_CONSOLE:-}" ]; then
        launch "console" env \
            PYTHONPATH="$ROOT_DIR/robot_web_console:${PYTHONPATH:-}" \
            python3 -m uvicorn backend.main:app \
            --app-dir "$ROOT_DIR/robot_web_console" \
            --host "${CONSOLE_HOST:-0.0.0.0}" --port "${CONSOLE_PORT:-3000}"
    fi
    info "platform started; console: http://localhost:${CONSOLE_PORT:-3000}"
}

stop_platform() {
    # Stop children before the wrapper that owns camera/controller.
    stop_one console
    stop_one coach
    stop_one backend
    info "platform stopped"
}

stop_services() {
    stop_one coach
    stop_one backend
    info "backend services stopped"
}

status_platform() {
    local name
    for name in backend coach console; do
        if is_running "$name"; then
            echo "$name: running (pid $(cat "$(pid_file "$name")"))"
        else
            echo "$name: stopped"
        fi
    done
}

case "${1:-status}" in
    start) start_platform ;;
    start-services) start_services ;;
    stop) stop_platform ;;
    stop-services) stop_services ;;
    restart) stop_platform; start_platform ;;
    restart-services) stop_services; start_services ;;
    status) status_platform ;;
    *) echo "usage: $0 {start|stop|restart|status}" >&2; exit 2 ;;
esac
