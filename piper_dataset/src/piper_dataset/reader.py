"""
DatasetReader for piper_dataset.

读取 PiperDataset.create(...) 之后产生的目录：

    <root>/
      meta/info.json
      data/chunk-000/episode_{eid:06d}.parquet
      videos/<image_key>/episode_{eid:06d}.mp4            # use_videos=True
      images/<image_key>/episode_{eid:06d}/frame_*.png    # use_videos=False

对外暴露：
- PiperDatasetReader(root)
- reader.info                      : dict
- reader.features                  : dict
- reader.episode_indices           : list[int]
- reader.iter_episode(episode_idx) : yield frame dict
- reader.load_episode(episode_idx) : list[frame dict]

image key 在 frame dict 里会被替换成 np.ndarray (uint8, HxWx3, RGB)。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator

import numpy as np


def _decode_video_all_frames(video_path: Path) -> list[np.ndarray]:
    try:
        import av
    except ImportError as e:
        raise RuntimeError(
            "piper_dataset reader requires PyAV to decode MP4 videos. "
            "Install piper_dataset/requirements.txt first."
        ) from e

    frames: list[np.ndarray] = []
    container = av.open(str(video_path))
    try:
        stream = container.streams.video[0]
        for packet in container.demux(stream):
            for av_frame in packet.decode():
                arr = av_frame.to_ndarray(format="rgb24")
                frames.append(arr)
    finally:
        container.close()
    return frames


def _load_png_frame(path: Path) -> np.ndarray:
    try:
        from PIL import Image
    except ImportError as e:
        raise RuntimeError(
            "piper_dataset reader requires Pillow to load PNG frames. "
            "Install piper_dataset/requirements.txt first."
        ) from e

    img = Image.open(path).convert("RGB")
    return np.asarray(img, dtype=np.uint8)


class PiperDatasetReader:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        info_path = self.root / "meta" / "info.json"
        if not info_path.exists():
            raise FileNotFoundError(f"info.json not found under {self.root}")

        with open(info_path, "r") as f:
            self.info: dict = json.load(f)

        self.features: dict = self.info.get("features", {})
        self.fps: int = int(self.info.get("fps", 30))
        self.use_videos: bool = bool(self.info.get("use_videos", True))
        self._episodes_meta: list[dict] = self.info.get("episodes", [])

        self._image_keys = [
            k for k, meta in self.features.items() if meta.get("dtype") == "image"
        ]

    # ---- basic metadata ------------------------------------------------

    @property
    def episode_indices(self) -> list[int]:
        return [ep["episode_index"] for ep in self._episodes_meta]

    def __len__(self) -> int:
        return len(self._episodes_meta)

    def get_episode_meta(self, episode_index: int) -> dict:
        for ep in self._episodes_meta:
            if ep["episode_index"] == episode_index:
                return ep
        raise KeyError(f"episode_index {episode_index} not in dataset")

    # ---- frame access --------------------------------------------------

    def iter_episode(self, episode_index: int) -> Iterator[dict]:
        try:
            import pyarrow.parquet as pq
        except ImportError as e:
            raise RuntimeError(
                "piper_dataset reader requires pyarrow. "
                "Install piper_dataset/requirements.txt first."
            ) from e

        ep_meta = self.get_episode_meta(episode_index)
        parquet_path = self.root / ep_meta["path"]
        if not parquet_path.exists():
            raise FileNotFoundError(f"parquet not found: {parquet_path}")

        rows = pq.read_table(parquet_path).to_pylist()

        # 预解码图像（视频或 PNG 列表）
        image_frames: dict[str, list[np.ndarray]] = {}
        if self._image_keys:
            assets = ep_meta.get("assets", {})
            for image_key in self._image_keys:
                rel = assets.get(image_key)
                if rel is None:
                    continue
                abs_path = self.root / rel
                if self.use_videos:
                    image_frames[image_key] = _decode_video_all_frames(abs_path)
                else:
                    # abs_path 指向 episode 目录
                    frame_files = sorted(abs_path.glob("frame_*.png"))
                    image_frames[image_key] = [_load_png_frame(p) for p in frame_files]

        for idx, row in enumerate(rows):
            frame = dict(row)
            for image_key, arrs in image_frames.items():
                if idx < len(arrs):
                    frame[image_key] = arrs[idx]
            yield frame

    def load_episode(self, episode_index: int) -> list[dict]:
        return list(self.iter_episode(episode_index))
