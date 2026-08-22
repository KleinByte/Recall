"""Evaluate a trained minimap YOLO checkpoint, including focus-class metrics."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from ultralytics import YOLO

from .common import (
    RUN_ROOT,
    load_roster,
    require_target_names,
    resolve_dataset,
    sha256_file,
    write_metadata,
)
from .validate_dataset import validate_dataset


def evaluate(
    weights: Path,
    dataset: str | Path,
    evaluation_id: str,
    split: str = "test",
    device: str = "0",
    image_size: int = 256,
    minimum_focus_instances: int = 1,
) -> dict[str, Any]:
    weights = weights.resolve()
    dataset_config = resolve_dataset(dataset)
    validate_dataset(dataset_config, minimum_focus_instances=minimum_focus_instances)
    model = YOLO(str(weights))
    names = require_target_names(model.names)
    project = (RUN_ROOT / "evaluations").resolve()
    metrics = model.val(
        data=str(dataset_config),
        split=split,
        device=device,
        imgsz=image_size,
        project=str(project),
        name=evaluation_id,
        exist_ok=False,
        plots=True,
    )
    save_directory = Path(metrics.save_dir).resolve()
    roster = load_roster()
    per_class: dict[str, Any] = {
        name: {
            "evaluated": False,
            "precision": 0.0,
            "recall": 0.0,
            "mAP50": 0.0,
            "mAP50_95": 0.0,
        }
        for name in names
    }
    if hasattr(metrics, "class_result") and hasattr(metrics, "ap_class_index"):
        for result_index, class_index in enumerate(metrics.ap_class_index):
            name = names[int(class_index)]
            precision, recall, map50, map50_95 = metrics.class_result(result_index)
            per_class[name] = {
                "evaluated": True,
                "precision": float(precision),
                "recall": float(recall),
                "mAP50": float(map50),
                "mAP50_95": float(map50_95),
            }

    speed = metrics.speed
    total_milliseconds = sum(float(speed.get(key, 0)) for key in ("preprocess", "inference", "postprocess"))
    report = {
        "schemaVersion": 1,
        "outputDirectory": str(save_directory),
        "reportPath": str(save_directory / "evaluation.json"),
        "weights": str(weights),
        "weightsSha256": sha256_file(weights),
        "datasetConfig": str(dataset_config),
        "split": split,
        "classCount": len(names),
        "overall": {
            "precision": float(metrics.box.mp),
            "recall": float(metrics.box.mr),
            "mAP50": float(metrics.box.map50),
            "mAP50_95": float(metrics.box.map),
            "fps": 1000.0 / total_milliseconds if total_milliseconds > 0 else 0.0,
        },
        "focusChampions": {
            name: per_class.get(name, {}) for name in roster["focusChampions"]
        },
        "perClass": per_class,
    }
    report_path = Path(report["reportPath"])
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    write_metadata(save_directory, {
        "mode": "evaluate",
        "evaluationId": evaluation_id,
        "report": report,
    })
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", required=True, type=Path)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--evaluation-id", required=True)
    parser.add_argument("--split", choices=("train", "val", "test"), default="test")
    parser.add_argument("--device", default="0")
    parser.add_argument("--imgsz", type=int, default=256)
    parser.add_argument("--minimum-focus-instances", type=int, default=1)
    arguments = parser.parse_args()
    print(json.dumps(evaluate(
        arguments.weights,
        arguments.dataset,
        arguments.evaluation_id,
        arguments.split,
        arguments.device,
        arguments.imgsz,
        arguments.minimum_focus_instances,
    ), indent=2))


if __name__ == "__main__":
    main()
