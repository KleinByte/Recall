"""Train or fine-tune YOLO11 on a validated minimap dataset."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import yaml
from ultralytics import YOLO

from .common import RUN_ROOT, TRAINING_ROOT, require_target_names, resolve_dataset, write_metadata
from .validate_dataset import validate_dataset


def load_training_config(path: Path) -> dict[str, Any]:
    config = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(config, dict):
        raise RuntimeError(f"Training config is not a mapping: {path}")
    return config


def train(
    weights: Path,
    dataset: str | Path,
    run_id: str,
    config_path: Path | None = None,
    **overrides: Any,
) -> dict[str, Any]:
    weights = weights.resolve()
    if not weights.is_file():
        raise FileNotFoundError(f"Training checkpoint was not found: {weights}")
    dataset_config = resolve_dataset(dataset)
    validation = validate_dataset(dataset_config)
    selected_config = (config_path or TRAINING_ROOT / "configs" / "train.yaml").resolve()
    config = load_training_config(selected_config)
    config.update({key: value for key, value in overrides.items() if value is not None})
    config.pop("pretrained", None)

    os.environ.setdefault("WANDB_DISABLED", "true")
    project = RUN_ROOT.resolve()
    model = YOLO(str(weights))
    require_target_names(model.names)
    result = model.train(
        data=str(dataset_config),
        project=str(project),
        name=run_id,
        exist_ok=False,
        **config,
    )
    save_directory = Path(result.save_dir).resolve()
    best = save_directory / "weights" / "best.pt"
    last = save_directory / "weights" / "last.pt"
    selected = best if best.is_file() else last
    if not selected.is_file():
        raise RuntimeError(f"Ultralytics did not produce a checkpoint under {save_directory}")
    require_target_names(YOLO(str(selected)).names)
    metadata_path = write_metadata(save_directory, {
        "mode": "train",
        "runId": run_id,
        "weights": str(weights),
        "datasetConfig": str(dataset_config),
        "datasetValidation": validation,
        "trainingConfig": str(selected_config),
        "effectiveArguments": config,
        "selectedCheckpoint": str(selected),
    })
    return {
        "runDirectory": str(save_directory),
        "checkpoint": str(selected),
        "metadata": str(metadata_path),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", required=True, type=Path)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--epochs", type=int)
    parser.add_argument("--batch", type=int)
    parser.add_argument("--device")
    parser.add_argument("--workers", type=int)
    arguments = parser.parse_args()
    result = train(
        arguments.weights,
        arguments.dataset,
        arguments.run_id,
        arguments.config,
        epochs=arguments.epochs,
        batch=arguments.batch,
        device=arguments.device,
        workers=arguments.workers,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
