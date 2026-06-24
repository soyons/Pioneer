"""系统资源监控路由 - CPU / 内存 / 磁盘 / 进程 / VR 连接"""
import os
import time
import subprocess
from typing import List, Dict, Any

from fastapi import APIRouter

try:
    import psutil
    _HAS_PSUTIL = True
except ImportError:
    _HAS_PSUTIL = False

router = APIRouter(prefix="/api/system", tags=["system"])


# 缓存上一次 cpu_percent 的非阻塞采样基线
_last_cpu_sample_t = 0.0


def _bytes_to_gib(n: int) -> float:
    return round(n / (1024 ** 3), 2)


def _bytes_to_mib(n: int) -> float:
    return round(n / (1024 ** 2), 1)


@router.get("/info")
async def get_system_info(top_n: int = 5) -> Dict[str, Any]:
    """获取系统资源使用情况

    返回:
        cpu: 核心数 / 整体百分比 / 每核百分比 / 1-5-15 负载
        memory: 总量 / 已用 / 可用 / 百分比 / swap
        disk: 根分区 总量 / 已用 / 可用 / 百分比
        top_processes: 按 CPU 占用排序的前 N 个进程
        boot_time: 启动时间 + uptime 秒数
    """
    if not _HAS_PSUTIL:
        return {"error": "psutil not installed"}

    global _last_cpu_sample_t
    now = time.time()
    # 第一次调用 cpu_percent(interval=None) 会返回 0.0,所以首次同步采样 0.1s
    # 之后用非阻塞采样,差值由 psutil 内部缓存维护
    if now - _last_cpu_sample_t > 5.0:
        cpu_overall = psutil.cpu_percent(interval=0.1)
        cpu_per_core = psutil.cpu_percent(interval=None, percpu=True)
    else:
        cpu_overall = psutil.cpu_percent(interval=None)
        cpu_per_core = psutil.cpu_percent(interval=None, percpu=True)
    _last_cpu_sample_t = now

    # 负载平均值(Linux/Mac)
    try:
        load1, load5, load15 = os.getloadavg()
    except (OSError, AttributeError):
        load1 = load5 = load15 = 0.0

    # 内存
    vm = psutil.virtual_memory()
    sm = psutil.swap_memory()

    # 磁盘(根分区)
    du = psutil.disk_usage("/")

    # Top 进程(按 cpu_percent 排序)
    procs: List[Dict[str, Any]] = []
    for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent", "cmdline"]):
        try:
            info = p.info
            cmdline = info.get("cmdline") or []
            # 优先用命令行第一段(更具识别性),否则退回进程名
            display = " ".join(cmdline[:3]) if cmdline else (info.get("name") or "?")
            if len(display) > 80:
                display = display[:77] + "..."
            procs.append({
                "pid": info["pid"],
                "name": display,
                "cpu_percent": round(info.get("cpu_percent") or 0.0, 1),
                "memory_percent": round(info.get("memory_percent") or 0.0, 1),
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    procs.sort(key=lambda x: x["cpu_percent"], reverse=True)
    top_processes = procs[:max(1, min(top_n, 20))]

    boot_ts = psutil.boot_time()
    uptime_seconds = int(now - boot_ts)

    return {
        "timestamp": now,
        "cpu": {
            "cores": psutil.cpu_count(logical=True),
            "physical_cores": psutil.cpu_count(logical=False),
            "percent": round(cpu_overall, 1),
            "per_core": [round(p, 1) for p in cpu_per_core],
            "load_avg": [round(load1, 2), round(load5, 2), round(load15, 2)],
        },
        "memory": {
            "total_gib": _bytes_to_gib(vm.total),
            "used_gib": _bytes_to_gib(vm.used),
            "available_gib": _bytes_to_gib(vm.available),
            "percent": vm.percent,
            "swap_total_gib": _bytes_to_gib(sm.total),
            "swap_used_gib": _bytes_to_gib(sm.used),
            "swap_percent": sm.percent,
        },
        "disk": {
            "total_gib": _bytes_to_gib(du.total),
            "used_gib": _bytes_to_gib(du.used),
            "free_gib": _bytes_to_gib(du.free),
            "percent": du.percent,
        },
        "uptime_seconds": uptime_seconds,
        "top_processes": top_processes,
    }


@router.get("/vr/status")
async def get_vr_status() -> Dict[str, Any]:
    """获取 VR 连接状态（Quest 设备 + adb reverse 端口转发）

    返回:
        device_connected: Quest 设备是否连接
        device_serial: 设备序列号
        port_forwarded: tcp:5200 -> tcp:5201 端口转发是否配置
        adb_available: adb 命令是否可用
        error: 错误信息（如果有）
    """
    result = {
        "device_connected": False,
        "device_serial": None,
        "port_forwarded": False,
        "adb_available": False,
        "error": None,
        "manual_command": "adb reverse tcp:5200 tcp:5201"
    }

    try:
        # 检查 adb 是否可用
        adb_version = subprocess.run(
            ["adb", "version"],
            capture_output=True,
            text=True,
            timeout=2
        )
        if adb_version.returncode != 0:
            result["error"] = "adb command not available"
            return result

        result["adb_available"] = True

        # 检查设备连接
        devices = subprocess.run(
            ["adb", "devices"],
            capture_output=True,
            text=True,
            timeout=5
        )

        if devices.returncode != 0:
            result["error"] = devices.stderr.strip()
            return result

        # 解析设备列表
        lines = devices.stdout.strip().split("\n")
        for line in lines[1:]:  # 跳过第一行 "List of devices attached"
            if "\tdevice" in line:
                result["device_connected"] = True
                result["device_serial"] = line.split("\t")[0]
                break

        if not result["device_connected"]:
            result["error"] = "No Quest device found. Please connect via USB."
            return result

        # 检查端口转发状态
        reverse_list = subprocess.run(
            ["adb", "reverse", "--list"],
            capture_output=True,
            text=True,
            timeout=5
        )

        if reverse_list.returncode == 0:
            # 查找 tcp:5200 -> tcp:5201 转发
            for line in reverse_list.stdout.strip().split("\n"):
                if "tcp:5200" in line and "tcp:5201" in line:
                    result["port_forwarded"] = True
                    break

        if not result["port_forwarded"]:
            result["error"] = "Port forwarding not configured. Click 'Connect VR' to set up."

    except subprocess.TimeoutExpired:
        result["error"] = "adb command timeout"
    except FileNotFoundError:
        result["error"] = "adb command not found in PATH"
    except Exception as e:
        result["error"] = str(e)

    return result


@router.post("/vr/connect")
async def connect_vr() -> Dict[str, Any]:
    """连接 VR - 自动执行 adb reverse tcp:5200 tcp:5201

    返回:
        success: 是否成功
        message: 状态消息
        error: 错误信息（如果有）
        manual_command: 手动执行的命令（如果自动执行失败）
    """
    result = {
        "success": False,
        "message": "",
        "error": None,
        "manual_command": None
    }

    try:
        # 首先检查设备连接
        status = await get_vr_status()

        if not status["adb_available"]:
            result["error"] = "adb not available in container"
            result["message"] = "Please run this command on host machine:"
            result["manual_command"] = "adb reverse tcp:5200 tcp:5201"
            return result

        if not status["device_connected"]:
            result["error"] = "No Quest device found"
            result["message"] = "Please connect Quest via USB and enable USB debugging"
            return result

        # 执行端口转发
        reverse_cmd = subprocess.run(
            ["adb", "reverse", "tcp:5200", "tcp:5201"],
            capture_output=True,
            text=True,
            timeout=5
        )

        if reverse_cmd.returncode == 0:
            result["success"] = True
            result["message"] = f"VR connected! Port forwarding established for device {status['device_serial']}"
        else:
            result["error"] = reverse_cmd.stderr.strip()
            result["message"] = "Failed to set up port forwarding. Please run manually on host:"
            result["manual_command"] = "adb reverse tcp:5200 tcp:5201"

    except subprocess.TimeoutExpired:
        result["error"] = "adb command timeout"
        result["message"] = "Please run manually on host:"
        result["manual_command"] = "adb reverse tcp:5200 tcp:5201"
    except Exception as e:
        result["error"] = str(e)
        result["message"] = "Failed to connect VR. Please run manually on host:"
        result["manual_command"] = "adb reverse tcp:5200 tcp:5201"

    return result


@router.post("/vr/disconnect")
async def disconnect_vr() -> Dict[str, Any]:
    """断开 VR 连接 - 移除 adb reverse 端口转发

    返回:
        success: 是否成功
        message: 状态消息
    """
    result = {
        "success": False,
        "message": "",
        "error": None
    }

    try:
        # 移除端口转发
        reverse_cmd = subprocess.run(
            ["adb", "reverse", "--remove", "tcp:5200"],
            capture_output=True,
            text=True,
            timeout=5
        )

        if reverse_cmd.returncode == 0:
            result["success"] = True
            result["message"] = "VR disconnected. Port forwarding removed."
        else:
            # 即使失败也标记为成功（可能本来就没有转发）
            result["success"] = True
            result["message"] = "VR disconnected (no active forwarding found)."

    except Exception as e:
        result["error"] = str(e)
        result["message"] = "Failed to disconnect VR"

    return result
