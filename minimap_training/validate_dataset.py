"""Validate YOLO dataset integrity and newest-champion coverage."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

import yaml

from .common import load_roster, normalize_names, resolve_dataset


IMAGE_EXTENSIONS = {".bmp", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}


def _dataset_root(config_path: Path, config: dict[str, Any]) -> Path:
    configured = Path(str(config.get("path", config_path.parent)))
    return configured.resolve() if configured.is_absolute() else (config_path.parent / configured).resolve()


def validate_dataset(
    dataset: str | Path,
    minimum_focus_instances: int = 1,
    write_report: bool = True,
) -> dict[str, Any]:
    config_path = resolve_dataset(dataset)
    config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    roster = load_roster()
    expected_names = [entry["assetKey"] for entry in roster["classes"]]
    configured_names = normalize_names(config.get("names"))
    if configured_names != expected_names or int(config.get("nc", -1)) != len(expected_names):
        raise RuntimeError("Dataset class map does not exactly match minimap_training/roster.json")

    root = _dataset_root(config_path, config)
    totals: Counter[int] = Counter()
    split_reports: dict[str, Any] = {}
    errors: list[str] = []

    for split in ("train", "val", "test"):
        configured_images = config.get(split)
        if not configured_images:
            errors.append(f"Dataset config has no {split} split")
            continue
        image_directory = root / str(configured_images)
        label_directory = image_directory.parent / "labels"
        images = sorted(
            path for path in image_directory.glob("*")
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        )
        labels = sorted(label_directory.glob("*.txt")) if label_directory.is_dir() else []
        image_stems = {path.stem for path in images}
        label_stems = {path.stem for path in labels}
        for stem in sorted(image_stems - label_stems):
            errors.append(f"{split}: image has no label file: {stem}")
        for stem in sorted(label_stems - image_stems):
            errors.append(f"{split}: label has no image file: {stem}")

        counts: Counter[int] = Counter()
        boxes = 0
        for label_path in labels:
            for line_number, line in enumerate(label_path.read_text(encoding="utf-8").splitlines(), start=1):
                if not line.strip():
                    continue
                fields = line.split()
                if len(fields) != 5:
                    errors.append(f"{label_path}:{line_number}: expected five YOLO fields")
                    continue
                try:
                    class_id = int(fields[0])
                    coordinates = [float(value) for value in fields[1:]]
                except ValueError:
                    errors.append(f"{label_path}:{line_number}: non-numeric YOLO label")
                    continue
                if not 0 <= class_id < len(expected_names):
                    errors.append(f"{label_path}:{line_number}: class ID {class_id} is out of range")
                    continue
                if not all(0 <= value <= 1 for value in coordinates) or coordinates[2] <= 0 or coordinates[3] <= 0:
                    errors.append(f"{label_path}:{line_number}: invalid normalized bounding box")
                    continue
                counts[class_id] += 1
                totals[class_id] += 1
                boxes += 1

        split_reports[split] = {
            "images": len(images),
            "labels": len(labels),
            "boxes": boxes,
            "classInstances": {
                expected_names[class_id]: counts[class_id]
                for class_id in range(len(expected_names))
            },
        }

    focus_counts = {
        champion: totals[expected_names.index(champion)]
        for champion in roster["focusChampions"]
    }
    insufficient_focus = {
        champion: count
        for champion, count in focus_counts.items()
        if count < minimum_focus_instances
    }
    if insufficient_focus:
        errors.append(
            "Focus coverage is below the required minimum: " +
            ", ".join(f"{name}={count}" for name, count in insufficient_focus.items())
        )

    report = {
        "schemaVersion": 1,
        "datasetConfig": str(config_path),
        "classCount": len(expected_names),
        "focusChampions": roster["focusChampions"],
        "focusInstances": focus_counts,
        "totalBoxes": sum(totals.values()),
        "splits": split_reports,
        "errors": errors,
        "valid": not errors,
    }
    if write_report:
        report_path = config_path.parent / "dataset-validation.json"
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if errors:
        preview = "\n- ".join(errors[:20])
        suffix = f"\n... and {len(errors) - 20} more" if len(errors) > 20 else ""
        raise RuntimeError(f"Dataset validation failed:\n- {preview}{suffix}")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", help="Dataset name, directory, or config.yaml path")
    parser.add_argument("--minimum-focus-instances", type=int, default=1)
    arguments = parser.parse_args()
    report = validate_dataset(arguments.dataset, arguments.minimum_focus_instances)
    print(json.dumps({
        "valid": report["valid"],
        "classCount": report["classCount"],
        "totalBoxes": report["totalBoxes"],
        "focusInstances": report["focusInstances"],
    }, indent=2))


if __name__ == "__main__":
    main()
