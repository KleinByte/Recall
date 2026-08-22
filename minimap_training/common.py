"""Shared paths, roster validation, and experiment metadata helpers."""

from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
TRAINING_ROOT = Path(__file__).resolve().parent
WORK_ROOT = REPOSITORY_ROOT / ".minimap-training"
DATA_ROOT = WORK_ROOT / "data"
RUN_ROOT = WORK_ROOT / "runs"
CHECKPOINT_ROOT = WORK_ROOT / "checkpoints"
ROSTER_PATH = TRAINING_ROOT / "roster.json"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_roster() -> dict[str, Any]:
    roster = read_json(ROSTER_PATH)
    classes = roster.get("classes")
    if not isinstance(classes, list) or len(classes) != roster.get("classCount"):
        raise RuntimeError(f"Invalid training roster: {ROSTER_PATH}")
    expected_indices = list(range(len(classes)))
    if [entry.get("index") for entry in classes] != expected_indices:
        raise RuntimeError("Training roster indices are not contiguous")
    return roster


def roster_class_names(roster: dict[str, Any] | None = None) -> list[str]:
    selected = roster or load_roster()
    return [str(entry["assetKey"]) for entry in selected["classes"]]


def normalize_names(names: Any) -> list[str]:
    if isinstance(names, dict):
        ordered_keys = sorted((int(key) for key in names))
        return [str(names.get(key, names.get(str(key)))) for key in ordered_keys]
    if isinstance(names, (list, tuple)):
        return [str(name) for name in names]
    raise TypeError(f"Unsupported model names value: {type(names).__name__}")


def require_target_names(names: Any) -> list[str]:
    actual = normalize_names(names)
    expected = roster_class_names()
    if actual != expected:
        missing = [name for name in expected if name.lower() not in {item.lower() for item in actual}]
        extra = [name for name in actual if name.lower() not in {item.lower() for item in expected}]
        raise RuntimeError(
            "Model class map does not match the training roster "
            f"(actual={len(actual)}, expected={len(expected)}, missing={missing}, extra={extra})"
        )
    return actual


def resolve_dataset(dataset: str | Path) -> Path:
    candidate = Path(dataset)
    if candidate.is_file():
        return candidate.resolve()
    candidates = [
        DATA_ROOT / "synthetic" / str(dataset) / "config.yaml",
        DATA_ROOT / "replay" / str(dataset) / "config.yaml",
        DATA_ROOT / "live-regression" / str(dataset) / "object" / "config.yaml",
        REPOSITORY_ROOT / str(dataset) / "config.yaml",
    ]
    for config in candidates:
        if config.is_file():
            return config.resolve()
    raise FileNotFoundError(f"Dataset config was not found for: {dataset}")


def git_state() -> dict[str, Any]:
    def run(*arguments: str) -> str | None:
        try:
            result = subprocess.run(
                ["git", *arguments],
                cwd=REPOSITORY_ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            return result.stdout.strip() or None
        except (OSError, subprocess.CalledProcessError):
            return None

    status = run("status", "--porcelain")
    return {
        "commit": run("rev-parse", "HEAD"),
        "branch": run("rev-parse", "--abbrev-ref", "HEAD"),
        "dirty": None if status is None else bool(status),
    }


def write_metadata(directory: Path, payload: dict[str, Any]) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    metadata = {
        **payload,
        "timestampUtc": datetime.now(timezone.utc).isoformat(),
        "git": git_state(),
        "rosterSha256": sha256_file(ROSTER_PATH),
    }
    path = directory / "metadata.json"
    path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path
