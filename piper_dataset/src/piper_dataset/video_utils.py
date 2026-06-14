"""
Minimal video utilities for piper_dataset.

用 PyAV 把一段 numpy uint8 HxWxC 帧编码成 MP4。
刻意不引入 lerobot 的完整 video_utils（它依赖 torch/torchvision/fsspec/datasets）。
"""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path
from typing import Iterable, Iterator

import numpy as np

DEFAULT_VCODEC = "libx264"
DEFAULT_PIX_FMT = "yuv420p"
DEFAULT_CRF = 23


def encode_video_frames(
    frames: Iterable[np.ndarray],
    output_path: str | Path,
    fps: int,
    vcodec: str = DEFAULT_VCODEC,
    pix_fmt: str = DEFAULT_PIX_FMT,
    crf: int = DEFAULT_CRF,
) -> Path:
    """
    把一段 frames 编码成 MP4。frames 是 uint8、HxWxC、RGB。
    """
    try:
        import av
    except ImportError as e:
        raise RuntimeError(
            "piper_dataset video encoding requires PyAV. "
            "Install via `pip install av` or add 'av' to requirements.txt."
        ) from e

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    it: Iterator[np.ndarray] = iter(frames)
    try:
        first = next(it)
    except StopIteration:
        raise ValueError("encode_video_frames: no frames provided")

    if first.dtype != np.uint8:
        raise ValueError(f"frames must be uint8, got {first.dtype}")
    if first.ndim != 3 or first.shape[2] != 3:
        raise ValueError(f"frames must be HxWx3, got shape {first.shape}")

    height, width, _ = first.shape

    container = av.open(str(output_path), mode="w")
    try:
        stream = container.add_stream(vcodec, rate=fps)
        stream.width = width
        stream.height = height
        stream.pix_fmt = pix_fmt
        stream.time_base = Fraction(1, fps)
        if vcodec in ("libx264", "libx265"):
            stream.options = {"crf": str(crf), "preset": "medium"}

        def _encode(arr: np.ndarray, idx: int) -> None:
            if arr.dtype != np.uint8 or arr.ndim != 3 or arr.shape != (height, width, 3):
                raise ValueError(
                    f"frame {idx}: expected uint8 ({height},{width},3), got {arr.dtype} {arr.shape}"
                )
            frame = av.VideoFrame.from_ndarray(arr, format="rgb24")
            frame.pts = idx
            for packet in stream.encode(frame):
                container.mux(packet)

        _encode(first, 0)
        for idx, arr in enumerate(it, start=1):
            _encode(arr, idx)

        for packet in stream.encode():
            container.mux(packet)
    finally:
        container.close()

    return output_path
