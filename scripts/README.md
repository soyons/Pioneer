# 脚本入口

平台运行统一使用根目录入口：

```bash
./scripts/platform.sh start       # 启动 Web Console、Coach、Controller 和相机
./scripts/platform.sh status
./scripts/platform.sh restart
./scripts/platform.sh stop
```

各模块的 `scripts/` 只保留模块专用工具，启动脚本统一使用 `start*.sh` 命名：

| 模块 | 入口 | 用途 |
| --- | --- | --- |
| `camera_service` | `scripts/start.sh` | 启动相机 ROS 服务 |
| `coach` | `scripts/start.sh` | 启动 Coach 示教与录制服务 |
| `robot_controller` | `scripts/start.sh` | 启动真实机器人控制器 |
| `robot_controller` | `scripts/start_urdf_rviz.sh` | 启动虚拟 URDF 和 RViz |
| `robot_controller` | `scripts/start_with_rviz.sh` | 启动控制器并发布 RViz 状态 |
| `vr_tracker_quest` | `scripts/start.sh` | 启动 Quest 接收器 |
| `vr_tracker_quest` | `scripts/start_visualizer.sh` | 启动 3D 可视化 |
| `vr_tracker_quest` | `scripts/start_curves.sh` | 启动曲线可视化 |

分析、测试和数据转换脚本按功能保留在对应模块中，例如
`coach/scripts/convert_rosbag_to_lerobot.py`。
