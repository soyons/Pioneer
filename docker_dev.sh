#!/bin/bash
# Piper 统一 Docker 开发环境管理脚本
# 管理 teleop 和 robot_controller 的开发容器

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

CONTAINER_NAME="piper_dev"
BASE_IMAGE_NAME="ros:humble"
CUSTOM_IMAGE_NAME="piper_dev:latest"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
title() { echo -e "${BLUE}[PIPER]${NC} $1"; }

show_banner() {
    echo ""
    echo "╔════════════════════════════════════════╗"
    echo "║     Piper Development Environment      ║"
    echo "╠════════════════════════════════════════╣"
    echo "║  Container: $CONTAINER_NAME"
    echo "║  Base Image: $BASE_IMAGE_NAME"
    echo "║  Custom Image: $CUSTOM_IMAGE_NAME"
    echo "║  Workspace: /workspace"
    echo "╚════════════════════════════════════════╝"
    echo ""
}

configure_sources() {
    local container=$1

    info "Configuring apt and pip sources..."

    docker exec "$container" bash -c '
        # 备份原始 sources.list
        cp /etc/apt/sources.list /etc/apt/sources.list.backup 2>/dev/null || true

        # 检测 Ubuntu 版本和架构
        UBUNTU_CODENAME=$(lsb_release -cs)
        ARCH=$(dpkg --print-architecture)

        # ARM64 架构使用官方源（清华镜像不支持 ARM64）
        if [ "$ARCH" = "arm64" ]; then
            echo "Detected ARM64 architecture, using official Ubuntu mirrors"
            cat > /etc/apt/sources.list << EOF
# Ubuntu 官方源 (ARM64)
deb http://ports.ubuntu.com/ubuntu-ports/ $UBUNTU_CODENAME main restricted universe multiverse
deb http://ports.ubuntu.com/ubuntu-ports/ $UBUNTU_CODENAME-updates main restricted universe multiverse
deb http://ports.ubuntu.com/ubuntu-ports/ $UBUNTU_CODENAME-backports main restricted universe multiverse
deb http://ports.ubuntu.com/ubuntu-ports/ $UBUNTU_CODENAME-security main restricted universe multiverse
EOF
        else
            echo "Using Tsinghua mirror for $ARCH"
            cat > /etc/apt/sources.list << EOF
# 清华大学开源软件镜像站
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ $UBUNTU_CODENAME main restricted universe multiverse
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ $UBUNTU_CODENAME-updates main restricted universe multiverse
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ $UBUNTU_CODENAME-backports main restricted universe multiverse
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ $UBUNTU_CODENAME-security main restricted universe multiverse
EOF
        fi

        # 更新包列表
        apt-get update > /dev/null 2>&1

        # 安装 pip
        apt-get install -y python3-pip > /dev/null 2>&1

        # 配置清华 pip 源
        mkdir -p ~/.pip
        cat > ~/.pip/pip.conf << "PIPEOF"
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
[install]
trusted-host = pypi.tuna.tsinghua.edu.cn
PIPEOF

        echo "✓ Sources configured"
    '
}

install_dependencies() {
    local container=$1

    info "Installing dependencies (PyBullet, etc.)..."

    docker exec "$container" bash -c '
        python3 -m pip install pybullet > /dev/null 2>&1
        echo "✓ PyBullet installed"
    '
}

setup_x11() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        info "Configuring X11 for macOS (XQuartz)..." >&2

        # 检查 XQuartz 是否运行
        if ! pgrep -x "XQuartz" > /dev/null; then
            warn "XQuartz is not running. Starting XQuartz..." >&2
            open -a XQuartz
            sleep 3
        fi

        # 获取本机 IP
        HOST_IP=$(ifconfig en0 | grep inet | awk '$1=="inet" {print $2}')
        if [ -z "$HOST_IP" ]; then
            HOST_IP=$(ifconfig en1 | grep inet | awk '$1=="inet" {print $2}')
        fi

        if [ -z "$HOST_IP" ]; then
            warn "Could not detect host IP, X11 may not work" >&2
            HOST_IP="host.docker.internal"
        fi

        # 允许 X11 连接
        xhost + > /dev/null 2>&1 || warn "xhost command failed" >&2

        DISPLAY_VAR="$HOST_IP:0"

        # 创建 .Xauthority 文件
        XAUTH=/tmp/.docker.xauth
        touch $XAUTH
        xauth nlist $DISPLAY 2>/dev/null | sed -e 's/^..../ffff/' | xauth -f $XAUTH nmerge - 2>/dev/null || true

        echo "$DISPLAY_VAR"
    else
        # Linux: 宿主本机 X server
        info "Configuring X11 for Linux..." >&2

        # 宿主 shell 没有 DISPLAY 时(SSH/cron 等)回退到 :0
        local display_var="${DISPLAY:-:0}"

        # 授权本地容器 root 访问 X server (仅在 X server 可达时)
        if command -v xhost > /dev/null 2>&1; then
            DISPLAY="$display_var" xhost +local:root > /dev/null 2>&1 \
                || warn "xhost +local:root failed (X server 未运行? 宿主 DISPLAY=$display_var)" >&2
        else
            warn "xhost 未安装，容器 GUI 可能无法连接 X server (apt install x11-xserver-utils)" >&2
        fi

        # 生成 .docker.xauth 供容器挂载
        local XAUTH=/tmp/.docker.xauth
        touch "$XAUTH"
        if command -v xauth > /dev/null 2>&1; then
            xauth nlist "$display_var" 2>/dev/null \
                | sed -e 's/^..../ffff/' \
                | xauth -f "$XAUTH" nmerge - 2>/dev/null || true
        fi
        chmod 644 "$XAUTH" 2>/dev/null || true

        echo "$display_var"
    fi
}

case "$1" in
    build)
        show_banner

        info "Building custom Docker image: $CUSTOM_IMAGE_NAME"
        info "This may take a few minutes..."

        # 构建镜像
        docker build -f "$PROJECT_ROOT/Dockerfile.dev" -t "$CUSTOM_IMAGE_NAME" "$PROJECT_ROOT"


        if [ $? -eq 0 ]; then
            info ""
            info "✅ Image built successfully: $CUSTOM_IMAGE_NAME"
            info ""
            info "Next steps:"
            info "  ./docker_dev.sh start    # Start container with the new image"
        else
            error "Failed to build image"
            exit 1
        fi
        ;;

    start)
        show_banner

        # 检查容器是否已存在
        if docker ps -a | grep -q "$CONTAINER_NAME"; then
            warn "Container already exists. Use 'restart' to recreate or 'shell' to enter."
            exit 1
        fi

        # 检查是否存在自定义镜像
        if docker images | grep -q "^piper_dev.*latest"; then
            IMAGE_NAME="$CUSTOM_IMAGE_NAME"
            info "Using custom image: $IMAGE_NAME"
        else
            IMAGE_NAME="$BASE_IMAGE_NAME"
            info "Using base image: $IMAGE_NAME"
            warn "Tip: Run './docker_dev.sh build' to create a custom image with pre-installed dependencies"
        fi

        info "Starting Piper development container..."

        # 设置 X11
        DISPLAY_VAR=$(setup_x11)
        XAUTH=/tmp/.docker.xauth

        # 检测 USB 串口设备、摄像头、Quest USB
        USB_DEVICES=""
        DOCKER_EXTRA_ARGS=""

        if [ "$(uname)" = "Darwin" ]; then
            # macOS: Docker Desktop 不支持直接映射 /dev/tty.* 设备
            # 需要使用 socat 或其他方法转发串口
            warn "macOS detected: USB serial device passthrough requires additional setup"
            warn "Please use one of these methods:"
            warn "  1. Use socat to forward serial port to TCP"
            warn "  2. Run robot_controller directly on macOS (outside Docker)"
            warn "  3. Use Linux VM with USB passthrough"
            info ""
            info "Available serial devices on host:"
            for device in /dev/tty.usb* /dev/cu.usb* /dev/tty.wchusbserial* /dev/cu.wchusbserial*; do
                if [ -e "$device" ]; then
                    info "  - $device"
                fi
            done
            info ""
        else
            # Linux: 查找串口设备
            for device in /dev/ttyUSB* /dev/ttyACM*; do
                if [ -e "$device" ]; then
                    USB_DEVICES="$USB_DEVICES --device=$device"
                    info "Found serial device: $device"
                fi
            done

            # Linux: 查找摄像头设备
            for device in /dev/video*; do
                if [ -e "$device" ]; then
                    USB_DEVICES="$USB_DEVICES --device=$device"
                    info "Found camera device: $device"
                fi
            done

            # Linux: 转发 USB 总线（用于 adb 访问 Quest）
            if [ -d "/dev/bus/usb" ]; then
                USB_DEVICES="$USB_DEVICES -v /dev/bus/usb:/dev/bus/usb"
                DOCKER_EXTRA_ARGS="--privileged"
                info "USB bus forwarded for adb access"
            fi

            if [ -z "$USB_DEVICES" ]; then
                warn "No USB devices found on Linux"
            fi
        fi

        # 启动容器
        docker run -d \
            --name "$CONTAINER_NAME" \
            --network host \
            -e DISPLAY="$DISPLAY_VAR" \
            -e XAUTHORITY=/tmp/.docker.xauth \
            -e ADB_SERVER_SOCKET=tcp:127.0.0.1:5037 \
            -v "$PROJECT_ROOT:/workspace" \
            -v /tmp/.X11-unix:/tmp/.X11-unix:rw \
            -v $XAUTH:/tmp/.docker.xauth:rw \
            -w /workspace \
            $USB_DEVICES \
            $DOCKER_EXTRA_ARGS \
            "$IMAGE_NAME" \
            sleep infinity

        info "Container started: $CONTAINER_NAME"
        info "DISPLAY: $DISPLAY_VAR"
        info "Ports: 5200-5280, 8080"


        info ""
        info "✅ Development environment ready!"
        info ""
        info "Next steps:"
        info "  1. Enter shell:  ./docker_dev.sh shell"
        info "  2. Build ros_interface:  cd /workspace/ros_interface && bash build.sh"
        info "  3. Run teleop:  cd /workspace/teleop && ./scripts/docker_run_teleop.sh"
        info "  4. Run controller:  cd /workspace/robot_controller && ./scripts/docker_run_controller.sh"
        ;;

    stop)
        info "Stopping container..."
        docker stop "$CONTAINER_NAME" 2>/dev/null || true
        docker rm "$CONTAINER_NAME" 2>/dev/null || true
        rm -f /tmp/.docker.xauth 2>/dev/null || true
        info "Container stopped and removed"
        ;;

    restart)
        $0 stop
        sleep 1
        $0 start
        ;;

    shell)
        if ! docker ps | grep -q "$CONTAINER_NAME"; then
            error "Container is not running. Start it first with: ./docker_dev.sh start"
            exit 1
        fi

        info "Entering container shell..."
        docker exec -it "$CONTAINER_NAME" bash
        ;;

    teleop)
        if ! docker ps | grep -q "$CONTAINER_NAME"; then
            error "Container is not running. Start it first with: ./docker_dev.sh start"
            exit 1
        fi

        info "Starting teleop..."
        docker exec -it "$CONTAINER_NAME" bash -c "cd /workspace/teleop && ./scripts/docker_run_teleop.sh"
        ;;

    controller)
        if ! docker ps | grep -q "$CONTAINER_NAME"; then
            error "Container is not running. Start it first with: ./docker_dev.sh start"
            exit 1
        fi

        info "Starting robot_controller..."
        docker exec -it "$CONTAINER_NAME" bash -c "cd /workspace/robot_controller && ./scripts/docker_run_controller.sh"
        ;;

    logs)
        if ! docker ps | grep -q "$CONTAINER_NAME"; then
            error "Container is not running"
            exit 1
        fi

        case "$2" in
            teleop)
                info "Showing teleop logs..."
                docker exec "$CONTAINER_NAME" tail -f /workspace/teleop/logs/teleop_latest.log 2>/dev/null || \
                    warn "No teleop logs found"
                ;;
            controller)
                info "Showing controller logs..."
                docker exec "$CONTAINER_NAME" tail -f /workspace/robot_controller/logs/controller_latest.log 2>/dev/null || \
                    warn "No controller logs found"
                ;;
            *)
                error "Usage: $0 logs {teleop|controller}"
                exit 1
                ;;
        esac
        ;;

    status)
        show_banner

        if docker ps | grep -q "$CONTAINER_NAME"; then
            info "✅ Container is running"
            echo ""
            docker ps | grep "$CONTAINER_NAME"
            echo ""
            info "Environment:"
            docker exec "$CONTAINER_NAME" bash -c 'echo "  DISPLAY=$DISPLAY"'
            docker exec "$CONTAINER_NAME" bash -c 'echo "  XAUTHORITY=$XAUTHORITY"'
            echo ""
            info "ROS2 topics:"
            docker exec "$CONTAINER_NAME" bash -c 'source /opt/ros/humble/setup.bash && ros2 topic list 2>/dev/null' || \
                warn "  No ROS2 topics (services not running)"
        else
            warn "❌ Container is not running"
            info "Start with: ./docker_dev.sh start"
        fi
        ;;

    test-x11)
        if ! docker ps | grep -q "$CONTAINER_NAME"; then
            error "Container is not running"
            exit 1
        fi

        info "Testing X11 connection..."
        docker exec -it "$CONTAINER_NAME" bash -c '
            apt-get update > /dev/null 2>&1
            apt-get install -y x11-apps > /dev/null 2>&1
            echo "Launching xeyes (close the window to continue)..."
            xeyes
        '
        ;;

    build-ros)
        if ! docker ps | grep -q "$CONTAINER_NAME"; then
            error "Container is not running"
            exit 1
        fi

        info "Building ros_interface..."
        docker exec -it "$CONTAINER_NAME" bash -c "cd /workspace/ros_interface && bash build.sh"
        ;;

    clean)
        info "Cleaning up..."
        $0 stop
        info "Removing build artifacts..."
        rm -rf "$PROJECT_ROOT/ros_interface/.colcon" 2>/dev/null || true
        rm -rf "$PROJECT_ROOT/ros_interface/install" 2>/dev/null || true
        rm -rf "$PROJECT_ROOT/ros_interface/build" 2>/dev/null || true
        rm -rf "$PROJECT_ROOT/ros_interface/log" 2>/dev/null || true
        info "Cleanup complete"
        ;;

    *)
        show_banner
        echo "Usage: $0 {build|start|stop|restart|shell|teleop|controller|logs|status|test-x11|build-ros|clean}"
        echo ""
        echo "Commands:"
        echo "  build        - Build custom Docker image with pre-installed dependencies"
        echo "  start        - Start development container (uses custom image if available)"
        echo "  stop         - Stop and remove container"
        echo "  restart      - Restart container"
        echo "  shell        - Enter container shell"
        echo "  teleop       - Run teleop service"
        echo "  controller   - Run robot_controller service"
        echo "  logs         - Show logs (teleop|controller)"
        echo "  status       - Show container and ROS2 status"
        echo "  test-x11     - Test X11 connection with xeyes"
        echo "  build-ros    - Build ros_interface package"
        echo "  clean        - Stop container and clean build artifacts"
        echo ""
        echo "Workflow:"
        echo "  1. ./docker_dev.sh build          # Build custom image (first time or after updates)"
        echo "  2. ./docker_dev.sh start          # Start container (fast with custom image)"
        echo "  3. ./docker_dev.sh shell          # Enter shell"
        echo "  4. ./docker_dev.sh build-ros      # Build ROS2 messages"
        echo "  5. ./docker_dev.sh teleop         # Run teleop"
        echo ""
        echo "Examples:"
        echo "  ./docker_dev.sh build              # Build image with dependencies"
        echo "  ./docker_dev.sh start              # Start container"
        echo "  ./docker_dev.sh shell              # Enter shell"
        echo "  ./docker_dev.sh build-ros          # Build ROS2 messages"
        echo "  ./docker_dev.sh teleop             # Run teleop"
        echo "  ./docker_dev.sh controller         # Run controller"
        echo "  ./docker_dev.sh logs teleop        # View teleop logs"
        echo ""
        exit 1
        ;;
esac
