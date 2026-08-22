"""Run roster-aware generation, checkpoint expansion, training, evaluation, and export."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from .common import CHECKPOINT_ROOT, DATA_ROOT, TRAINING_ROOT, load_roster, read_json
from .synthetic import SyntheticDataGenerator
from .validate_dataset import validate_dataset


def _safe_name(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-.")
    if not normalized:
        raise ValueError("Run and dataset names must contain letters or digits")
    return normalized


def _require_matching_cached_dataset(
    dataset_directory: Path,
    roster: dict[str, Any],
    train_images: int,
    validation_images: int,
    test_images: int,
    seed: int,
    focus_per_image: int,
) -> None:
    manifest_path = dataset_directory / "generation-manifest.json"
    if not manifest_path.is_file():
        raise RuntimeError(
            f"Cached synthetic dataset has no generation manifest: {manifest_path}"
        )
    manifest = read_json(manifest_path)
    expected = {
        "seed": seed,
        "splits": {
            "train": train_images,
            "val": validation_images,
            "test": test_images,
        },
        "imageSize": 256,
        "classCount": roster["classCount"],
        "classNames": [entry["assetKey"] for entry in roster["classes"]],
        "focusChampions": roster["focusChampions"],
        "focusPerImage": min(focus_per_image, len(roster["focusChampions"])),
    }
    mismatches = [
        key for key, expected_value in expected.items()
        if manifest.get(key) != expected_value
    ]
    if mismatches:
        raise RuntimeError(
            f"Cached synthetic dataset does not match this run ({', '.join(mismatches)}): "
            f"{dataset_directory}. Choose another --dataset-name."
        )


def run_pipeline(
    base_weights: Path,
    run_id: str,
    dataset_name: str,
    train_images: int,
    validation_images: int,
    test_images: int,
    head_epochs: int,
    epochs: int,
    batch: int,
    workers: int,
    device: str,
    seed: int,
    focus_per_image: int,
    generate_only: bool,
    publish_model: bool,
    minimum_map50: float,
    minimum_focus_map50: float,
) -> dict[str, Any]:
    run_id = _safe_name(run_id)
    dataset_name = _safe_name(dataset_name)
    roster = load_roster()
    dataset_directory = DATA_ROOT / "synthetic" / dataset_name
    dataset_config = dataset_directory / "config.yaml"

    if dataset_config.is_file():
        _require_matching_cached_dataset(
            dataset_directory,
            roster,
            train_images,
            validation_images,
            test_images,
            seed,
            focus_per_image,
        )
    else:
        generator = SyntheticDataGenerator(
            focus_champions=roster["focusChampions"],
            focus_per_image=focus_per_image,
            seed=seed,
        )
        generator.generate_data(
            n_train=train_images,
            n_val=validation_images,
            n_test=test_images,
            use_hsv_augmentation=True,
            use_noise=True,
            use_background_augment=True,
            use_icon_augment=True,
            yaml=True,
            allow_icon_overlap=True,
            use_recall_tp=True,
            viewport_sim=True,
            output_image_size=256,
            output_dir=str(DATA_ROOT / "synthetic"),
            dataset_name=dataset_name,
            num_workers=workers,
        )
    validation = validate_dataset(
        dataset_config,
        minimum_focus_instances=max(1, train_images // max(1, len(roster["focusChampions"]))),
    )
    summary: dict[str, Any] = {
        "runId": run_id,
        "dataset": str(dataset_config),
        "datasetValidation": validation,
        "focusChampions": roster["focusChampions"],
    }
    if generate_only:
        return summary

    from .evaluate import evaluate
    from .expand_checkpoint import expand_checkpoint
    from .publish import publish
    from .train import train

    base_weights = base_weights.resolve()
    if not base_weights.is_file():
        raise FileNotFoundError(
            f"Base checkpoint not found: {base_weights}. "
            "Run `pnpm minimap:download-base` or pass --base-weights."
        )
    CHECKPOINT_ROOT.mkdir(parents=True, exist_ok=True)
    expanded = CHECKPOINT_ROOT / f"{run_id}-expanded.pt"
    summary["expansion"] = expand_checkpoint(base_weights, expanded)
    training_source = expanded
    if head_epochs > 0:
        head_training = train(
            expanded,
            dataset_config,
            f"{run_id}-head",
            TRAINING_ROOT / "configs" / "head.yaml",
            epochs=head_epochs,
            batch=batch,
            workers=workers,
            device=device,
            seed=seed,
        )
        summary["headTraining"] = head_training
        training_source = Path(head_training["checkpoint"])
    training = train(
        training_source,
        dataset_config,
        run_id,
        TRAINING_ROOT / "configs" / "finetune.yaml",
        epochs=epochs,
        batch=batch,
        workers=workers,
        device=device,
        seed=seed,
    )
    summary["training"] = training
    evaluation = evaluate(
        Path(training["checkpoint"]),
        dataset_config,
        f"{run_id}-test",
        split="test",
        device=device,
        image_size=256,
    )
    summary["evaluation"] = {
        "reportPath": evaluation["reportPath"],
        "overall": evaluation["overall"],
        "focusChampions": evaluation["focusChampions"],
    }
    if publish_model:
        summary["published"] = publish(
            Path(training["checkpoint"]),
            Path(evaluation["reportPath"]),
            minimum_map50=minimum_map50,
            minimum_focus_map50=minimum_focus_map50,
        )
    return summary


def main() -> None:
    roster = load_roster()
    patch = str(roster["dataDragon"]["patch"])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-weights",
        type=Path,
        default=CHECKPOINT_ROOT / "upstream-yolo11m-minimap.pt",
    )
    parser.add_argument("--run-id", default=f"yolo11m-roster-{patch}")
    parser.add_argument("--dataset-name", default=f"lol-minimap-{patch}-focused")
    parser.add_argument("--n-train", type=int, default=100_000)
    parser.add_argument("--n-val", type=int, default=10_000)
    parser.add_argument("--n-test", type=int, default=10_000)
    parser.add_argument("--head-epochs", type=int, default=5)
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--device", default="0")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--focus-per-image", type=int, default=1)
    parser.add_argument("--generate-only", action="store_true")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--minimum-map50", type=float, default=0.75)
    parser.add_argument("--minimum-focus-map50", type=float, default=0.60)
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="Use a tiny dataset and one epoch to verify plumbing, not model quality",
    )
    arguments = parser.parse_args()
    if arguments.smoke:
        arguments.n_train = 30
        arguments.n_val = 9
        arguments.n_test = 9
        arguments.epochs = 1
        arguments.head_epochs = 0
        arguments.batch = min(arguments.batch, 8)
        arguments.workers = min(arguments.workers, 2)
        arguments.run_id = f"{arguments.run_id}-smoke"
        arguments.dataset_name = f"{arguments.dataset_name}-smoke"
        if arguments.publish:
            parser.error("--smoke cannot be combined with --publish")
    result = run_pipeline(
        arguments.base_weights,
        arguments.run_id,
        arguments.dataset_name,
        arguments.n_train,
        arguments.n_val,
        arguments.n_test,
        arguments.head_epochs,
        arguments.epochs,
        arguments.batch,
        arguments.workers,
        arguments.device,
        arguments.seed,
        arguments.focus_per_image,
        arguments.generate_only,
        arguments.publish,
        arguments.minimum_map50,
        arguments.minimum_focus_map50,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
