#!/bin/bash
# Piper 统一依赖安装脚本
# 安装所有子项目的 Python 依赖

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
title() { echo -e "${BLUE}[PIPER]${NC} $1"; }

echo ""
echo "╔════════════════════════════════════════╗"
echo "║   Piper Dependencies Installation      ║"
echo "╚════════════════════════════════════════╝"
echo ""

# 检查 pip
if ! command -v pip3 &> /dev/null; then
    warn "pip3 not found, installing..."
    apt-get update && apt-get install -y python3-pip
fi

# 升级 pip
info "Upgrading pip..."
python3 -m pip install --upgrade pip

# 安装各子项目依赖
install_project() {
    local project_name=$1
    local project_path=$2

    if [ -f "$project_path/requirements.txt" ]; then
        title "Installing $project_name dependencies..."
        python3 -m pip install -r "$project_path/requirements.txt"
        info "✓ $project_name dependencies installed"
    else
        warn "No requirements.txt found for $project_name"
    fi
}

# 1. teleop
install_project "teleop" "$SCRIPT_DIR/teleop"

# 2. robot_controller
install_project "robot_controller" "$SCRIPT_DIR/robot_controller"

# 3. camera_service
install_project "camera_service" "$SCRIPT_DIR/camera_service"

# 4. piper_dataset (可选)
if [ -d "$SCRIPT_DIR/piper_dataset" ]; then
    install_project "piper_dataset" "$SCRIPT_DIR/piper_dataset"
fi

echo ""
title "Special dependencies notes:"
warn "placo: If installation fails, install from source:"
echo "  git clone https://github.com/Rhoban/placo"
echo "  cd placo && pip install ."
echo ""
warn "pyrealsense2: Uncomment in camera_service/requirements.txt if needed"
echo ""

info "✅ All dependencies installed successfully!"
info ""
info "Next steps:"
info "  1. Build ROS2 messages: cd ros_interface && bash build.sh"
info "  2. Run teleop: cd teleop && ./scripts/docker_run_teleop.sh"
info "  3. Run controller: cd robot_controller && ./scripts/docker_run_controller.sh"
echo ""
