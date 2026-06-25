# Changelog - VR Connection Integration & Coach Tooling

## 概述

将 Web Console 的 VR 连接管理整合到 Coach 页面，并为 Quest 设备配置创建完整的工具链。

**发布日期:** 2026-06-24  
**分支:** `feat/web-console-and-integration`  
**相关 Commit:**
- Coach Submodule: `8786238`
- 主仓库: `e196de2`, `8780844`

---

## 主要变更

### 1. Quest VR 连接配置工具 (Coach Submodule)

#### 新增文件

- **`scripts/setup_quest.sh`** (236 行)
  - 一键配置 Quest VR 连接环境
  - 自动检测设备 (`adb devices -l`)
  - 配置端口转发 (`adb reverse tcp:5200 tcp:5201`)
  - 防熵屏设置（屏幕超时 + 近距离传感器 + VR 模式）
  - 彩色输出和详细的状态反馈
  - 完整的错误处理和故障排查提示

- **`scripts/README_QUEST_SETUP.md`** (421 行)
  - 详细的 Quest 配置指南
  - 6 种使用场景说明
  - 6 个常见问题排查
  - 完整的命令参考（adb devices、adb reverse 系列）
  - 手动配置步骤（脚本失败时的备选方案）

- **`scripts/QUICK_REFERENCE.md`** (115 行)
  - 快速参考卡片
  - 常用命令速查表
  - 故障速查表
  - 验证连接清单
  - 完整启动流程

#### 脚本重命名

- `scripts/docker_run_teleop.sh` → `scripts/start.sh`
- 删除 `scripts/start_teleop.sh` (已废弃)

#### 配置更新

- `config/default_config.yaml`
  - 更新端口配置
  - 服务名称调整

- `src/coach/api_server.py`
  - API 端点路径更新
  - 添加 VR 状态查询端点

- `src/coach/inputs/vr_receiver.py`
  - VR 数据接收器优化

---

### 2. Web Console VR 管理整合

#### UI/UX 变更

**移除顶部 VR 按钮:**
- 从顶部导航栏移除独立的 VR 连接按钮 (`vrConnectBtn`)
- VR 连接管理整合到 Coach 页面内

**Teleop → Coach 全局改名:**
- 三灯状态栏: "Teleop" → "Coach"
- 页面标题: "🥽 Teleop Service" → "🎮 Coach Service"
- 占位页签: "🎮 Teleop Data" → "🎮 Coach Data"
- 服务显示名: "Teleop Service" → "Coach"
- Tooltip: "Teleop Service - 点击查看详情" → "Coach Service - 点击查看详情"

**新增 VR 连接管理卡片 (Coach 页面内):**
```
╭─────────────────────────────────────╮
│ 🥽 VR 连接管理                      │
├─────────────────────────────────────┤
│ ● VR 已连接 (Quest 3)               │
│ 端口转发已配置，数据流正常           │
│                                     │
│ [检查连接] [重置参考点] [显示数据]  │
│                                     │
│ Quest 设置步骤: ...                 │
╰─────────────────────────────────────╯
```

特性:
- 实时状态指示器（绿/黄/红圆点）
- 设备序列号显示
- 一键连接/断开按钮
- 自动状态轮询（3秒间隔）
- 实时 VR 数据可视化（头显 + 双手控制器）

#### 前端修改

**`frontend/index.html`:**
- 移除 `<button class="vr-connect-btn" id="vrConnectBtn">` 及其内容
- 三灯状态栏标签更新：
  ```html
  <div class="service-light" data-service="teleop" title="Coach Service - 点击查看详情">
    <span class="status-dot"></span>
    <span class="service-label">Coach</span>
  </div>
  ```
- 移除 `<script src="/js/vr_connection.js"></script>` 加载

**`frontend/js/teleop.js`:** (新增 ~200 行)
- 整合 `VRConnectionManager` 的所有功能
- 新增方法:
  - `updateVRStatus()` - VR 状态轮询
  - `renderVRStatus(status)` - 状态渲染
  - `handleVRToggle()` - 连接/断开处理
  - `showManualCommandDialog(result)` - 手动命令弹窗
- 三个定时器管理:
  - `refreshTimer` - Coach 服务状态（2秒）
  - `vrStatusTimer` - VR 连接状态（3秒）
  - `vrDataTimer` - VR 实时数据（100ms，按需启动）

**保留兼容性:**
- `frontend/js/vr_connection.js` 文件保留（已废弃，不加载）
- `frontend/css/style.css` 中 VR 按钮样式保留

#### 后端修改

**新增文件: `backend/routes/system.py`** (~200 行)

新增 API 端点:

1. **GET `/api/system/vr/status`**
   - 检查 Quest 设备连接状态
   - 验证 adb reverse 端口转发
   - 返回设备序列号、型号、连接状态

   响应示例:
   ```json
   {
     "device_connected": true,
     "port_forwarded": true,
     "device_serial": "1WMHH8A123456",
     "device_model": "Quest 3",
     "error": null
   }
   ```

2. **POST `/api/system/vr/connect`**
   - 配置 adb reverse tcp:5200 tcp:5201
   - 自动清除旧规则
   - 验证配置成功

   响应示例:
   ```json
   {
     "success": true,
     "message": "端口转发配置成功",
     "manual_command": null
   }
   ```

   失败时返回手动命令:
   ```json
   {
     "success": false,
     "message": "自动配置失败，请在宿主机上手动执行：",
     "manual_command": "adb reverse tcp:5200 tcp:5201",
     "error": "adb: command not found"
   }
   ```

3. **POST `/api/system/vr/disconnect`**
   - 移除端口转发规则 (`adb reverse --remove tcp:5200`)

**配置更新:**

`config/default.yaml`:
```yaml
services:
  teleop:
    name: "Coach"  # 原: "Teleop Service"
    api_url: "http://localhost:8080"
    health_endpoint: "/api/health"
```

**Python 3.6 兼容:**
- `backend/config_py36.py` - Pydantic v1 兼容版本
- `requirements.py36.txt` - 依赖锁定

---

## 架构变更

### 前端架构

**变更前:**
```
顶部导航栏
  └─ VR 连接按钮 (独立)
       ├─ VRConnectionManager (vr_connection.js)
       └─ 全局状态轮询

Coach 页面
  ├─ 服务状态
  ├─ VR 连接步骤说明
  └─ 配置管理
```

**变更后:**
```
顶部导航栏
  └─ 三灯状态栏 (Camera / Coach / Robot)

Coach 页面
  ├─ 服务状态
  ├─ VR 连接管理卡片
  │   ├─ 状态指示器 (轮询 3s)
  │   ├─ 连接/断开按钮
  │   ├─ 设备信息显示
  │   └─ 手动命令弹窗
  ├─ VR 数据可视化
  └─ 配置管理
```

**优势:**
- 语义更清晰（VR 是 Coach 的输入源）
- 状态展示更直观（圆点 + 文字 + 按钮）
- 减少全局状态管理复杂度

### API 架构

**新增端点组:**
```
/api/system/*
  ├─ /vr/status       (GET)   - VR 连接状态
  ├─ /vr/connect      (POST)  - 配置端口转发
  └─ /vr/disconnect   (POST)  - 移除端口转发
```

**保持稳定:**
```
/api/teleop/*  (内部路由前缀保持不变)
  ├─ /status
  ├─ /config
  ├─ /teleop/reset_reference
  └─ /vr_data
```

---

## 工具链改进

### setup_quest.sh 脚本特性

**执行流程 (6 步):**

1. **检查 adb 工具** - 验证安装和版本
2. **扫描设备列表** - `adb devices -l` 显示所有设备
3. **检查目标设备** - 获取序列号、型号、Android 版本
4. **配置端口转发** - `adb reverse` + 验证规则
5. **防熵屏设置** - 屏幕超时 + 近距离传感器 + VR 模式
6. **完成总结** - 显示后续步骤和验证命令

**特性亮点:**

- ✅ **健壮性**
  - 每步都有错误检查 (`set -e`)
  - 失败时给出具体的排查建议
  - 清除旧规则后再设置新规则

- ✅ **用户体验**
  - 彩色输出（绿/红/黄/蓝/青）
  - Unicode 框线（`╭─╮│╰─╯`）
  - 进度提示 `[1/6]` ~ `[6/6]`
  - 显示设备序列号和型号
  - 验证配置是否生效

- ✅ **多设备支持**
  - 自动检测所有连接的设备
  - 支持通过 `ANDROID_SERIAL` 环境变量指定设备
  - 提供多设备场景的使用说明

- ✅ **幂等性设计**
  - 先清理旧规则再设置新规则
  - 重复运行不会产生副作用
  - 配置状态可验证

**输出示例:**

```bash
$ ./setup_quest.sh

========================================
 Quest VR 连接配置 - Coach
========================================

[1/6] 检查 adb 工具...
  ✓ adb 已安装 (version 35.0.1)

[2/6] 扫描连接的设备...

╭─────────────────────────────────────────────────╮
│  已连接的设备列表:                              │
╰─────────────────────────────────────────────────╯

  [1] 1WMHH8A123456
      状态: ● device (已授权)
      型号: Quest_3
      产品: hollywood

[3/6] 检查目标设备状态...
  ✓ 目标设备已就绪

╭─────────────────────────────────────────────────╮
│  目标设备信息:                                  │
╰─────────────────────────────────────────────────╯
  序列号:    1WMHH8A123456
  型号:      Quest 3
  产品名:    hollywood
  Android:   12

[4/6] 配置 adb 端口转发...
  清除旧规则: tcp:5200
  设置新规则: tcp:5200 -> tcp:5201
  ✓ 端口转发配置成功

╭─────────────────────────────────────────────────╮
│  adb reverse --list (当前所有端口转发):         │
╰─────────────────────────────────────────────────╯
  → (reverse) tcp:5200 tcp:5201  ← Coach VR 数据通道

  工作原理:
    Quest VR Tracker (localhost:5200)
           ↓ adb reverse
    宿主机 Coach TCP Server (:5201)

[5/6] 防熵屏配置...
  [5.1] 设置屏幕超时为最大值...
    ✓ 屏幕超时: 2147483647 (≈24天,持久化)

  [5.2] 禁用近距离传感器熵屏...
    ✓ 近距离传感器已禁用 (摘下头盔不熵屏)

  [5.3] 强制 VR 模式常亮...
    ✓ VR 模式广播已发送

[6/6] 配置完成总结

========================================
 ✓ Quest VR 连接配置完成
========================================

接下来的步骤:
  1. 在 Quest 上启动 VR Tracker 应用
  2. 在应用中点击 Connect,连接到 localhost:5200
  3. 启动 Coach 服务 (在容器内运行):
     cd /workspace/coach && ./scripts/docker_run_coach.sh

验证连接:
  adb devices -l                         # 查看连接设备
  adb reverse --list                     # 查看端口转发规则
  curl http://localhost:8080/api/status  # 检查 Coach 服务状态
```

---

## 使用场景

### 场景 1: 每天启动遥操

```bash
# 1. 连接 Quest (USB-C)

# 2. 配置 Quest
cd /workspace/coach/scripts
./setup_quest.sh

# 3. Quest 上启动 VR Tracker 应用
#    → 打开应用 → Connect → localhost:5200

# 4. 启动 Coach 服务 (容器内)
cd /workspace/coach
./scripts/docker_run_coach.sh

# 5. 打开 Web Console
#    → http://localhost:3000
#    → 点击 Coach 三灯查看连接状态
```

### 场景 2: Quest 重启后

Quest 重启会丢失:
- ❌ adb 端口转发规则
- ❌ 近距离传感器设置
- ✅ 屏幕超时设置 (持久化,不丢失)

**解决方案:**
```bash
cd /workspace/coach/scripts
./setup_quest.sh  # 重新配置
```

### 场景 3: USB 断开重连

USB 断开后端口转发规则会丢失。

**解决方案:**
```bash
./setup_quest.sh  # 重新配置
```

### 场景 4: 多设备环境

```bash
# 1. 查看所有设备
adb devices -l
# 输出:
# 1WMHH8A123456    device ...  ← Quest
# R5CR1234567      device ...  ← 手机

# 2. 指定设备运行脚本
export ANDROID_SERIAL=1WMHH8A123456
./setup_quest.sh
```

---

## 故障排查

### 常见问题

1. **`adb: command not found`**
   - macOS: `brew install android-platform-tools`
   - Ubuntu: `sudo apt install adb`

2. **`no devices found`**
   - 检查 USB 连接
   - 确认 Quest 开发者模式已启用
   - 确认 USB 调试已启用
   - 在 Quest 上授权调试请求

3. **`unauthorized`**
   - 在 Quest 内查看授权弹窗,点击"允许"

4. **`more than one device`**
   - 使用 `export ANDROID_SERIAL=<序列号>`
   - 或断开其他设备

5. **VR Tracker 无法连接**
   - 重新运行 `./setup_quest.sh`
   - 检查 Coach 服务是否在监听 5201 端口: `lsof -i :5201`
   - 在 Quest 上测试连接: `adb shell "curl -v localhost:5200"`

6. **Quest 摘下立即熵屏**
   - 近距离传感器设置丢失 (Quest 重启后)
   - 重新运行 `./setup_quest.sh`

### 验证清单

```bash
# 1. 设备已连接
adb devices -l
# 期望: 1WMHH8A123456    device ...

# 2. 端口转发已配置
adb reverse --list
# 期望: (reverse) tcp:5200 tcp:5201

# 3. Coach 服务运行中
curl http://localhost:8080/api/status
# 期望: {"vr": {"connected": true, ...}, ...}

# 4. Web Console 状态正常
# 浏览器打开 http://localhost:3000
# 点击 Coach 三灯,查看绿色 ● 指示灯
```

---

## 命令参考

### adb devices 系列

```bash
# 查看所有连接的设备
adb devices

# 查看详细设备信息 (型号、产品名等)
adb devices -l

# 指定设备执行命令 (多设备时使用)
adb -s 1WMHH8A123456 shell getprop ro.product.model
```

### adb reverse 系列

```bash
# 查看所有端口转发规则
adb reverse --list

# 添加端口转发
adb reverse tcp:5200 tcp:5201

# 移除特定端口转发
adb reverse --remove tcp:5200

# 移除所有端口转发
adb reverse --remove-all
```

### 设备信息查询

```bash
# 设备状态
adb get-state
# 输出: device (正常) / unauthorized (未授权) / offline (离线)

# 序列号
adb get-serialno

# 设备型号
adb shell getprop ro.product.model

# Android 版本
adb shell getprop ro.build.version.release
```

### 防熵屏相关

```bash
# 查看屏幕超时设置
adb shell settings get system screen_off_timeout
# 2147483647 = 最大值 (≈24天)

# 查看近距离传感器状态
adb shell getprop debug.oculus.proximityHmd
# 0 = 禁用, 1 = 启用
```

---

## 文件清单

### Coach Submodule 新增/修改

```
coach/
├── scripts/
│   ├── setup_quest.sh              [新增] 一键配置脚本 (236行)
│   ├── README_QUEST_SETUP.md       [新增] 详细指南 (421行)
│   ├── QUICK_REFERENCE.md          [新增] 快速参考 (115行)
│   ├── start.sh                    [重命名] 原 docker_run_teleop.sh
│   └── start_teleop.sh             [删除] 已废弃
├── config/
│   └── default_config.yaml         [修改] 端口和服务配置
└── src/coach/
    ├── api_server.py               [修改] API 端点更新
    └── inputs/
        └── vr_receiver.py          [修改] VR 接收器优化
```

### Robot Web Console 新增/修改

```
robot_web_console/
├── backend/
│   ├── routes/
│   │   └── system.py               [新增] VR 管理 API (200+行)
│   ├── config.py                   [修改] Pydantic 配置
│   ├── config_py36.py              [新增] Python 3.6 兼容版本
│   ├── main.py                     [修改] 注册 system 路由
│   └── services/
│       ├── monitor.py              [修改] 服务名称更新
│       └── proxy.py                [修改] 路由前缀注释
├── config/
│   └── default.yaml                [修改] "Coach" 服务名
├── frontend/
│   ├── index.html                  [修改] 移除 VR 按钮,三灯改名
│   ├── css/
│   │   ├── console.css             [修改] 样式微调
│   │   └── style.css               [保留] VR 按钮样式兼容
│   └── js/
│       ├── teleop.js               [修改] 整合 VR 管理 (+200行)
│       ├── vr_connection.js        [新增] 原独立模块 (已废弃)
│       ├── api.js                  [修改] 添加 VR API
│       ├── main.js                 [修改] 页面加载逻辑
│       └── services_monitor.js     [修改] 三灯点击处理
├── requirements.py36.txt           [新增] Python 3.6 依赖
└── scripts/
    └── start.sh                    [移动] 原根目录 start.sh
```

---

## 兼容性

### 浏览器

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### Python

- Python 3.6+ (后端)
- Python 3.8+ (推荐)

### 依赖

- adb (Android Debug Bridge)
  - macOS: `brew install android-platform-tools`
  - Ubuntu: `sudo apt install adb`
- Quest 设备开发者模式
- USB 调试已启用

### 破坏性变更

**无破坏性变更** - 内部 API 路由前缀保持不变:
- `/api/teleop/*` 路由继续工作
- JavaScript 对象名 `TeleopPage` 保持不变
- CSS class `.teleop-*` 保持不变

**仅 UI 显示名称变更:**
- 服务显示名: "Teleop Service" → "Coach"
- 三灯标签: "Teleop" → "Coach"

---

## 测试

### 手动测试清单

- [ ] 运行 `setup_quest.sh` 脚本
- [ ] 验证 `adb devices -l` 输出
- [ ] 验证 `adb reverse --list` 显示 tcp:5200
- [ ] 在 Quest 上启动 VR Tracker 应用
- [ ] 连接到 `localhost:5200`
- [ ] 打开 Web Console http://localhost:3000
- [ ] 点击 Coach 三灯,查看 VR 连接状态
- [ ] 点击"连接"按钮 (如果未连接)
- [ ] 查看 VR 实时数据显示
- [ ] 测试"重置参考点"功能
- [ ] 测试"显示实时数据"开关

### 验证命令

```bash
# 脚本语法检查
bash -n /workspace/coach/scripts/setup_quest.sh

# 文件权限检查
ls -lh /workspace/coach/scripts/setup_quest.sh
# 期望: -rwxr-xr-x

# API 端点测试
curl http://localhost:3000/api/system/vr/status
curl http://localhost:8080/api/status

# 服务健康检查
curl http://localhost:3000/api/services/status
```

---

## 后续工作

### 待优化

- [ ] 添加 adb 连接状态的实时监控 (检测 USB 断开)
- [ ] 支持无线 adb 连接 (`adb connect <IP>`)
- [ ] 添加端口转发的自动重连机制
- [ ] VR 数据可视化增强 (3D 手柄姿态显示)
- [ ] 添加 Quest 电池电量显示

### 已知限制

- adb 命令需要在宿主机执行 (容器内无法直接访问 USB 设备)
- 端口转发在 USB 断开后会丢失 (需要重新配置)
- 近距离传感器设置在 Quest 重启后丢失 (需要重新配置)
- 多设备环境需要手动指定 `ANDROID_SERIAL`

---

## 参考文档

- [CLAUDE.md](/workspace/CLAUDE.md) - 项目架构总览
- [Coach 配置指南](/workspace/coach/scripts/README_QUEST_SETUP.md)
- [快速参考卡片](/workspace/coach/scripts/QUICK_REFERENCE.md)
- [Web Console README](/workspace/robot_web_console/README.md)

---

## 贡献者

- soyons - 主要开发
- Claude Opus 4.8 (1M context) - AI 辅助开发

---

**最后更新:** 2026-06-24  
**版本:** 1.0.0
