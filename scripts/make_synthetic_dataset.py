#!/usr/bin/env python3
"""生成一个最小 piper_dataset_v1 数据集,用于验证 Depot 查看器。

只依赖 piper_dataset 写入器本身(pyarrow + av),产出:
  <root>/synthetic_pickplace/
      meta/info.json
      data/chunk-000/episode_0000{0,1}.parquet
      videos/observation.images.<cam>/episode_0000{0,1}.mp4
"""
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, "/workspace/piper_dataset/src")
from piper_dataset.dataset import PiperDataset  # noqa: E402

ROOT = Path("/workspace/piper_dataset/data/synthetic_pickplace")
FPS = 30
CAMS = ["observation.images.front", "observation.images.left_wrist", "observation.images.right_wrist"]
H, W = 120, 160


def make_features() -> dict:
    feats = {
        # 左臂
        "observation.state.left_arm.joint_positions": {"dtype": "float64", "shape": [6]},
        "observation.state.left_arm.gripper": {"dtype": "float32", "shape": []},
        "action.left_arm.joint_positions": {"dtype": "float32", "shape": [6]},
        "action.left_arm.gripper": {"dtype": "float32", "shape": []},
        # 右臂
        "observation.state.right_arm.joint_positions": {"dtype": "float64", "shape": [6]},
        "observation.state.right_arm.gripper": {"dtype": "float32", "shape": []},
        "action.right_arm.joint_positions": {"dtype": "float32", "shape": [6]},
        "action.right_arm.gripper": {"dtype": "float32", "shape": []},
        # torso 躯干
        "observation.state.torso.position": {"dtype": "float64", "shape": [3]},
        "observation.state.torso.rpy": {"dtype": "float64", "shape": [3]},
        # base 底盘
        "observation.state.base.linear": {"dtype": "float32", "shape": [3]},
        "observation.state.base.angular": {"dtype": "float32", "shape": [3]},
        # 公共
        "timestamp": {"dtype": "float64", "shape": []},
        "task": {"dtype": "string", "shape": []},
    }
    for cam in CAMS:
        feats[cam] = {"dtype": "image", "shape": [H, W, 3], "fps": FPS}
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
        ljoints = [a * (0.5 + 0.1 * j) for j in range(6)]
        rjoints = [b * (0.5 + 0.1 * j) for j in range(6)]
        lgrip = 0.5 + 0.5 * math.sin(phase + t * 0.2)
        rgrip = 0.5 + 0.5 * math.cos(phase + t * 0.2)
        frame = {
            "observation.state.left_arm.joint_positions": [j + 0.02 for j in ljoints],
            "observation.state.left_arm.gripper": float(lgrip),
            "action.left_arm.joint_positions": [float(j) for j in ljoints],
            "action.left_arm.gripper": float(lgrip),
            "observation.state.right_arm.joint_positions": [j + 0.02 for j in rjoints],
            "observation.state.right_arm.gripper": float(rgrip),
            "action.right_arm.joint_positions": [float(j) for j in rjoints],
            "action.right_arm.gripper": float(rgrip),
            "observation.state.torso.position": [0.0, 0.0, 0.2 + 0.05 * a],
            "observation.state.torso.rpy": [0.0, 0.1 * a, 0.0],
            "observation.state.base.linear": [0.1 * a, 0.0, 0.0],
            "observation.state.base.angular": [0.0, 0.0, 0.2 * b],
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
    print("Done.")


if __name__ == "__main__":
    main()
