# Piper（笛音）

**居家机器人遥操作系统** — 温和的引导者，智能的陪伴者

## 项目概述

Piper 是一个完整的机器人遥操作系统，支持 VR 遥操作和未来的模型推理控制。名字来源于"吹笛者"（Piper），象征着引导、陪伴和温和的特质。

## 子项目

```
piper/
├── teleop/              # 遥操作服务（原 vr_robot_bridge）
├── robot_controller/    # 机器人控制层
├── camera_service/      # 相机服务（独立）
├── ros_interface/       # ROS2 消息定义
├── vr_tracker_quest/    # Quest VR 应用
└── robot_web_console/   # Web 控制台
```

## 核心特性

- **VR 遥操作**：Meta Quest 3/3S 6DoF 姿态控制
- **绝对位姿控制**：状态反馈闭环，避免累积误差
- **ExecutionBackend 架构**：支持从舵机直接控制平滑演进到运控系统
- **热加载配置**：HTTP API 动态修改参数
- **模块化设计**：清晰的职责分离，易于扩展

## 快速开始

**新的统一开发环境** 🎉

```bash
# 1. 启动开发容器（自动配置源和依赖）
./docker_dev.sh start

# 2. 构建 ROS2 消息
./docker_dev.sh build-ros

# 3. 运行 teleop（终端 1）
./docker_dev.sh teleop

# 4. 运行 robot_controller（终端 2）
./docker_dev.sh controller

# 5. Quest 上启动 VR Tracker 应用
```

详见 [DOCKER_DEV.md](./DOCKER_DEV.md) 完整文档。

### 旧方式（已废弃）

<details>
<summary>点击展开旧的启动方式</summary>

```bash
# 1. 启动遥操作服务
cd teleop
./scripts/docker_debug.sh start
./scripts/docker_debug.sh shell
cd /workspace/teleop
./scripts/docker_run_teleop.sh

# 2. 启动机器人控制器
cd robot_controller
./scripts/docker_debug.sh start
./scripts/docker_debug.sh shell
cd /workspace/robot_controller
./scripts/docker_run_controller.sh

# 3. Quest 上启动 VR Tracker 应用
```

</details>

## 架构设计

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)

**两层 Robot 分离**：
- **硬件 Robot**（robot_controller）：连接电机、执行命令、发布状态
- **软件 Robot**（未来）：订阅状态、读取图像、发布命令

**数据流**：
```
Quest VR → teleop → mix_robot_cmd → robot_controller → 硬件
                ↑                                    ↓
                └──────────── robot/state ───────────┘
```

## 文档

- [DOCKER_DEV.md](./DOCKER_DEV.md) - **开发环境快速开始** ⭐
- [CLAUDE.md](./CLAUDE.md) - 项目指南和架构说明
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 系统架构详解
- [teleop/README.md](./teleop/README.md) - 遥操作服务文档
- [robot_controller/README.md](./robot_controller/README.md) - 控制器文档
- [robot_controller/README_URDF_MOCK.md](./robot_controller/README_URDF_MOCK.md) - URDF 模拟后端

## 技术栈

- **ROS2 Humble** - 机器人操作系统
- **Python 3.10+** - 主要开发语言
- **Unity + OpenXR** - VR 应用开发
- **Docker** - 开发环境容器化

## 项目命名

**Piper**（笛音）— 吹笛者，引导者
- 温和但不失活泼
- 有音乐感、轻快
- 引导、陪伴的含义
- 适合居家机器人的温暖形象

## License

[待定]

## 贡献

[待定]
