"""Reproducible training tools for Recall's minimap champion detector."""

import os
from pathlib import Path

_repository_root = Path(__file__).resolve().parents[1]
os.environ.setdefault("YOLO_CONFIG_DIR", str(_repository_root / ".minimap-training" / "ultralytics"))
os.environ.setdefault("NO_ALBUMENTATIONS_UPDATE", "1")
os.environ.setdefault("WANDB_DISABLED", "true")

__all__ = ["__version__"]

__version__ = "1.0.0"
