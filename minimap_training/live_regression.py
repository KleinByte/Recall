"""Build a privacy-scrubbed live minimap regression dataset.

The object tier remaps the public AAAI26 replay labels onto Recall's current
roster. The roster tier imports Recall debug captures and optional public VOD
minimap crops without pretending that roster presence is an object box label.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import shutil
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

import yaml
from PIL import Image

from .common import DATA_ROOT, ROSTER_PATH, load_roster, normalize_names, sha256_file
from .validate_dataset import IMAGE_EXTENSIONS, validate_dataset


DATASET_SCHEMA_VERSION = 1
SOURCE_ROOT = DATA_ROOT / "live-regression" / "sources"
DEFAULT_AAAI_ROOT = SOURCE_ROOT / "aaai26" / "replays"
DEFAULT_DEBUG_ROOT = Path(os.environ.get("APPDATA", "")) / "recall" / "Minimap Vision Debug"
DEFAULT_DATABASE = Path(os.environ.get("APPDATA", "")) / "recall" / "stats.db"
DEFAULT_YUNARA_ROOT = SOURCE_ROOT / "yunara-vod" / "browser-captures"
DEFAULT_OUTPUT = DATA_ROOT / "live-regression" / "recall-live-v1"

AAAI_SOURCE_URL = "https://huggingface.co/datasets/lusung33/AAAI26_LoL_MinimapDetection_Dataset"
DEEPEST_LEAGUE_URL = "https://github.com/bsowlx/DeepestLeague"
YUNARA_VOD_URL = "https://www.youtube.com/watch?v=Ph16mvaX55o"
AAAI_ARCHIVE_SHA256 = "c3340070e04aac11ae4a0bc832fdf32ea8da7bab28bd04ed052563a1bebcc13f"

SOURCE_NAME_ALIASES = {"FiddleSticks": "Fiddlesticks"}
YUNARA_EXCLUDED_FILES = {
    "yunara-0361s.png",  # near-duplicate of 0360
    "yunara-0380s.png",  # YouTube controls cover the minimap
    "yunara-0381s.png",  # YouTube controls cover the minimap
}
YUNARA_ALLIES = ["Milio", "Yunara", "Xerath", "XinZhao", "MonkeyKing"]
YUNARA_ENEMIES = ["Fiddlesticks", "Caitlyn", "Thresh", "Fizz", "Aatrox"]


def _name_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def _roster_name_lookup(roster: dict[str, Any]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for entry in roster["classes"]:
        key = str(entry["assetKey"])
        for candidate in (key, str(entry["displayName"])):
            lookup[_name_key(candidate)] = key
    return lookup


def _canonical_name(value: str, lookup: dict[str, str]) -> str:
    canonical = lookup.get(_name_key(value))
    if canonical is None:
        raise RuntimeError(f"Champion is not in minimap_training/roster.json: {value}")
    return canonical


def _verify_image(path: Path) -> tuple[int, int]:
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            return image.size
    except Exception as error:
        raise RuntimeError(f"Image could not be decoded: {path}") from error


def _link_or_copy(source: Path, destination: Path) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, destination)
        return "hardlink"
    except OSError:
        shutil.copy2(source, destination)
        return "copy"


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as stream:
        for record in records:
            stream.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")


def _public_split_root(source_root: Path, source_config: dict[str, Any], split: str) -> Path:
    direct = source_root / split
    if (direct / "images").is_dir() and (direct / "labels").is_dir():
        return direct
    configured_root = Path(str(source_config.get("path", ".")))
    if not configured_root.is_absolute():
        configured_root = source_root / configured_root
    configured_images = configured_root / str(source_config[split])
    candidate = configured_images.parent
    if (candidate / "images").is_dir() and (candidate / "labels").is_dir():
        return candidate
    raise FileNotFoundError(f"AAAI26 {split} split was not found under {source_root}")


def _remap_public_dataset(
    source_root: Path,
    destination: Path,
    published_destination: Path,
    roster_names: list[str],
) -> dict[str, Any]:
    source_config_path = source_root / "config.yaml"
    if not source_config_path.is_file():
        raise FileNotFoundError(f"AAAI26 replay config was not found: {source_config_path}")
    source_config = yaml.safe_load(source_config_path.read_text(encoding="utf-8"))
    source_names = normalize_names(source_config.get("names"))
    target_by_key = {name.casefold(): index for index, name in enumerate(roster_names)}
    class_map: dict[int, int] = {}
    for source_index, raw_name in enumerate(source_names):
        name = SOURCE_NAME_ALIASES.get(raw_name, raw_name)
        target_index = target_by_key.get(name.casefold())
        if target_index is None:
            raise RuntimeError(f"AAAI26 class is absent from the Recall roster: {raw_name}")
        class_map[source_index] = target_index
    if len(set(class_map.values())) != len(class_map):
        raise RuntimeError("AAAI26 class remap is not one-to-one")

    class_instances: Counter[str] = Counter()
    class_frames: Counter[str] = Counter()
    split_reports: dict[str, Any] = {}
    transfer_modes: Counter[str] = Counter()
    for split in ("train", "val", "test"):
        split_root = _public_split_root(source_root, source_config, split)
        source_images = sorted(
            path for path in (split_root / "images").iterdir()
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        )
        source_labels = split_root / "labels"
        destination_images = destination / split / "images"
        destination_labels = destination / split / "labels"
        destination_images.mkdir(parents=True, exist_ok=True)
        destination_labels.mkdir(parents=True, exist_ok=True)
        boxes = 0
        for source_image in source_images:
            _verify_image(source_image)
            source_label = source_labels / f"{source_image.stem}.txt"
            if not source_label.is_file():
                raise RuntimeError(f"AAAI26 image has no label file: {source_image}")
            stem = f"aaai26-{split}-{source_image.stem}"
            destination_image = destination_images / f"{stem}{source_image.suffix.lower()}"
            transfer_modes[_link_or_copy(source_image, destination_image)] += 1
            remapped_lines: list[str] = []
            frame_classes: set[str] = set()
            for line_number, line in enumerate(
                source_label.read_text(encoding="utf-8").splitlines(), start=1,
            ):
                fields = line.split()
                if len(fields) != 5:
                    raise RuntimeError(f"{source_label}:{line_number}: expected five YOLO fields")
                try:
                    source_class = int(fields[0])
                except ValueError as error:
                    raise RuntimeError(f"{source_label}:{line_number}: invalid class ID") from error
                if source_class not in class_map:
                    raise RuntimeError(f"{source_label}:{line_number}: class ID is out of range")
                target_class = class_map[source_class]
                target_name = roster_names[target_class]
                remapped_lines.append(" ".join((str(target_class), *fields[1:])))
                class_instances[target_name] += 1
                frame_classes.add(target_name)
                boxes += 1
            for target_name in frame_classes:
                class_frames[target_name] += 1
            (destination_labels / f"{stem}.txt").write_text(
                "\n".join(remapped_lines) + ("\n" if remapped_lines else ""),
                encoding="utf-8",
            )
        split_reports[split] = {"images": len(source_images), "boxes": boxes}

    config = {
        "path": ".",
        "train": "train/images",
        "val": "val/images",
        "test": "test/images",
        "nc": len(roster_names),
        "names": roster_names,
    }
    config_path = destination / "config.yaml"
    config_path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    validation = validate_dataset(config_path, minimum_focus_instances=0)
    validation_path = destination / "dataset-validation.json"
    validation_payload = json.loads(validation_path.read_text(encoding="utf-8"))
    validation_payload["datasetConfig"] = "config.yaml"
    _write_json(validation_path, validation_payload)
    config["path"] = str(published_destination.resolve())
    config_path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    covered = [name for name in roster_names if class_instances[name] > 0]
    return {
        "config": "object/config.yaml",
        "splits": split_reports,
        "images": sum(report["images"] for report in split_reports.values()),
        "boxes": sum(class_instances.values()),
        "classInstances": dict(class_instances),
        "classFrames": dict(class_frames),
        "classesCovered": covered,
        "missingClasses": [name for name in roster_names if name not in covered],
        "transferModes": dict(transfer_modes),
        "validation": {
            "valid": validation["valid"],
            "totalBoxes": validation["totalBoxes"],
        },
    }


def _decode_snapshot(payload: bytes, encoding: str) -> dict[str, Any]:
    decoded = gzip.decompress(payload) if "gzip" in encoding.casefold() else payload
    return json.loads(decoded.decode("utf-8"))


def _game_rosters(
    database: Path,
    game_ids: list[int],
    name_lookup: dict[str, str],
) -> dict[int, dict[str, Any]]:
    if not database.is_file():
        raise FileNotFoundError(f"Recall database was not found: {database}")
    connection = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
    try:
        rosters: dict[int, dict[str, Any]] = {}
        for game_id in game_ids:
            row = connection.execute(
                "SELECT snapshot_payload, snapshot_encoding "
                "FROM live_game_snapshots WHERE game_id = ? "
                "ORDER BY game_time_ms DESC LIMIT 1",
                (game_id,),
            ).fetchone()
            if row is None:
                continue
            snapshot = _decode_snapshot(bytes(row[0]), str(row[1]))
            allies = [
                _canonical_name(str(player["championName"]), name_lookup)
                for player in snapshot.get("allies", [])
            ]
            enemies = [
                _canonical_name(str(player["championName"]), name_lookup)
                for player in snapshot.get("enemies", [])
            ]
            active = _canonical_name(
                str(snapshot.get("activePlayer", {}).get("championName", "")),
                name_lookup,
            )
            if len(set(allies + enemies)) != len(allies + enemies) or not 9 <= len(allies + enemies) <= 10:
                # Arena, duplicate-pick modes, and partially captured sessions are
                # not comparable with the Summoner's Rift minimap distribution.
                continue
            rosters[game_id] = {"activeChampion": active, "allies": allies, "enemies": enemies}
        return rosters
    finally:
        connection.close()


def _capture_directories(debug_root: Path) -> dict[int, list[Path]]:
    captures: dict[int, list[Path]] = {}
    if not debug_root.is_dir():
        raise FileNotFoundError(f"Recall minimap debug directory was not found: {debug_root}")
    for directory in sorted(path for path in debug_root.iterdir() if path.is_dir()):
        match = re.match(r"^(\d+)-", directory.name)
        has_raw_capture = any(
            path.is_file() and not path.name.endswith(".overlay.png")
            for path in directory.glob("*.png")
        )
        if match and has_raw_capture:
            captures.setdefault(int(match.group(1)), []).append(directory)
    return captures


def _calibration_summary(sidecar: dict[str, Any]) -> dict[str, Any] | None:
    calibration = sidecar.get("calibration")
    if not isinstance(calibration, dict):
        return None
    minimap = calibration.get("minimapRect", {})
    return {
        "sourceWidth": calibration.get("sourceWidth"),
        "sourceHeight": calibration.get("sourceHeight"),
        "minimapWidth": minimap.get("width"),
        "minimapHeight": minimap.get("height"),
        "placement": calibration.get("placement"),
        "confidence": calibration.get("confidence"),
        "version": calibration.get("calibrationVersion"),
    }


def _import_roster_frames(
    debug_root: Path,
    database: Path,
    yunara_root: Path,
    destination: Path,
    roster: dict[str, Any],
) -> dict[str, Any]:
    name_lookup = _roster_name_lookup(roster)
    capture_directories = _capture_directories(debug_root)
    rosters = _game_rosters(database, sorted(capture_directories), name_lookup)
    images_directory = destination / "images"
    images_directory.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = []
    class_frames: Counter[str] = Counter()
    transfer_modes: Counter[str] = Counter()
    seen_hashes: set[str] = set()
    game_summaries: list[dict[str, Any]] = []

    for game_number, game_id in enumerate(sorted(rosters), start=1):
        roster_info = rosters[game_id]
        game_alias = f"local-game-{game_number:03d}"
        game_records = 0
        for directory in capture_directories.get(game_id, []):
            for source_image in sorted(directory.glob("*.png")):
                if source_image.name.endswith(".overlay.png") or source_image.stat().st_size == 0:
                    continue
                sidecar_path = source_image.with_suffix(".json")
                if not sidecar_path.is_file():
                    continue
                image_hash = sha256_file(source_image)
                if image_hash in seen_hashes:
                    continue
                seen_hashes.add(image_hash)
                dimensions = _verify_image(source_image)
                sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
                frame_number = game_records + 1
                output_name = f"{game_alias}-{frame_number:05d}.png"
                transfer_modes[_link_or_copy(source_image, images_directory / output_name)] += 1
                present = list(dict.fromkeys(roster_info["allies"] + roster_info["enemies"]))
                for champion in present:
                    class_frames[champion] += 1
                records.append({
                    "annotationType": "roster_presence",
                    "objectLocationsKnown": False,
                    "sourceType": "recall_debug_capture",
                    "sourceId": game_alias,
                    "image": f"images/{output_name}",
                    "imageSha256": image_hash,
                    "width": dimensions[0],
                    "height": dimensions[1],
                    "gameTimeMs": round(float(sidecar.get("gameTimeMs", 0))),
                    "frameSequence": sidecar.get("frameSequence"),
                    "activeChampion": roster_info["activeChampion"],
                    "allies": roster_info["allies"],
                    "enemies": roster_info["enemies"],
                    "calibration": _calibration_summary(sidecar),
                })
                game_records += 1
        game_summaries.append({
            "sourceId": game_alias,
            "frames": game_records,
            "activeChampion": roster_info["activeChampion"],
            "allies": roster_info["allies"],
            "enemies": roster_info["enemies"],
        })

    yunara_files = sorted(
        path for path in yunara_root.glob("yunara-*.png")
        if path.name not in YUNARA_EXCLUDED_FILES
    ) if yunara_root.is_dir() else []
    yunara_allies = [_canonical_name(name, name_lookup) for name in YUNARA_ALLIES]
    yunara_enemies = [_canonical_name(name, name_lookup) for name in YUNARA_ENEMIES]
    for source_image in yunara_files:
        image_hash = sha256_file(source_image)
        if image_hash in seen_hashes:
            continue
        seen_hashes.add(image_hash)
        dimensions = _verify_image(source_image)
        match = re.search(r"-(\d+)s$", source_image.stem)
        if not match:
            raise RuntimeError(f"Yunara capture has no source timestamp: {source_image}")
        source_seconds = int(match.group(1))
        output_name = f"public-vod-yunara-{source_seconds:04d}s.png"
        transfer_modes[_link_or_copy(source_image, images_directory / output_name)] += 1
        for champion in list(dict.fromkeys(yunara_allies + yunara_enemies)):
            class_frames[champion] += 1
        records.append({
            "annotationType": "roster_presence",
            "objectLocationsKnown": False,
            "sourceType": "public_vod_minimap_crop",
            "sourceId": "public-vod-yunara-001",
            "sourceTimeSeconds": source_seconds,
            "image": f"images/{output_name}",
            "imageSha256": image_hash,
            "width": dimensions[0],
            "height": dimensions[1],
            "activeChampion": "Yunara",
            "allies": yunara_allies,
            "enemies": yunara_enemies,
        })

    _write_jsonl(destination / "manifest.jsonl", records)
    roster_names = [str(entry["assetKey"]) for entry in roster["classes"]]
    covered = [name for name in roster_names if class_frames[name] > 0]
    return {
        "frames": len(records),
        "localFrames": sum(summary["frames"] for summary in game_summaries),
        "yunaraVodFrames": len(yunara_files),
        "games": game_summaries,
        "classFrames": dict(class_frames),
        "classesCovered": covered,
        "missingClasses": [name for name in roster_names if name not in covered],
        "transferModes": dict(transfer_modes),
    }


def _dataset_readme(coverage: dict[str, Any]) -> str:
    return f"""# Recall live minimap regression dataset

This local-only dataset separates annotation strengths so a roster-presence
record is never scored as if every champion had a known bounding box.

## Layout

- `object/config.yaml`: YOLO dataset with real replay bounding boxes remapped
  by champion name onto Recall's {coverage['classCount']}-class roster.
- `roster/images/`: real Recall captures and cropped public VOD minimaps.
- `roster/manifest.jsonl`: exact match rosters with personal Riot identifiers
  removed. `objectLocationsKnown` is deliberately false.
- `coverage.json`: per-class coverage and the distinction between object-box
  coverage and capture/roster coverage.
- `provenance.json`: source, license, checksum, and redistribution notes.

Combined capture coverage is {coverage['combinedCaptureCoverage']['coveredCount']}
of {coverage['classCount']} champions. Object boxes cover
{coverage['objectAnnotations']['coveredCount']} champions; the remaining focus
classes must be evaluated with a target-only or baseline-comparison gate until
human-reviewed boxes are added.
"""


def build_live_regression_dataset(
    aaai_root: Path = DEFAULT_AAAI_ROOT,
    debug_root: Path = DEFAULT_DEBUG_ROOT,
    database: Path = DEFAULT_DATABASE,
    yunara_root: Path = DEFAULT_YUNARA_ROOT,
    output: Path = DEFAULT_OUTPUT,
    replace: bool = False,
    require_complete: bool = True,
) -> dict[str, Any]:
    output = output.resolve()
    if output.exists() and not replace:
        raise FileExistsError(f"Output already exists; pass --replace to rebuild it: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = output.parent / f".{output.name}-building-{os.getpid()}"
    staging.mkdir()
    try:
        roster = load_roster()
        roster_names = [str(entry["assetKey"]) for entry in roster["classes"]]
        object_report = _remap_public_dataset(
            aaai_root.resolve(),
            staging / "object",
            output / "object",
            roster_names,
        )
        roster_report = _import_roster_frames(
            debug_root.resolve(),
            database.resolve(),
            yunara_root.resolve(),
            staging / "roster",
            roster,
        )
        object_covered = set(object_report["classesCovered"])
        roster_covered = set(roster_report["classesCovered"])
        combined_covered = object_covered | roster_covered
        coverage = {
            "schemaVersion": DATASET_SCHEMA_VERSION,
            "classCount": len(roster_names),
            "roster": roster_names,
            "objectAnnotations": {
                **object_report,
                "coveredCount": len(object_covered),
            },
            "rosterPresence": {
                **roster_report,
                "coveredCount": len(roster_covered),
            },
            "combinedCaptureCoverage": {
                "coveredCount": len(combined_covered),
                "classesCovered": [name for name in roster_names if name in combined_covered],
                "missingClasses": [name for name in roster_names if name not in combined_covered],
                "complete": len(combined_covered) == len(roster_names),
            },
        }
        if require_complete and not coverage["combinedCaptureCoverage"]["complete"]:
            missing = coverage["combinedCaptureCoverage"]["missingClasses"]
            raise RuntimeError(f"Live capture coverage is incomplete: {missing}")
        _write_json(staging / "coverage.json", coverage)
        _write_json(staging / "provenance.json", {
            "schemaVersion": DATASET_SCHEMA_VERSION,
            "rosterPath": str(ROSTER_PATH),
            "rosterSha256": sha256_file(ROSTER_PATH),
            "sources": [
                {
                    "id": "aaai26-replay",
                    "url": AAAI_SOURCE_URL,
                    "toolkitUrl": DEEPEST_LEAGUE_URL,
                    "license": "MIT",
                    "archiveSha256": AAAI_ARCHIVE_SHA256,
                    "use": "real replay object bounding boxes",
                },
                {
                    "id": "recall-debug-captures",
                    "license": "private local data",
                    "use": "exact roster presence and real minimap appearance",
                    "privacy": "Riot IDs, PUUIDs, summoner names, and source paths are omitted",
                },
                {
                    "id": "public-vod-yunara-001",
                    "url": YUNARA_VOD_URL,
                    "title": "If you think Yunara's weak you need to watch this video",
                    "creator": "Vapora Dark",
                    "license": "copyright retained by the creator",
                    "use": "transformed minimap-only crops for local regression evaluation",
                    "redistribution": "do not redistribute without permission",
                },
            ],
        })
        (staging / "README.md").write_text(_dataset_readme(coverage), encoding="utf-8")
        if output.exists():
            shutil.rmtree(output)
        os.replace(staging, output)
        return {
            "output": str(output),
            "complete": coverage["combinedCaptureCoverage"]["complete"],
            "classCount": len(roster_names),
            "objectImages": object_report["images"],
            "objectBoxes": object_report["boxes"],
            "rosterFrames": roster_report["frames"],
            "objectClassesCovered": len(object_covered),
            "rosterClassesCovered": len(roster_covered),
            "combinedClassesCovered": len(combined_covered),
            "objectMissingClasses": object_report["missingClasses"],
            "combinedMissingClasses": coverage["combinedCaptureCoverage"]["missingClasses"],
        }
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aaai-root", type=Path, default=DEFAULT_AAAI_ROOT)
    parser.add_argument("--debug-root", type=Path, default=DEFAULT_DEBUG_ROOT)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--yunara-root", type=Path, default=DEFAULT_YUNARA_ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--replace", action="store_true")
    parser.add_argument("--allow-incomplete", action="store_true")
    arguments = parser.parse_args()
    report = build_live_regression_dataset(
        aaai_root=arguments.aaai_root,
        debug_root=arguments.debug_root,
        database=arguments.database,
        yunara_root=arguments.yunara_root,
        output=arguments.output,
        replace=arguments.replace,
        require_complete=not arguments.allow_incomplete,
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
