# Robot Web Console

统一 Web 控制台 - 管理整个机器人系统(相机、遥操、控制器)

## 架构

```
robot_web_console (:3000)
    ├─ 服务监控 (每 2s 轮询 health)
    ├─ 反向代理
    │   ├─ /api/camera/*  → camera_service:8082
    │   ├─ /api/teleop/*  → teleop:8080
    │   └─ /api/robot/*   → robot_controller:8081
    └─ 前端静态文件
```

## 快速开始

### 1. 安装依赖

```bash
cd robot_web_console
pip install -r requirements.txt
```

### 2. 启动(生产模式)

推荐使用统一脚本启动整个平台:

```bash
cd /workspace
./scripts/platform.sh start
```

没有相机时脚本会自动跳过 camera_service，仍启动 Coach、Controller 和 Web Console。
也可以显式使用 `NO_CAMERA=1 ./scripts/platform.sh start`；插入相机后用
`FORCE_CAMERA=1 ./scripts/platform.sh restart` 强制检查并启动相机。

访问: http://localhost:3000。常用管理命令:

```bash
./scripts/platform.sh status
./scripts/platform.sh restart
./scripts/platform.sh stop
```

也可以只启动/重启 Camera、Coach、Controller，保持当前 Web Console 不断开:

```bash
./scripts/platform.sh restart-services
```

旧的分步方式仍然可用:

```bash
./scripts/start_all.sh

cd robot_web_console
PYTHONPATH=. python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 3000
```

访问: http://localhost:3000

### 3. 配置

编辑 `config/default.yaml`:

```yaml
mode: production  # 或 development

console:
  host: "0.0.0.0"
  port: 3000

services:
  camera:
    api_url: "http://localhost:8082"
  teleop:
    api_url: "http://localhost:8080"
  robot:
    api_url: "http://localhost:8081"
```

## API 端点

### Console 管理

- `GET /api/health` — 健康检查
- `GET /api/info` — Console 信息
- `GET /api/services/status` — 所有服务状态
- `GET /api/services/status/{service_key}` — 单个服务状态
- `POST /api/services/check` — 手动触发健康检查

### 反向代理

所有请求自动转发到后端服务:

- `/api/camera/*` → camera_service
- `/api/teleop/*` → teleop
- `/api/robot/*` → robot_controller

示例:

```bash
# 获取相机列表(转发到 camera_service)
curl http://localhost:3000/api/camera/cameras

# 获取机器人状态(转发到 robot_controller)
curl http://localhost:3000/api/robot/status

# 更新遥操配置(转发到 teleop)
curl -X PATCH http://localhost:3000/api/teleop/config \
  -H "Content-Type: application/json" \
  -d '{"smoothing": 0.8}'
```

## 开发

### 运行测试

```bash
pytest tests/
```

### 本地开发(热重载)

```bash
cd robot_web_console
uvicorn backend.main:app --reload --host 0.0.0.0 --port 3000
```

### 目录结构

```
robot_web_console/
├── backend/
│   ├── main.py              # FastAPI 入口
│   ├── config.py            # 配置加载
│   ├── routes/
│   │   ├── services.py      # 服务管理路由
│   │   └── proxy.py         # 反向代理路由
│   └── services/
│       ├── monitor.py       # 健康检查监控
│       └── proxy.py         # 代理工具
├── frontend/                # 前端静态文件
│   ├── index.html           # 多模块导航 + 三灯状态栏
│   ├── css/
│   │   ├── style.css        # 基础样式(从 robot_controller 迁移)
│   │   └── console.css      # 三灯/相机/遥操页面样式
│   └── js/
│       ├── api.js           # API 客户端(robot/camera/teleop 三前缀)
│       ├── main.js          # 页面路由
│       ├── cameras.js       # 相机管理页面
│       ├── teleop.js        # 遥操控制页面
│       ├── services_monitor.js  # 三灯状态轮询
│       ├── config.js / calibration.js / diagnostics.js  # robot 模块页面
├── config/
│   └── default.yaml         # 配置文件
├── requirements.txt
└── start.sh
```

### 前端模块

| Tab | 模块 | 数据来源 |
|-----|------|---------|
| Status / Jog / Presets / Calibration / Diagnostics / Config | robot | `/api/robot/*` → robot_controller |
| 📷 Cameras | camera | `/api/camera/*` → camera_service |
| 🥽 Teleop | teleop | `/api/teleop/*` → teleop |

Status 页的“平台工具”可一键启动或重启 Camera、Coach、Controller；
Depot 页的“ROS → LeRobot 批量转换”会在后台运行
`coach/scripts/rosbag_to_lerobot.py --all`，并显示转换日志。

顶部三灯状态栏(Camera / Teleop / Robot)每 2 秒轮询 `/api/services/status`。

## 故障排查

### 服务显示离线

1. 确认后端服务已启动:
   ```bash
   curl http://localhost:8082/api/health  # camera
   curl http://localhost:8080/api/health  # teleop
   curl http://localhost:8081/api/status  # robot
   ```

2. 检查防火墙/端口占用

3. 查看 console 日志

### 代理请求失败

- 检查 `config/default.yaml` 里的 `api_url` 是否正确
- 确认目标服务的 API endpoint 存在
- 查看 FastAPI 自动文档: http://localhost:3000/docs
