#!/usr/bin/env python3
"""生成一个最小 piper_dataset v2.1 数据集,用于验证 Depot 查看器。

只依赖 piper_dataset 写入器本身(pyarrow + av),产出:
  <root>/synthetic_pickplace/
      meta/info.json
      meta/episodes.jsonl / tasks.jsonl / episodes_stats.jsonl
      data/chunk-000/episode_0000{0,1}.parquet
      videos/chunk-000/<cam>/episode_0000{0,1}.mp4
"""
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, "/workspace/piper_dataset/src")
from piper_dataset.dataset import PiperDataset  # noqa: E402

ROOT = Path("/workspace/piper_dataset/data/synthetic_pickplace")
FPS = 30
# v2.1 用 cam_* 前缀(对齐目标集)
CAMS = ["cam_front", "cam_left_wrist", "cam_right_wrist"]
H, W = 120, 160


def make_features() -> dict:
    """手工构造 feature schema(v2.1 下划线命名风格,不走 spec.py)。"""
    feats = {
        "timestamp": {"dtype": "float32", "shape": [1], "names": [], "info": None},
        "timestamp_perf": {"dtype": "float64", "shape": [1], "names": [], "info": None},
        "frame_index": {"dtype": "int64", "shape": [1], "names": [], "info": None},
        "episode_index": {"dtype": "int64", "shape": [1], "names": [], "info": None},
        "index": {"dtype": "int64", "shape": [1], "names": [], "info": None},
        "task_index": {"dtype": "int64", "shape": [1], "names": [], "info": None},
    }
    # 双臂 cmd+state(简化 schema,只写 cart_pos)
    for arm in ["leftarm", "rightarm"]:
        feats[f"{arm}_cmd_cart_pos"] = {
            "dtype": "float32", "shape": [6], "names": ["x","y","z","rx","ry","rz"], "info": None
        }
        feats[f"{arm}_state_cart_pos"] = {
            "dtype": "float32", "shape": [6], "names": ["x","y","z","rx","ry","rz"], "info": None
        }
        feats[f"{arm}_gripper_cmd_pos"] = {
            "dtype": "float32", "shape": [1], "names": ["0"], "info": None
        }
        feats[f"{arm}_gripper_state_pos"] = {
            "dtype": "float32", "shape": [1], "names": ["0"], "info": None
        }
    # 3 相机
    for cam in CAMS:
        feats[cam] = {
            "dtype": "video",
            "shape": [H, W, 3],
            "names": ["height","width","channels"],
            "info": {"format": "rgb"},
        }
    return feats


def synth_frame(cam: str, t: int, phase: float):
    """画一个随时间移动的色块,便于肉眼确认每集/每相机不同。"""
    img = np.zeros((H, W, 3), dtype=np.uint8)
    cx = int((0.5 + 0.4 * math.sin(phase + t * 0.15)) * W)
    cy = int((0.5 + 0.4 * math.cos(phase + t * 0.15)) * H)
    if "front" in cam:
        color = (255, 80, 40)
    elif "left" in cam:
        color = (40, 160, 255)
    else:
        color = (60, 220, 120)
    y0, y1 = max(0, cy - 15), min(H, cy + 15)
    x0, x1 = max(0, cx - 15), min(W, cx + 15)
    img[y0:y1, x0:x1] = color
    img[:, :, 1] = (img[:, :, 1] + (t * 3) % 60).astype(np.uint8)
    return img


def write_episode(ds: PiperDataset, eid: int, num_frames: int):
    phase = eid * 1.7
    for t in range(num_frames):
        a = math.sin(phase + t * 0.1)
        b = math.cos(phase + t * 0.12)
        lcart = [0.3 + 0.05 * a, -0.4, -0.25, -1.2, 0.0, 0.0]
        rcart = [-0.3 + 0.05 * b, -0.4, -0.25, 1.2, 0.0, 0.0]
        lgrip = 0.5 + 0.5 * math.sin(phase + t * 0.2)
        rgrip = 0.5 + 0.5 * math.cos(phase + t * 0.2)
        frame = {
            "leftarm_cmd_cart_pos": [float(x) for x in lcart],
            "leftarm_state_cart_pos": [x + 0.002 for x in lcart],
            "leftarm_gripper_cmd_pos": [float(lgrip)],
            "leftarm_gripper_state_pos": [float(lgrip) - 0.003],
            "rightarm_cmd_cart_pos": [float(x) for x in rcart],
            "rightarm_state_cart_pos": [x + 0.002 for x in rcart],
            "rightarm_gripper_cmd_pos": [float(rgrip)],
            "rightarm_gripper_state_pos": [float(rgrip) - 0.003],
            "timestamp": t / float(FPS),
            "task": "抓取放置",
        }
        for cam in CAMS:
            frame[cam] = synth_frame(cam, t, phase)
        ds.add_frame(frame)
    ds.save_episode()
    print(f"  episode {eid}: {num_frames} frames written")


def main():
    if ROOT.exists():
        import shutil
        shutil.rmtree(ROOT)
    ds = PiperDataset.create(
        repo_id="synthetic/pickplace",
        fps=FPS,
        features=make_features(),
        root=ROOT,
        robot_type="piper_bimanual",
        use_videos=True,
    )
    print(f"Creating synthetic dataset at {ROOT}")
    write_episode(ds, 0, 90)
    write_episode(ds, 1, 60)
    ds.finalize()
    print("Done.")


if __name__ == "__main__":
    main()
