"""Gate, export, and publish a trained checkpoint as Recall's bundled ONNX model."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
from pathlib import Path
from typing import Any

from ultralytics import YOLO

from .common import REPOSITORY_ROOT, git_state, load_roster, require_target_names, sha256_file


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _load_evaluation(path: Path | None, skip_metric_gate: bool) -> dict[str, Any] | None:
    if path is None:
        if skip_metric_gate:
            return None
        raise RuntimeError("Publishing requires an evaluation report unless --skip-metric-gate is used")
    return json.loads(path.read_text(encoding="utf-8"))


def _enforce_metrics(
    evaluation: dict[str, Any] | None,
    checkpoint_sha256: str,
    roster: dict[str, Any],
    minimum_map50: float,
    minimum_focus_map50: float,
) -> None:
    if evaluation is None:
        return
    if evaluation.get("schemaVersion") != 1:
        raise RuntimeError("Evaluation report schema is unsupported")
    if evaluation.get("weightsSha256") != checkpoint_sha256:
        raise RuntimeError("Evaluation report does not belong to the checkpoint being published")
    if evaluation.get("split") != "test":
        raise RuntimeError("Publishing requires metrics from the held-out test split")
    if evaluation.get("classCount") != roster["classCount"]:
        raise RuntimeError("Evaluation class count does not match the training roster")

    expected_names = [entry["assetKey"] for entry in roster["classes"]]
    per_class = evaluation.get("perClass")
    if not isinstance(per_class, dict) or list(per_class) != expected_names:
        raise RuntimeError("Evaluation per-class results do not match the training roster")
    unevaluated = [
        name for name in expected_names
        if per_class.get(name, {}).get("evaluated") is not True
    ]
    if unevaluated:
        raise RuntimeError(
            "Evaluation test split has no valid result for: " + ", ".join(unevaluated)
        )

    overall = float(evaluation.get("overall", {}).get("mAP50", float("nan")))
    if not math.isfinite(overall):
        raise RuntimeError("Overall mAP50 is missing or non-finite")
    if overall < minimum_map50:
        raise RuntimeError(f"Overall mAP50 {overall:.4f} is below the gate {minimum_map50:.4f}")

    focus_results = evaluation.get("focusChampions")
    expected_focus = roster["focusChampions"]
    if not isinstance(focus_results, dict) or list(focus_results) != expected_focus:
        raise RuntimeError("Evaluation focus-class results do not match the training roster")
    failures = []
    for champion in expected_focus:
        metrics = focus_results[champion]
        score = float(metrics.get("mAP50", float("nan")))
        if metrics.get("evaluated") is not True or not math.isfinite(score):
            raise RuntimeError(f"Focus-class evaluation is missing or invalid: {champion}")
        if score < minimum_focus_map50:
            failures.append(f"{champion}={score:.4f}")
    if failures:
        raise RuntimeError(
            f"Focus-class mAP50 is below {minimum_focus_map50:.4f}: {', '.join(failures)}"
        )


def publish(
    checkpoint: Path,
    evaluation_path: Path | None = None,
    output_directory: Path | None = None,
    minimum_map50: float = 0.75,
    minimum_focus_map50: float = 0.60,
    skip_metric_gate: bool = False,
) -> dict[str, Any]:
    checkpoint = checkpoint.resolve()
    output_directory = (output_directory or REPOSITORY_ROOT / "resources" / "minimap-model").resolve()
    evaluation = _load_evaluation(evaluation_path, skip_metric_gate)
    checkpoint_sha256 = sha256_file(checkpoint)
    roster = load_roster()
    if not skip_metric_gate:
        _enforce_metrics(
            evaluation,
            checkpoint_sha256,
            roster,
            minimum_map50,
            minimum_focus_map50,
        )

    model = YOLO(str(checkpoint))
    labels = require_target_names(model.names)
    exported = Path(model.export(
        format="onnx",
        imgsz=256,
        batch=1,
        dynamic=False,
        simplify=False,
        opset=17,
        nms=False,
        half=False,
        device="cpu",
    )).resolve()

    output_directory.mkdir(parents=True, exist_ok=True)
    artifact_path = output_directory / "yolo11m-minimap.onnx"
    shutil.copy2(exported, artifact_path)
    labels_path = output_directory / "labels.json"
    labels_path.write_text(json.dumps(labels, indent=2) + "\n", encoding="utf-8")
    artifact_bytes = artifact_path.read_bytes()
    state = git_state()
    manifest = {
        "schemaVersion": 1,
        "model": "Recall YOLO11m League of Legends Minimap Detection",
        "repository": "https://github.com/KleinByte/Recall",
        "revision": state["commit"] or "working-tree",
        "sourceFile": checkpoint.name,
        "sourceSha256": checkpoint_sha256,
        "artifactFile": artifact_path.name,
        "artifactSha256": _sha256_bytes(artifact_bytes),
        "artifactBytes": len(artifact_bytes),
        "format": "onnx",
        "opset": 17,
        "input": {"name": "images", "shape": [1, 3, 256, 256], "color": "RGB", "range": [0, 1]},
        "classCount": len(labels),
        "labelsFile": labels_path.name,
        "license": "CC-BY-NC-4.0",
        "attribution": "boboyes/leagueoflegends-minimap-detection and bsowlx/DeepestLeague",
        "training": {
            "dataDragonPatch": roster["dataDragon"]["patch"],
            "rosterSha256": sha256_file(Path(__file__).resolve().parent / "roster.json"),
            "baseModel": roster["baseModel"],
            "focusChampions": roster["focusChampions"],
            "evaluation": evaluation,
        },
    }
    manifest_path = output_directory / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return {
        "artifact": str(artifact_path),
        "artifactSha256": manifest["artifactSha256"],
        "manifest": str(manifest_path),
        "classCount": len(labels),
        "focusChampions": roster["focusChampions"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--evaluation", type=Path)
    parser.add_argument("--output-directory", type=Path)
    parser.add_argument("--minimum-map50", type=float, default=0.75)
    parser.add_argument("--minimum-focus-map50", type=float, default=0.60)
    parser.add_argument("--skip-metric-gate", action="store_true")
    arguments = parser.parse_args()
    print(json.dumps(publish(
        arguments.checkpoint,
        arguments.evaluation,
        arguments.output_directory,
        arguments.minimum_map50,
        arguments.minimum_focus_map50,
        arguments.skip_metric_gate,
    ), indent=2))


if __name__ == "__main__":
    main()
