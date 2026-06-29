import json
from pathlib import Path
from typing import Any

import numpy as np

from .video_utils import encode_video_frames

CODEBASE_VERSION = "v2.1"
DEFAULT_CHUNK_SIZE = 1000
DATA_PATH_TMPL = "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet"
VIDEO_PATH_TMPL = "videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4"

# 相机 feature 既可声明为 video(use_videos=True)也可为 image(PNG 帧序列)
_IMAGE_DTYPES = ("image", "video")


def _is_image_feature(feature_meta: dict) -> bool:
    return feature_meta.get("dtype") in _IMAGE_DTYPES


def _image_feature_keys(features: dict) -> list[str]:
    return [k for k, meta in features.items() if _is_image_feature(meta)]


class PiperDataset:
    """
    LeRobot v2.1 风格的 dataset 写入器(不依赖会在 Tegra 崩溃的 lerobot 包)。

    存储布局(use_videos=True 时):
        <root>/
          meta/info.json            # codebase_version v2.1 + data_path/video_path 模板
          meta/episodes.jsonl       # 每行 {episode_index, length, tasks, task_index}
          meta/tasks.jsonl          # {task_index, task}
          meta/episodes_stats.jsonl # {episode_index, stats: {}}
          data/chunk-000/episode_{eid:06d}.parquet
          videos/chunk-000/<cam>/episode_{eid:06d}.mp4

    use_videos=False 时,图像帧落为 PNG:
          images/chunk-000/<cam>/episode_{eid:06d}/frame_{fid:06d}.png
    """

    def __init__(
        self,
        repo_id: str,
        root: str | Path,
        fps: int,
        features: dict,
        robot_type: str | None = None,
        use_videos: bool = True,
        chunks_size: int = DEFAULT_CHUNK_SIZE,
    ):
        self.repo_id = repo_id
        self.root = Path(root)
        self.fps = fps
        self.features = features
        self.robot_type = robot_type
        self.use_videos = use_videos
        self.chunks_size = chunks_size

        self._image_keys = _image_feature_keys(features)
        self._episode_buffer: list[dict[str, Any]] = []
        self._image_buffer: dict[str, list[np.ndarray | None]] = {k: [] for k in self._image_keys}
        self._episode_index = 0
        self._frame_index = 0
        self._global_index = 0          # 跨 episode 的全局行号 -> parquet 的 index 列
        self._tasks: dict[str, int] = {}  # task 字符串 -> task_index
        self._episode_tasks: list[str] = []  # 当前 episode 出现过的 task(去重保序)

    # placeholder-create

    @classmethod
    def create(
        cls,
        repo_id: str,
        fps: int,
        features: dict,
        root: str | Path | None = None,
        robot_type: str | None = None,
        use_videos: bool = True,
        chunks_size: int = DEFAULT_CHUNK_SIZE,
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
            "codebase_version": CODEBASE_VERSION,
            "repo_id": repo_id,
            "robot_type": robot_type,
            "total_episodes": 0,
            "total_frames": 0,
            "total_tasks": 0,
            "total_videos": 0,
            "total_chunks": 0,
            "chunks_size": chunks_size,
            "fps": fps,
            "splits": {"train": "0:0"},
            "data_path": DATA_PATH_TMPL,
            "video_path": VIDEO_PATH_TMPL if use_videos else None,
            "use_videos": use_videos,
            "features": features,
        }
        with open(dataset_root / "meta" / "info.json", "w") as f:
            json.dump(info, f, indent=2)
        # 初始化 meta 的 jsonl 文件(空)
        for fname in ("episodes.jsonl", "tasks.jsonl", "episodes_stats.jsonl"):
            (dataset_root / "meta" / fname).write_text("")

        return cls(
            repo_id=repo_id,
            root=dataset_root,
            fps=fps,
            features=features,
            robot_type=robot_type,
            use_videos=use_videos,
            chunks_size=chunks_size,
        )

    # ---- public API ---------------------------------------------------

    def add_frame(self, frame: dict) -> None:
        """添加一帧数据。

        必须字段: task, timestamp。
        task 字符串会自动登记到 tasks.jsonl 并写 task_index 列。
        """
        if "task" not in frame:
            raise ValueError("frame must include 'task'")
        if "timestamp" not in frame:
            raise ValueError("frame must include 'timestamp'")

        task = frame["task"]
        if task not in self._tasks:
            self._tasks[task] = len(self._tasks)
        if task not in self._episode_tasks:
            self._episode_tasks.append(task)
        task_index = self._tasks[task]

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

        # 缺失图像字段用 None 占位(视频里会截断到第一个 None 之前)
        for k in self._image_keys:
            if k not in frame:
                self._image_buffer[k].append(None)
                parquet_row[k] = None

        # 簿记列(v2.1 LeRobot 标准)
        parquet_row["frame_index"] = self._frame_index
        parquet_row["episode_index"] = self._episode_index
        parquet_row["index"] = self._global_index
        parquet_row["task_index"] = task_index
        # timestamp_perf 是 Python perf_counter(初始值任意,只要单调),
        # 目标集里有这个字段(备用),我们没实际来源则沿用 timestamp。
        if "timestamp_perf" not in frame:
            parquet_row["timestamp_perf"] = frame["timestamp"]

        self._episode_buffer.append(parquet_row)
        self._frame_index += 1
        self._global_index += 1

    def save_episode(self) -> None:
        """落盘当前 episode 的 parquet + 图像 + 追加 episodes.jsonl。"""
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

        num_frames = len(self._episode_buffer)
        self._flush_images()

        chunk = self._episode_index // self.chunks_size
        chunk_dir = self.root / "data" / f"chunk-{chunk:03d}"
        chunk_dir.mkdir(parents=True, exist_ok=True)
        episode_path = chunk_dir / f"episode_{self._episode_index:06d}.parquet"
        table = pa.Table.from_pylist(self._episode_buffer)
        pq.write_table(table, episode_path)

        # meta/episodes.jsonl: 追加一行
        episode_meta = {
            "episode_index": self._episode_index,
            "length": num_frames,
            "tasks": list(self._episode_tasks),  # 本集出现的所有 task
            # task_index 是首个任务段对应的 task,参考目标集 episodes.jsonl 结构
            "task_index": self._tasks.get(self._episode_tasks[0], 0) if self._episode_tasks else 0,
        }
        with open(self.root / "meta" / "episodes.jsonl", "a") as f:
            f.write(json.dumps(episode_meta) + "\n")

        # meta/episodes_stats.jsonl: 追加空 stats(与目标集一致)
        stats_meta = {"episode_index": self._episode_index, "stats": {}}
        with open(self.root / "meta" / "episodes_stats.jsonl", "a") as f:
            f.write(json.dumps(stats_meta) + "\n")

        self._episode_buffer = []
        self._image_buffer = {k: [] for k in self._image_keys}
        self._episode_tasks = []
        self._episode_index += 1
        self._frame_index = 0

    def clear_episode_buffer(self) -> None:
        """清空当前 episode 缓冲(不保存),便于重来。"""
        self._episode_buffer = []
        self._image_buffer = {k: [] for k in self._image_keys}
        self._episode_tasks = []
        self._frame_index = 0

    def finalize(self) -> None:
        """完成数据集写入,落盘最后一个 episode(若有)并更新 info.json 统计。"""
        if self._episode_buffer:
            self.save_episode()

        # 写 tasks.jsonl(全局任务表)
        tasks_path = self.root / "meta" / "tasks.jsonl"
        tasks_path.write_text("")
        for task, idx in sorted(self._tasks.items(), key=lambda x: x[1]):
            with open(tasks_path, "a") as f:
                f.write(json.dumps({"task_index": idx, "task": task}) + "\n")

        # 更新 info.json 的统计字段
        info_path = self.root / "meta" / "info.json"
        with open(info_path, "r") as f:
            info = json.load(f)
        info["total_episodes"] = self._episode_index
        info["total_frames"] = self._global_index
        info["total_tasks"] = len(self._tasks)
        info["total_chunks"] = (self._episode_index // self.chunks_size) + (1 if self._episode_index % self.chunks_size else 0)
        # 视频总数 = episode数 × 相机数
        info["total_videos"] = self._episode_index * len(self._image_keys) if self.use_videos else 0
        # splits: 默认 train="0:total_episodes"
        info["splits"] = {"train": f"0:{self._episode_index}"}
        with open(info_path, "w") as f:
            json.dump(info, f, indent=2)

    # ---- internals ---------------------------------------------------

    def _chunk_of(self, episode_index: int) -> int:
        return episode_index // self.chunks_size

    def _video_path_for(self, video_key: str, episode_index: int) -> Path:
        """拼接某相机某集的视频相对路径(chunk目录)。"""
        return Path(VIDEO_PATH_TMPL.format(
            episode_chunk=self._chunk_of(episode_index),
            video_key=video_key,
            episode_index=episode_index,
        ))

    def _image_dir_for(self, video_key: str, episode_index: int) -> Path:
        """PNG 帧序列目录(与视频同路径去 .mp4,且 videos→images)。"""
        base = self._video_path_for(video_key, episode_index).with_suffix("")
        parts = ["images" if p == "videos" else p for p in base.parts]
        return Path(*parts)

    def _image_ref_path(self, image_key: str, frame_index: int) -> str:
        """parquet 里相机列存的路径字符串(视频 or 单帧 PNG)。"""
        if self.use_videos:
            return str(self._video_path_for(image_key, self._episode_index))
        return str(self._image_dir_for(image_key, self._episode_index) / f"frame_{frame_index:06d}.png")

    def _flush_images(self) -> None:
        """落盘图像: videos/chunk-NNN/{cam}/episode_NNNNNN.mp4 or images/.../{cam}/episode_NNNNNN/frame_*.png"""
        if not self._image_keys:
            return

        if self.use_videos:
            for image_key, frames in self._image_buffer.items():
                valid = [arr for arr in frames if arr is not None]
                if not valid:
                    continue
                rel = self._video_path_for(image_key, self._episode_index)
                encode_video_frames(
                    frames=valid,
                    output_path=self.root / rel,
                    fps=self.fps,
                )
            return

        # PNG 分支
        try:
            from PIL import Image
        except ImportError as e:
            raise RuntimeError(
                "piper_dataset with image features requires Pillow. "
                "Install piper_dataset/requirements.txt first."
            ) from e

        for image_key, frames in self._image_buffer.items():
            out_dir = self.root / self._image_dir_for(image_key, self._episode_index)
            out_dir.mkdir(parents=True, exist_ok=True)
            for idx, arr in enumerate(frames):
                if arr is None:
                    continue
                Image.fromarray(arr).save(out_dir / f"frame_{idx:06d}.png")

