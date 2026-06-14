import json
from pathlib import Path
from typing import Any

import numpy as np

from .video_utils import encode_video_frames


def _is_image_feature(feature_meta: dict) -> bool:
    return feature_meta.get("dtype") == "image"


def _image_feature_keys(features: dict) -> list[str]:
    return [k for k, meta in features.items() if _is_image_feature(meta)]


class PiperDataset:
    """
    LeRobot 风格的 dataset 写入器。

    存储布局（use_videos=True 时）：
        <root>/
          meta/info.json
          data/chunk-000/episode_{eid:06d}.parquet
          videos/observation.images.<cam>/episode_{eid:06d}.mp4

    use_videos=False 时，图像帧落为 PNG：
          images/observation.images.<cam>/episode_{eid:06d}/frame_{fid:06d}.png
    """

    def __init__(
        self,
        repo_id: str,
        root: str | Path,
        fps: int,
        features: dict,
        robot_type: str | None = None,
        use_videos: bool = True,
    ):
        self.repo_id = repo_id
        self.root = Path(root)
        self.fps = fps
        self.features = features
        self.robot_type = robot_type
        self.use_videos = use_videos

        self._image_keys = _image_feature_keys(features)
        self._episode_buffer: list[dict[str, Any]] = []
        self._image_buffer: dict[str, list[np.ndarray | None]] = {k: [] for k in self._image_keys}
        self._episode_index = 0
        self._frame_index = 0

    @classmethod
    def create(
        cls,
        repo_id: str,
        fps: int,
        features: dict,
        root: str | Path | None = None,
        robot_type: str | None = None,
        use_videos: bool = True,
    ) -> "PiperDataset":
        dataset_root = (
            Path(root) if root is not None else Path.cwd() / "data" / repo_id.replace("/", "_")
        )
        (dataset_root / "data" / "chunk-000").mkdir(parents=True, exist_ok=True)
        (dataset_root / "meta").mkdir(parents=True, exist_ok=True)
        if use_videos:
            (dataset_root / "videos").mkdir(parents=True, exist_ok=True)
        else:
            (dataset_root / "images").mkdir(parents=True, exist_ok=True)

        info = {
            "repo_id": repo_id,
            "fps": fps,
            "robot_type": robot_type,
            "features": features,
            "use_videos": use_videos,
            "format": "piper_dataset_v1",
            "episodes": [],
        }
        with open(dataset_root / "meta" / "info.json", "w") as f:
            json.dump(info, f, indent=2)

        return cls(
            repo_id=repo_id,
            root=dataset_root,
            fps=fps,
            features=features,
            robot_type=robot_type,
            use_videos=use_videos,
        )

    # ---- public API ---------------------------------------------------

    def add_frame(self, frame: dict) -> None:
        if "task" not in frame:
            raise ValueError("frame must include 'task'")
        if "timestamp" not in frame:
            raise ValueError("frame must include 'timestamp'")

        parquet_row: dict[str, Any] = {}
        for k, v in frame.items():
            if k in self._image_keys:
                arr = np.asarray(v)
                if arr.dtype != np.uint8:
                    raise ValueError(
                        f"Image frame '{k}' must be uint8 ndarray, got {arr.dtype}"
                    )
                if arr.ndim != 3 or arr.shape[2] != 3:
                    raise ValueError(
                        f"Image frame '{k}' must be HxWx3, got shape {arr.shape}"
                    )
                self._image_buffer[k].append(arr)
                parquet_row[k] = self._image_ref_path(k, self._frame_index)
            else:
                parquet_row[k] = v

        # 缺失图像字段用 None 占位（视频里会截断到第一个 None 之前）
        for k in self._image_keys:
            if k not in frame:
                self._image_buffer[k].append(None)
                parquet_row[k] = None

        parquet_row["episode_index"] = self._episode_index
        parquet_row["frame_index"] = self._frame_index
        self._episode_buffer.append(parquet_row)
        self._frame_index += 1

    def save_episode(self) -> None:
        if not self._episode_buffer:
            return

        try:
            import pyarrow as pa
            import pyarrow.parquet as pq
        except ImportError as e:
            raise RuntimeError(
                "piper_dataset.save_episode() requires pyarrow. "
                "Install piper_dataset/requirements.txt first."
            ) from e

        episode_assets = self._flush_images()

        episode_path = (
            self.root / "data" / "chunk-000" / f"episode_{self._episode_index:06d}.parquet"
        )
        table = pa.Table.from_pylist(self._episode_buffer)
        pq.write_table(table, episode_path)

        info_path = self.root / "meta" / "info.json"
        with open(info_path, "r") as f:
            info = json.load(f)
        info["episodes"].append(
            {
                "episode_index": self._episode_index,
                "num_frames": len(self._episode_buffer),
                "path": str(episode_path.relative_to(self.root)),
                "assets": episode_assets,
            }
        )
        with open(info_path, "w") as f:
            json.dump(info, f, indent=2)

        self._episode_buffer = []
        self._image_buffer = {k: [] for k in self._image_keys}
        self._episode_index += 1
        self._frame_index = 0

    def clear_episode_buffer(self) -> None:
        self._episode_buffer = []
        self._image_buffer = {k: [] for k in self._image_keys}
        self._frame_index = 0

    def finalize(self) -> None:
        if self._episode_buffer:
            self.save_episode()

    # ---- internals ---------------------------------------------------

    def _image_dir(self, image_key: str, episode_index: int) -> Path:
        return Path("images") / image_key / f"episode_{episode_index:06d}"

    def _video_path(self, image_key: str, episode_index: int) -> Path:
        return Path("videos") / image_key / f"episode_{episode_index:06d}.mp4"

    def _image_ref_path(self, image_key: str, frame_index: int) -> str:
        if self.use_videos:
            return str(self._video_path(image_key, self._episode_index))
        return str(self._image_dir(image_key, self._episode_index) / f"frame_{frame_index:06d}.png")

    def _flush_images(self) -> dict[str, str]:
        """
        落盘图像，返回 {image_key: relative_path}。
        - use_videos=True：每路相机每个 episode 一个 MP4
        - use_videos=False：每帧一个 PNG
        """
        assets: dict[str, str] = {}
        if not self._image_keys:
            return assets

        if self.use_videos:
            for image_key, frames in self._image_buffer.items():
                valid = [arr for arr in frames if arr is not None]
                if not valid:
                    continue
                rel = self._video_path(image_key, self._episode_index)
                encode_video_frames(
                    frames=valid,
                    output_path=self.root / rel,
                    fps=self.fps,
                )
                assets[image_key] = str(rel)
            return assets

        # PNG 分支
        try:
            from PIL import Image
        except ImportError as e:
            raise RuntimeError(
                "piper_dataset with image features requires Pillow. "
                "Install piper_dataset/requirements.txt first."
            ) from e

        for image_key, frames in self._image_buffer.items():
            out_dir = self.root / self._image_dir(image_key, self._episode_index)
            out_dir.mkdir(parents=True, exist_ok=True)
            for idx, arr in enumerate(frames):
                if arr is None:
                    continue
                Image.fromarray(arr).save(out_dir / f"frame_{idx:06d}.png")
            assets[image_key] = str(self._image_dir(image_key, self._episode_index))

        return assets
