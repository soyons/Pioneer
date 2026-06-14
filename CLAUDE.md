# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Piper（笛音）** — 居家机器人遥操作系统，将Meta Quest 3/3S的6DoF姿态数据转换为机器人控制指令，通过ROS2发布。

六个子项目：
- **vr_tracker_quest**: Unity Android应用，运行在Quest上，读取VR追踪数据并通过TCP发送
- **teleop**: Python遥操作服务，接收VR数据，订阅robot/state，计算绝对位姿，发布mix_robot_cmd
- **robot_controller**: 机器人控制层，订阅mix_robot_cmd（绝对位姿），执行硬件控制，发布状态反馈
- **camera_service**: 相机服务，独立的相机采集模块，支持多种相机类型
- **ros_interface**: ROS2消息定义包，定义 `MixRobotCmd`、`RobotState` 等标准消息格式
- **robot_web_console**: Web控制台（独立项目），管理遥操参数和机器人运控参数

## Architecture

```
Quest 3S (vr_tracker_quest)
  Unity APK → TCP JSON over USB
       ↓ adb reverse tcp:5200 tcp:5201
Docker Container (ROS2 Humble)
  ┌─────────────────────────────────────────────┐
  │ teleop                                      │
  │   TCP Receiver → Command Builder            │
  │        ↓                    ↑                │
  │   订阅 robot/state    计算绝对位姿           │
  │        ↓                                     │
  │   发布 mix_robot_cmd (绝对位姿)              │
  └─────────────────┬───────────────────────────┘
                    ↓
  ┌─────────────────────────────────────────────┐
  │ robot_controller                            │
  │   订阅 mix_robot_cmd (绝对位姿)              │
  │        ↓                                     │
  │   Hardware Interface (Mock/Real)            │
  │        ↓                                     │
  │   发布 robot/state, robot/camera/*,         │
  │        robot/joint_states                   │
  └─────────────────────────────────────────────┘
```

## Core Design Principles

1. **绝对位姿控制**: VR/模型层订阅robot/state，计算绝对目标位姿，发布mix_robot_cmd
2. **状态反馈闭环**: robot_controller维护真实状态，发布robot/state供上游使用
3. **单一topic**: 头/双手/底盘打包为一帧 `MixRobotCmd` 发送
4. **固定频率**: Bridge 60Hz输出，Controller 100Hz控制，State 30Hz反馈
5. **热加载配置**: HTTP API修改参数即时生效
6. **项目分离**: Bridge负责意图计算，Controller负责硬件执行
7. **通用命名**: 消息/包名描述机器人动作，不绑定输入来源（遥操/推理/自主控制通用）

## ROS2 Message Format (ros_interface)

### 命令消息（下行）

Topic: `mix_robot_cmd` (类型: `ros_interface/MixRobotCmd`)

```
MixRobotCmd:  # 注意：这里是绝对目标位姿，不是增量
  header
  left_arm:   ArmCmd {enabled, position(xyz), rotation(qxyzw), gripper}
  right_arm:  ArmCmd {enabled, position(xyz), rotation(qxyzw), gripper}
  torso:      TorsoCmd {enabled, position(xyz), rpy(xyz)}
  chassis:    Twist {linear(xyz), angular(xyz)}
  btn_x, btn_y, btn_a, btn_b, left_stick_click, right_stick_click, menu
```

### 状态消息（上行）

Topic: `robot/state` (类型: `ros_interface/RobotState`)

```
RobotState:
  header
  left_arm:   ArmState {connected, current_pose, joint_angles[], gripper_position}
  right_arm:  ArmState {connected, current_pose, joint_angles[], gripper_position}
  torso:      TorsoState {connected, current_pose, rpy}
  chassis:    ChassisState {connected, current_pose, current_velocity, battery_voltage}
  mode:       string ("idle", "teleop", "auto")
  emergency_stop: bool
  battery_level: float32
```

Topic: `robot/joint_states` (类型: `sensor_msgs/JointState`)

Topic: `robot/camera/*` (类型: `sensor_msgs/Image`)

## Controller Mapping (Quest 3S)

```
LEFT Controller:              RIGHT Controller:
  Joystick X → 底盘旋转        Joystick X → 底盘左右平移
  Joystick Y → (保留)          Joystick Y → 底盘前后移动
  Trigger → 左手抓取            Trigger → 右手抓取
  Grip → 左臂使能               Grip → 右臂使能
  X Button → (自定义)           A Button → (自定义)
  Y Button → (自定义)           B Button → (自定义)
  Menu → torso使能切换
```

## VR JSON Data Format

Quest发送的原始TCP数据（每帧一行JSON）：
```json
{
  "t": 141982,
  "head": {"pos": [x,y,z], "rot": [qx,qy,qz,qw]},
  "left": {"pos": [x,y,z], "rot": [qx,qy,qz,qw], "trigger": 0.0, "grip": 0.0, "btnA": false, "btnB": false, "stickX": 0.0, "stickY": 0.0, "stickClick": false, "menu": false, "connected": true},
  "right": { ... }
}
```

注意：左手 btnA=X键, btnB=Y键；右手 btnA=A键, btnB=B键。

当前桥接语义：`torso` 字段承载 torso 命令，由头显相对参考点的位姿生成。启用后首次捕获头显参考点，之后头显平移映射到 `torso.position`，头显相对旋转映射到 `torso.rpy`。默认由左手 Menu 键切换 torso 使能。

## Quick Start

### 环境要求
- Docker Desktop (Mac)
- adb (`brew install android-platform-tools`)
- Meta Quest 3/3S（开发者模式）

### 启动步骤

```bash
# 1. 启动Docker开发容器（自动检测Quest USB + adb端口转发）
cd teleop
./scripts/docker_debug.sh start

# 2. 进入容器
./scripts/docker_debug.sh shell

# 3. 容器内运行teleop（首次自动编译ros_interface）
cd /workspace/teleop
./scripts/docker_run_teleop.sh

# 4. 另一个终端启动 robot_controller
cd robot_controller
./scripts/docker_debug.sh start
./scripts/docker_debug.sh shell
cd /workspace/robot_controller
./scripts/docker_run_controller.sh

# 5. Quest上启动VR Tracker应用

# 6. 查看topic
ros2 topic echo mix_robot_cmd
ros2 topic echo robot/state
ros2 topic list | grep robot/camera
```

### 开发迭代

```bash
# Mac上修改代码后，容器内Ctrl+C停止teleop，重新运行
./scripts/docker_run_teleop.sh

# 修改了msg文件后，重新编译
cd /workspace/ros_interface
bash build.sh
```

### ros_interface编译

```bash
# 容器内
cd /workspace/ros_interface
bash build.sh    # 编译并自动追加到~/.bashrc

# 验证
python3 -c "from ros_interface.msg import MixRobotCmd; print(MixRobotCmd())"
```

## Project Structure

```
piper/
├── ros_interface/              # ROS2工作空间目录
│   ├── ros_interface/          # ROS2消息定义包
│   │   ├── msg/
│   │   │   ├── ArmCmd.msg
│   │   │   ├── TorsoCmd.msg
│   │   │   ├── MixRobotCmd.msg
│   │   │   ├── ArmState.msg
│   │   │   ├── TorsoState.msg
│   │   │   ├── ChassisState.msg
│   │   │   └── RobotState.msg
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   └── README.md
│   ├── build.sh                # 编译脚本
│   ├── .colcon/                # 编译产物（git忽略）
│   └── log/                    # 编译日志（git忽略）
│
├── teleop/                     # 遥操作服务
│   ├── src/teleop/
│   │   ├── __main__.py         # 入口
│   │   ├── data_types.py       # 数据结构
│   │   ├── coordinate.py       # 坐标系转换
│   │   ├── config_manager.py   # 配置管理（热加载）
│   │   ├── tcp_receiver.py     # TCP接收VR数据
│   │   ├── command_builder.py  # 状态积分+绝对位姿计算
│   │   ├── publisher.py        # 定频ROS发布
│   │   ├── api_server.py       # HTTP API
│   │   └── health_checker.py   # 健康检查
│   ├── config/
│   │   └── default_config.yaml
│   ├── start_teleop.sh         # 后续由 web console 调用的正式启动入口
│   ├── scripts/
│   │   ├── docker_run_teleop.sh # 容器内本地调试入口
│   │   └── docker_debug.sh      # Docker 本地调试容器脚本
│   └── unit_test/
│
├── robot_controller/           # 机器人控制层
│   ├── src/robot_controller/
│   │   ├── __main__.py         # 入口
│   │   ├── data_types.py       # 数据结构
│   │   ├── command_subscriber.py  # 订阅 mix_robot_cmd
│   │   ├── state_publisher.py     # 发布状态反馈
│   │   ├── execution_backends/    # 执行后端
│   │   │   ├── base_backend.py
│   │   │   ├── direct_control_backend.py
│   │   │   └── motion_system_backend.py
│   │   ├── robots/                # 机器人模型
│   │   │   ├── robot.py
│   │   │   ├── bi_so_follower/
│   │   │   └── so_follower/
│   │   └── motors/                # 电机驱动
│   │       ├── motors_bus.py
│   │       ├── feetech/
│   │       ├── dynamixel/
│   │       ├── robstride/
│   │       └── damiao/
│   ├── config/
│   │   └── backend_config.yaml
│   ├── scripts/
│   │   ├── docker_run_controller.sh
│   │   └── docker_debug.sh
│   └── tests/
│
├── camera_service/             # 相机服务（独立）
│   ├── src/camera_service/
│   │   ├── camera.py           # 相机基类
│   │   ├── configs.py          # 配置管理
│   │   ├── utils.py            # 工具函数
│   │   ├── opencv/             # OpenCV 相机
│   │   ├── realsense/          # RealSense 相机
│   │   ├── reachy2_camera/     # Reachy2 相机
│   │   └── zmq/                # ZMQ 相机
│   ├── config/
│   │   └── default_config.yaml
│   └── README.md
│
├── vr_tracker_quest/           # Quest Unity应用
│
├── robot_web_console/          # Web控制台（独立项目）
│
└── CLAUDE.md                   # 本文件
```

## Coordinate System

- Unity (左手系): X=right, Y=up, Z=forward
- ROS (右手系): X=forward, Y=left, Z=up
- 转换: ROS_X=Unity_Z, ROS_Y=-Unity_X, ROS_Z=Unity_Y
- 坐标转换在bridge内完成，在计算delta之后进行

## HTTP API (teleop)

```
GET  /api/config                  # 获取配置
PATCH /api/config                 # 更新配置（热加载）
GET  /api/status                  # 系统状态
POST /api/teleop/reset_reference  # 重置参考原点
GET  /api/health                  # 健康检查
```

## Docker容器管理

```bash
./scripts/docker_debug.sh start    # 启动容器
./scripts/docker_debug.sh stop     # 停止容器
./scripts/docker_debug.sh restart  # 重启容器
./scripts/docker_debug.sh shell    # 进入容器
./scripts/docker_debug.sh logs     # 查看最新 teleop 日志
./scripts/docker_debug.sh status   # 查看状态
```

## Debugging

```bash
# 查看VR连接
adb devices -l

# 查看端口转发
adb reverse --list

# 容器内查看topic
ros2 topic list
ros2 topic echo mix_robot_cmd
ros2 topic echo robot/state
ros2 topic hz mix_robot_cmd
ros2 topic hz robot/state

# 查看相机图像
ros2 topic list | grep camera
ros2 topic hz robot/camera/front
ros2 run image_view image_view --ros-args --remap image:=/robot/camera/front

# rqt可视化
rqt_plot /mix_robot_cmd/left_arm/position/x
rqt_image_view

# 查看日志
tail -f teleop/logs/teleop_latest.log
tail -f robot_controller/logs/controller_latest.log

# HTTP API
curl http://localhost:8080/api/status
curl http://localhost:8080/api/config
```
