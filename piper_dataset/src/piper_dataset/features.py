"""
根据机器人构型 (RobotSpec) + 动作定义 (ActionSpec) 动态生成 feature schema。

设计原则：
- 不写死任何一个字段，schema 完全由传入的 spec 决定
- 保持扁平 key（类似 lerobot 的 "observation.*" / "action.*"）
- 支持单臂 / 多臂 / 不同自由度 / joint 或 ee 动作
- 支持 N 路相机图像（observation.images.{camera_name}）
"""

from .spec import ActionSpec, ArmSpec, CameraSpec, ChassisSpec, RobotSpec, TorsoSpec


def _arm_observation_features(arm: ArmSpec, prefix: str) -> dict:
    feats: dict = {}
    key_prefix = f"{prefix}.{arm.name}"

    feats[f"{key_prefix}.joint_positions"] = {
        "dtype": "float64",
        "shape": [arm.num_joints],
    }

    if arm.has_gripper:
        feats[f"{key_prefix}.gripper"] = {
            "dtype": "float32",
            "shape": [],
        }

    if arm.has_ee_pose:
        feats[f"{key_prefix}.ee_position"] = {
            "dtype": "float64",
            "shape": [3],
        }
        feats[f"{key_prefix}.ee_rpy"] = {
            "dtype": "float64",
            "shape": [3],
        }

    return feats


def _torso_observation_features(torso: TorsoSpec, prefix: str) -> dict:
    feats: dict = {}
    key_prefix = f"{prefix}.{torso.name}"
    if torso.has_pose:
        feats[f"{key_prefix}.position"] = {
            "dtype": "float64",
            "shape": [3],
        }
    if torso.has_rpy:
        feats[f"{key_prefix}.rpy"] = {
            "dtype": "float64",
            "shape": [3],
        }
    return feats


def _chassis_observation_features(chassis: ChassisSpec, prefix: str) -> dict:
    key_prefix = f"{prefix}.{chassis.name}"
    return {
        f"{key_prefix}.linear": {
            "dtype": "float32",
            "shape": [3],
        },
        f"{key_prefix}.angular": {
            "dtype": "float32",
            "shape": [3],
        },
    }


def _camera_observation_features(camera: CameraSpec, prefix: str) -> dict:
    """N 路相机图像 feature,shape = [H, W, C],dtype = video(v2.1 风格)。"""
    meta = {
        "dtype": "video",
        "shape": [camera.height, camera.width, camera.channels],
        "names": ["height", "width", "channels"],
        "info": {"format": "rgb"},
    }
    if camera.fps is not None:
        meta["fps"] = camera.fps
    return {
        f"{prefix}.{camera.name}": meta,
    }


def _arm_action_features(action: ActionSpec, arm: ArmSpec, prefix: str) -> dict:
    feats: dict = {}
    key_prefix = f"{prefix}.{arm.name}"

    if action.control_mode == "joint":
        feats[f"{key_prefix}.joint_positions"] = {
            "dtype": "float32",
            "shape": [arm.num_joints],
        }
    elif action.control_mode == "ee":
        feats[f"{key_prefix}.position"] = {
            "dtype": "float32",
            "shape": [3],
        }
        feats[f"{key_prefix}.rotation_rpy"] = {
            "dtype": "float32",
            "shape": [3],
        }
    else:
        raise ValueError(f"Unknown control_mode: {action.control_mode}")

    if arm.has_gripper:
        feats[f"{key_prefix}.gripper"] = {
            "dtype": "float32",
            "shape": [],
        }

    if action.include_enabled:
        feats[f"{key_prefix}.enabled"] = {
            "dtype": "bool",
            "shape": [],
        }

    if action.include_control_mode:
        feats[f"{key_prefix}.control_mode"] = {
            "dtype": "string",
            "shape": [],
        }

    return feats


def build_piper_features(
    robot: RobotSpec,
    actions: list[ActionSpec],
    include_timestamp: bool = True,
    include_task: bool = True,
    observation_prefix: str = "observation.state",
    image_prefix: str = "observation.images",
    action_prefix: str = "action",
) -> dict:
    """
    根据机器人构型和动作定义生成 feature schema。

    Args:
        robot: 机器人构型（arms / torso / chassis / cameras）。
        actions: 需要记录的动作条目（每条手臂一个 ActionSpec）。
        include_timestamp: 是否加入 timestamp 字段。
        include_task: 是否加入 task 字符串字段。
        observation_prefix: 低维 observation 前缀。
        image_prefix: 相机图像前缀。
        action_prefix: action 前缀。

    Returns:
        dict[str, dict]: feature schema，可直接传给 PiperDataset.create(features=...)
    """
    if not robot.arms:
        raise ValueError("RobotSpec.arms cannot be empty")

    arm_by_name = {arm.name: arm for arm in robot.arms}

    feats: dict = {}

    for arm in robot.arms:
        feats.update(_arm_observation_features(arm, observation_prefix))

    if robot.torso is not None:
        feats.update(_torso_observation_features(robot.torso, observation_prefix))

    if robot.chassis is not None:
        feats.update(_chassis_observation_features(robot.chassis, observation_prefix))

    seen_camera_names: set[str] = set()
    for camera in robot.cameras:
        if camera.name in seen_camera_names:
            raise ValueError(f"Duplicate camera name in RobotSpec.cameras: '{camera.name}'")
        seen_camera_names.add(camera.name)
        feats.update(_camera_observation_features(camera, image_prefix))

    for action in actions:
        if action.arm_name not in arm_by_name:
            raise ValueError(
                f"ActionSpec references unknown arm '{action.arm_name}'. "
                f"Available arms: {list(arm_by_name)}"
            )
        feats.update(_arm_action_features(action, arm_by_name[action.arm_name], action_prefix))

    if include_timestamp:
        feats["timestamp"] = {
            "dtype": "float64",
            "shape": [],
        }
    if include_task:
        feats["task"] = {
            "dtype": "string",
            "shape": [],
        }

    return feats
