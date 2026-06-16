#!/bin/bash
# 一键启动：camera_service（含相机检查） + robot_controller（含 web HTTP API）
#
# 用法（在容器内）：
#   ./scripts/start_all.sh                 # 检查相机 -> 启动两个服务
#   SKIP_CAMERA_CHECK=1 ./scripts/start_all.sh   # 跳过相机检查
#   NO_CAMERA=1 ./scripts/start_all.sh     # 只启动 robot_controller
#   NO_CONTROLLER=1 ./scripts/start_all.sh # 只启动 camera_service
#
# 环境变量（透传给子服务）：
#   CAMERA_CONFIG     camera_service 配置文件（默认 camera_service/config/default_config.yaml）
#   CONTROLLER_CONFIG robot_controller 配置文件（默认其内置 default_config.yaml）
#   MODE / FPS / RAW / QUALITY   透传给 camera_service（见 docker_run_camera_service.sh）
#
# Ctrl+C 一次性停止全部服务。日志写到各自项目的 logs/ 目录。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${GREEN}[start_all]${NC} $1"; }
warn() { echo -e "${YELLOW}[start_all]${NC} $1"; }
err()  { echo -e "${RED}[start_all]${NC} $1"; }

CAMERA_CONFIG="${CAMERA_CONFIG:-$ROOT_DIR/camera_service/config/default_config.yaml}"

# ---- 1. 容器与 ROS2 环境检查 ----
if [ ! -f /.dockerenv ]; then
    warn "不在 Docker 容器内，建议先进入容器（见 CLAUDE.md Quick Start）"
fi

# ROS setup.bash / ros_interface setup.bash 都引用了 AMENT_TRACE_SETUP_FILES 等
# 未定义可选变量;set -u 下会让本脚本直接静默退出(2>/dev/null + || true 都拦不住,
# set -u 触发的退出比 || 更早生效)。整段流程关闭未定义检查。
set +u
source /opt/ros/humble/setup.bash

# ---- 2. 确保 ros_interface 已编译并 source ----
# 历史上 ros_interface 编译产物路径有过迁移（早期 .colcon/、install/，当前 build/）。
# 按实际存在的优先级寻找，没有就调用 build.sh 重建。
RI_DIR="$ROOT_DIR/ros_interface"
RI_SETUP=""
for cand in \
    "$RI_DIR/build/install/setup.bash" \
    "$RI_DIR/.colcon/install/setup.bash" \
    "$RI_DIR/install/setup.bash"; do
    [ -f "$cand" ] && { RI_SETUP="$cand"; break; }
done
if [ -z "$RI_SETUP" ]; then
    info "ros_interface 未编译，开始编译..."
    (cd "$RI_DIR" && bash build.sh)
    for cand in \
        "$RI_DIR/build/install/setup.bash" \
        "$RI_DIR/.colcon/install/setup.bash" \
        "$RI_DIR/install/setup.bash"; do
        [ -f "$cand" ] && { RI_SETUP="$cand"; break; }
    done
fi
if [ -n "$RI_SETUP" ]; then
    # shellcheck disable=SC1090
    source "$RI_SETUP"
    info "已 source ros_interface ($RI_SETUP)"
else
    err "ros_interface 编译后仍找不到 setup.bash"
    exit 1
fi

# ---- 3. 相机检查 ----
if [ -z "${NO_CAMERA:-}" ] && [ -z "${SKIP_CAMERA_CHECK:-}" ]; then
    info "检查相机设备..."
    if ! PYTHONPATH="$ROOT_DIR/camera_service/src:${PYTHONPATH:-}" \
            python3 -m camera_service --mode check --config "$CAMERA_CONFIG"; then
        err "相机检查未通过。修复后重试，或用 SKIP_CAMERA_CHECK=1 跳过。"
        exit 1
    fi
fi

# ---- 4. 清理残留进程 ----
for pat in "python3 -m robot_controller" "python3 -m camera_service"; do
    pids=$(pgrep -f "$pat" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        warn "发现残留进程: $pat (pid $pids)，正在清理..."
        kill $pids 2>/dev/null || true
        sleep 1
        # 若 SIGTERM 无效则强杀（串口 I/O 阻塞时进程不响应 SIGTERM）
        kill -9 $pids 2>/dev/null || true
    fi
done

# ---- 5. 进程管理 ----
PIDS=()
NAMES=()

cleanup() {
    echo ""
    info "正在停止所有服务..."
    for i in "${!PIDS[@]}"; do
        pid="${PIDS[$i]}"
        if kill -0 "$pid" 2>/dev/null; then
            info "  停止 ${NAMES[$i]} (pid $pid)"
            kill "$pid" 2>/dev/null || true
        fi
    done
    # 给子进程一点退出时间，再强杀残留
    sleep 2
    for pid in "${PIDS[@]}"; do
        kill -9 "$pid" 2>/dev/null || true
    done
    info "已全部停止。"
}
trap cleanup EXIT INT TERM

# ---- 6. 启动 camera_service ----
if [ -z "${NO_CAMERA:-}" ]; then
    mkdir -p "$ROOT_DIR/camera_service/logs"
    CAM_LOG="$ROOT_DIR/camera_service/logs/camera_latest.log"
    info "启动 camera_service -> $CAM_LOG"
    CONFIG_FILE="$CAMERA_CONFIG" \
        "$ROOT_DIR/camera_service/scripts/docker_run_camera_service.sh" \
        > "$CAM_LOG" 2>&1 &
    PIDS+=($!); NAMES+=("camera_service")
    sleep 2
    if ! kill -0 "${PIDS[-1]}" 2>/dev/null; then
        err "camera_service 启动失败，查看 $CAM_LOG"
        tail -n 20 "$CAM_LOG" || true
        exit 1
    fi
fi

# ---- 7. 启动 robot_controller（含 web HTTP API，默认端口 8081）----
if [ -z "${NO_CONTROLLER:-}" ]; then
    mkdir -p "$ROOT_DIR/robot_controller/logs"
    RC_LOG="$ROOT_DIR/robot_controller/logs/controller_latest.log"
    info "启动 robot_controller（含 web API）-> $RC_LOG"
    export PYTHONPATH="$ROOT_DIR/robot_controller/src:${PYTHONPATH:-}"
    (
        cd "$ROOT_DIR/robot_controller"
        if [ -n "${CONTROLLER_CONFIG:-}" ]; then
            exec python3 -m robot_controller --config "$CONTROLLER_CONFIG"
        else
            exec python3 -m robot_controller
        fi
    ) > "$RC_LOG" 2>&1 &
    PIDS+=($!); NAMES+=("robot_controller")
    sleep 2
    if ! kill -0 "${PIDS[-1]}" 2>/dev/null; then
        err "robot_controller 启动失败，查看 $RC_LOG"
        tail -n 20 "$RC_LOG" || true
        exit 1
    fi
    info "web API: http://localhost:8081/api/status"
fi

if [ "${#PIDS[@]}" -eq 0 ]; then
    warn "没有要启动的服务（NO_CAMERA 与 NO_CONTROLLER 同时设置？）"
    exit 0
fi

info "全部启动完成。按 Ctrl+C 停止。"
# 任一服务退出即整体退出（触发 cleanup 收尾其余服务）
wait -n
err "有服务退出，开始收尾..."
