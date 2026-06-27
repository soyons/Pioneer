"""数据集查看路由 - 只读浏览转化后的 piper_dataset / LeRobot 格式数据集。

目录布局(piper_dataset_v1):
    <root>/<dataset>/
        meta/info.json
        data/chunk-000/episode_{eid:06d}.parquet
        videos/<image_key>/episode_{eid:06d}.mp4         # use_videos=True
        images/<image_key>/episode_{eid:06d}/frame_*.png # use_videos=False

提供:
  GET /api/datasets                                   列出数据集
  GET /api/datasets/{name}                            数据集元信息(fps/features/episodes)
  GET /api/datasets/{name}/episodes/{idx}/trajectory  轨迹数值序列(下采样)
  GET /api/datasets/{name}/episodes/{idx}/video/{key} 串流某相机的 mp4
  GET /api/datasets/{name}/episodes/{idx}/frame/{key}/{fid}  PNG 帧(use_videos=False)
"""
import json
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from ..config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/datasets", tags=["datasets"])

# 数值类型(可画轨迹)
_NUMERIC_DTYPES = ("float32", "float64", "int32", "int64", "bool")
# 簿记列:不作为轨迹通道(timestamp 是 x 轴,index 类是行号)
_BOOKKEEPING_KEYS = {"timestamp", "episode_index", "frame_index", "index",
                     "task_index", "next.done", "next.reward"}


def _numeric_feature_keys(features: dict) -> list:
    """可绘制的数值 feature key(排除 image/string 与簿记列)。"""
    return [
        k for k, m in features.items()
        if m.get("dtype") in _NUMERIC_DTYPES and k not in _BOOKKEEPING_KEYS
    ]


def _datasets_root() -> Path:
    return Path(get_settings().datasets.root)


def _safe_dataset_dir(name: str) -> Path:
    """解析数据集目录,拒绝路径穿越。"""
    if not name or "/" in name or "\\" in name or name in (".", ".."):
        raise HTTPException(status_code=400, detail="非法数据集名称")
    root = _datasets_root().resolve()
    target = (root / name).resolve()
    # 必须落在 root 之内
    if root not in target.parents and target != root:
        raise HTTPException(status_code=400, detail="非法路径")
    if not (target / "meta" / "info.json").exists():
        raise HTTPException(status_code=404, detail="数据集不存在或缺少 meta/info.json")
    return target


def _load_info(dataset_dir: Path) -> dict:
    with open(dataset_dir / "meta" / "info.json", "r") as f:
        return json.load(f)


def _episode_meta(info: dict, episode_index: int) -> dict:
    for ep in info.get("episodes", []):
        if ep.get("episode_index") == episode_index:
            return ep
    raise HTTPException(status_code=404, detail="episode 不存在")


@router.get("")
@router.get("/")
async def list_datasets():
    """列出 root 下所有数据集(含 meta/info.json 的子目录)。"""
    root = _datasets_root()
    if not root.exists():
        return {"root": str(root), "datasets": []}

    out = []
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        info_path = child / "meta" / "info.json"
        if not info_path.exists():
            continue
        try:
            info = _load_info(child)
        except Exception as e:
            logger.warning("读取 info.json 失败 %s: %s", info_path, e)
            continue
        episodes = info.get("episodes", [])
        total_frames = sum(ep.get("num_frames", 0) for ep in episodes)
        image_keys = [k for k, m in info.get("features", {}).items()
                      if m.get("dtype") == "image"]
        out.append({
            "name": child.name,
            "repo_id": info.get("repo_id"),
            "robot_type": info.get("robot_type"),
            "fps": info.get("fps"),
            "format": info.get("format"),
            "use_videos": info.get("use_videos", True),
            "num_episodes": len(episodes),
            "total_frames": total_frames,
            "num_cameras": len(image_keys),
            "cameras": image_keys,
        })
    return {"root": str(root), "datasets": out}


@router.get("/{name}")
async def get_dataset(name: str):
    """数据集元信息: fps / features / 每集摘要。"""
    dataset_dir = _safe_dataset_dir(name)
    info = _load_info(dataset_dir)
    features = info.get("features", {})
    image_keys = [k for k, m in features.items() if m.get("dtype") == "image"]
    # 数值通道(可画轨迹): 排除 image / string / 簿记列
    numeric_keys = _numeric_feature_keys(features)
    episodes = [
        {
            "episode_index": ep.get("episode_index"),
            "num_frames": ep.get("num_frames", 0),
            "cameras": list((ep.get("assets") or {}).keys()),
        }
        for ep in info.get("episodes", [])
    ]
    return {
        "name": name,
        "repo_id": info.get("repo_id"),
        "robot_type": info.get("robot_type"),
        "fps": info.get("fps"),
        "format": info.get("format"),
        "use_videos": info.get("use_videos", True),
        "features": features,
        "image_keys": image_keys,
        "numeric_keys": numeric_keys,
        "episodes": episodes,
    }


def _read_trajectory(parquet_path: Path, feature_keys, fps: int):
    """读取 parquet,把数值列展开成可绘图的通道序列(原始全采样,不下采样)。"""
    import pyarrow.parquet as pq

    table = pq.read_table(parquet_path)
    num_frames = table.num_rows
    available = set(table.column_names)

    # 全部原始帧,不下采样
    stride = 1
    idxs = list(range(num_frames))

    # 时间轴: 优先用 timestamp 列,否则用帧号/fps
    if "timestamp" in available:
        ts_col = table.column("timestamp").to_pylist()
        timestamps = [ts_col[i] for i in idxs]
    else:
        timestamps = [i / float(fps or 30) for i in idxs]

    groups = []
    for key in feature_keys:
        if key not in available:
            continue
        col = table.column(key).to_pylist()
        sample = next((v for v in col if v is not None), None)
        # 标量 vs 向量
        if isinstance(sample, (list, tuple)):
            dim = len(sample)
            channels = []
            for d in range(dim):
                vals = []
                for i in idxs:
                    v = col[i]
                    vals.append(float(v[d]) if (v is not None and d < len(v)) else None)
                channels.append({"label": f"{key}[{d}]", "values": vals})
            groups.append({"key": key, "dim": dim, "channels": channels})
        else:
            vals = []
            for i in idxs:
                v = col[i]
                if v is None:
                    vals.append(None)
                elif isinstance(v, bool):
                    vals.append(1.0 if v else 0.0)
                else:
                    vals.append(float(v))
            groups.append({"key": key, "dim": 1,
                           "channels": [{"label": key, "values": vals}]})

    return num_frames, stride, timestamps, groups


@router.get("/{name}/episodes/{idx}/trajectory")
async def get_trajectory(name: str, idx: int, keys: Optional[str] = None):
    """某集的轨迹数值序列。keys 可选,逗号分隔的 feature key 过滤;默认全部数值通道。"""
    dataset_dir = _safe_dataset_dir(name)
    info = _load_info(dataset_dir)
    ep = _episode_meta(info, idx)
    parquet_path = dataset_dir / ep["path"]
    if not parquet_path.exists():
        raise HTTPException(status_code=404, detail="parquet 文件缺失")

    features = info.get("features", {})
    numeric_keys = _numeric_feature_keys(features)
    if keys:
        wanted = [k.strip() for k in keys.split(",") if k.strip()]
        numeric_keys = [k for k in numeric_keys if k in wanted]

    try:
        num_frames, stride, timestamps, groups = _read_trajectory(
            parquet_path, numeric_keys, info.get("fps", 30))
    except Exception as e:
        logger.exception("读取轨迹失败 %s", parquet_path)
        raise HTTPException(status_code=500, detail=f"读取轨迹失败: {e}")

    return {
        "name": name,
        "episode_index": idx,
        "num_frames": num_frames,
        "downsample_stride": stride,
        "fps": info.get("fps"),
        "timestamps": timestamps,
        "groups": groups,
    }


@router.get("/{name}/episodes/{idx}/video/{key}")
async def get_episode_video(name: str, idx: int, key: str):
    """串流某相机的 mp4(use_videos=True)。支持 Range 请求(FileResponse)。"""
    dataset_dir = _safe_dataset_dir(name)
    info = _load_info(dataset_dir)
    ep = _episode_meta(info, idx)
    assets = ep.get("assets") or {}
    rel = assets.get(key)
    if rel is None:
        raise HTTPException(status_code=404, detail="该集无此相机资产")
    video_path = (dataset_dir / rel).resolve()
    if dataset_dir.resolve() not in video_path.parents:
        raise HTTPException(status_code=400, detail="非法资产路径")
    if not video_path.exists() or not video_path.is_file():
        raise HTTPException(status_code=404, detail="视频文件缺失(可能为 PNG 帧模式)")
    return FileResponse(str(video_path), media_type="video/mp4")


@router.get("/{name}/episodes/{idx}/frame/{key}/{fid}")
async def get_episode_frame(name: str, idx: int, key: str, fid: int):
    """PNG 帧模式(use_videos=False)下取单帧。"""
    dataset_dir = _safe_dataset_dir(name)
    info = _load_info(dataset_dir)
    ep = _episode_meta(info, idx)
    assets = ep.get("assets") or {}
    rel = assets.get(key)
    if rel is None:
        raise HTTPException(status_code=404, detail="该集无此相机资产")
    frame_dir = (dataset_dir / rel).resolve()
    if dataset_dir.resolve() not in frame_dir.parents:
        raise HTTPException(status_code=400, detail="非法资产路径")
    frame_path = frame_dir / f"frame_{fid:06d}.png"
    if not frame_path.exists():
        raise HTTPException(status_code=404, detail="帧文件缺失")
    return FileResponse(str(frame_path), media_type="image/png")
