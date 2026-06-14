"""
Robot specification for piper_dataset.

用于描述当前机器人的构型，dataset feature schema 会根据这个 spec 动态生成。
保持最小：只描述“有哪些可记录的实体”，不描述控制器/硬件细节。
"""

from dataclasses import dataclass, field
from typing import Literal

ControlMode = Literal["joint", "ee"]


@dataclass
class ArmSpec:
    """单条手臂的构型。"""

    name: str                       # 例如 "left_arm" / "right_arm"
    num_joints: int                 # 不包括夹爪
    has_gripper: bool = True
    has_ee_pose: bool = True        # observation 里是否有末端位姿


@dataclass
class TorsoSpec:
    """躯干构型（可选）。"""

    name: str = "torso"
    has_pose: bool = True           # xyz
    has_rpy: bool = True


@dataclass
class ChassisSpec:
    """底盘构型（可选，速度）。"""

    name: str = "chassis"


@dataclass
class CameraSpec:
    """单路相机构型。"""

    name: str                       # 例如 "front" / "wrist_left" / "wrist_right"
    width: int
    height: int
    channels: int = 3               # RGB 默认 3 通道
    fps: int | None = None          # 可选，便于 metadata 记录


@dataclass
class RobotSpec:
    """机器人整体构型。

    传给 build_piper_features 来生成 feature schema。
    """

    arms: list[ArmSpec] = field(default_factory=list)
    torso: TorsoSpec | None = None
    chassis: ChassisSpec | None = None
    cameras: list[CameraSpec] = field(default_factory=list)
    name: str | None = None


@dataclass
class ActionSpec:
    """
    定义一条手臂的动作字段。

    - control_mode="joint": 记录 joint_positions + gripper
    - control_mode="ee":    记录 position + rotation_rpy + gripper
    """

    arm_name: str
    control_mode: ControlMode = "ee"
    include_enabled: bool = True
    include_control_mode: bool = True
