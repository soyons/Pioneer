from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass
class PiperDatasetConfig:
    repo_id: str = ""
    root: str | Path | None = None
    fps: int = 30
    single_task: str = ""
    num_episodes: int = 50
    robot_type: str | None = None
    use_videos: bool = False

    def stamp_repo_id(self) -> None:
        if self.repo_id:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            self.repo_id = f"{self.repo_id}_{timestamp}"
