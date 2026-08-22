"""Evaluate the bundled ONNX detector over Recall minimap debug captures."""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

repository = Path(__file__).resolve().parents[1]
model_tools = repository / ".model-tools"
if model_tools.is_dir():
    sys.path.insert(0, str(model_tools))

import cv2
import numpy as np

TEMPLATE_SIZE = 24
PORTRAIT_DIAMETER_RATIOS = (0.66, 0.72, 0.78)


def prepared_portrait(image: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    resized = cv2.resize(image, (TEMPLATE_SIZE, TEMPLATE_SIZE), interpolation=cv2.INTER_LINEAR)
    return cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY), cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)


def shifted_correlation(
    left: np.ndarray,
    right: np.ndarray,
    shift_x: int,
    shift_y: int,
) -> float:
    center = (TEMPLATE_SIZE - 1) / 2
    radius_squared = (TEMPLATE_SIZE * 0.44) ** 2
    left_values = []
    right_values = []
    for y in range(TEMPLATE_SIZE):
        for x in range(TEMPLATE_SIZE):
            if (x - center) ** 2 + (y - center) ** 2 > radius_squared:
                continue
            shifted_x = x + shift_x
            shifted_y = y + shift_y
            if 0 <= shifted_x < TEMPLATE_SIZE and 0 <= shifted_y < TEMPLATE_SIZE:
                left_values.append(left[shifted_y, shifted_x])
                right_values.append(right[y, x])
    left_array = np.asarray(left_values, dtype=np.float64)
    right_array = np.asarray(right_values, dtype=np.float64)
    if left_array.ndim == 1:
        left_array = left_array[:, np.newaxis]
        right_array = right_array[:, np.newaxis]
    scores = []
    for channel in range(left_array.shape[1]):
        left_channel = left_array[:, channel]
        right_channel = right_array[:, channel]
        denominator = np.sqrt(
            np.sum((left_channel - left_channel.mean()) ** 2) *
            np.sum((right_channel - right_channel.mean()) ** 2)
        )
        if denominator > 1e-9:
            scores.append(float(np.sum(
                (left_channel - left_channel.mean()) *
                (right_channel - right_channel.mean())
            ) / denominator))
    return sum(scores) / len(scores) if scores else -1.0


def portrait_score(image: np.ndarray, detection: dict, template: np.ndarray) -> float:
    center_x = detection["cx"] * image.shape[1]
    center_y = detection["cy"] * image.shape[0]
    diameter = max(detection["w"] * image.shape[1], detection["h"] * image.shape[0])
    template_gray, template_rgb = prepared_portrait(template)
    best = -1.0
    for ratio in PORTRAIT_DIAMETER_RATIOS:
        sample_diameter = max(3, round(diameter * ratio))
        x1 = max(0, round(center_x - sample_diameter / 2))
        y1 = max(0, round(center_y - sample_diameter / 2))
        x2 = min(image.shape[1], x1 + sample_diameter)
        y2 = min(image.shape[0], y1 + sample_diameter)
        if x2 - x1 <= 2 or y2 - y1 <= 2:
            continue
        sample_gray, sample_rgb = prepared_portrait(image[y1:y2, x1:x2])
        for shift_y in range(-2, 3):
            for shift_x in range(-2, 3):
                luminance = shifted_correlation(
                    sample_gray, template_gray, shift_x, shift_y,
                )
                colour = shifted_correlation(
                    sample_rgb, template_rgb, shift_x, shift_y,
                )
                best = max(best, luminance * 0.65 + colour * 0.35)
    return max(0.0, min(1.0, (best + 1) / 2))


def iou(left: dict, right: dict) -> float:
    left_x1 = left["cx"] - left["w"] / 2
    left_y1 = left["cy"] - left["h"] / 2
    right_x1 = right["cx"] - right["w"] / 2
    right_y1 = right["cy"] - right["h"] / 2
    width = max(0.0, min(left_x1 + left["w"], right_x1 + right["w"]) - max(left_x1, right_x1))
    height = max(0.0, min(left_y1 + left["h"], right_y1 + right["h"]) - max(left_y1, right_y1))
    intersection = width * height
    union = left["w"] * left["h"] + right["w"] * right["h"] - intersection
    return intersection / union if union > 0 else 0.0


def suppress(candidates: list[dict], threshold: float) -> list[dict]:
    retained = []
    for candidate in sorted(candidates, key=lambda entry: -entry["confidence"]):
        if any(
            existing["class_index"] == candidate["class_index"] and
            iou(existing, candidate) > threshold
            for existing in retained
        ):
            continue
        retained.append(candidate)
    return retained[:20]


def champion_model_blob(image: np.ndarray, size: int = 256) -> np.ndarray:
    """Match championModelTensor's endpoint-mapped RGB bilinear resize."""
    source = cv2.cvtColor(image, cv2.COLOR_BGR2RGB).astype(np.float32)
    source_y = np.linspace(0, max(0, image.shape[0] - 1), size, dtype=np.float32)
    source_x = np.linspace(0, max(0, image.shape[1] - 1), size, dtype=np.float32)
    y0 = np.floor(source_y).astype(np.int32)
    x0 = np.floor(source_x).astype(np.int32)
    y1 = np.minimum(image.shape[0] - 1, y0 + 1)
    x1 = np.minimum(image.shape[1] - 1, x0 + 1)
    fy = (source_y - y0)[:, np.newaxis, np.newaxis]
    fx = (source_x - x0)[np.newaxis, :, np.newaxis]
    top = source[y0[:, np.newaxis], x0[np.newaxis, :]] * (1 - fx) + \
        source[y0[:, np.newaxis], x1[np.newaxis, :]] * fx
    bottom = source[y1[:, np.newaxis], x0[np.newaxis, :]] * (1 - fx) + \
        source[y1[:, np.newaxis], x1[np.newaxis, :]] * fx
    resized = top * (1 - fy) + bottom * fy
    return np.ascontiguousarray(resized.transpose(2, 0, 1)[np.newaxis] / 255.0)


def detect(
    net,
    image: np.ndarray,
    labels: list[str],
    confidence: float,
    roster: set[str],
    probe_class_index: int | None = None,
) -> tuple[list[dict], dict | None]:
    blob = champion_model_blob(image)
    net.setInput(blob)
    output = net.forward()
    predictions = output[0]
    if predictions.shape != (len(labels) + 4, 1344):
        raise RuntimeError(f"Unexpected model output: {output.shape}")

    candidates = []
    probe = None
    for anchor in range(predictions.shape[1]):
        class_index = int(np.argmax(predictions[4:, anchor]))
        label = labels[class_index]
        if probe_class_index is not None:
            probe_score = float(predictions[4 + probe_class_index, anchor])
            if probe is None or probe_score > probe["confidence"]:
                cx, cy, width, height = [float(value) for value in predictions[:4, anchor]]
                probe = {
                    "confidence": probe_score,
                    "winningChampion": label,
                    "winningConfidence": float(predictions[4 + class_index, anchor]),
                    "cx": cx / 256,
                    "cy": cy / 256,
                    "w": width / 256,
                    "h": height / 256,
                }
        if roster and label.lower() not in roster:
            continue
        score = float(predictions[4 + class_index, anchor])
        if score < confidence:
            continue
        cx, cy, width, height = [float(value) for value in predictions[:4, anchor]]
        if width < 3 or height < 3 or width > 64 or height > 64:
            continue
        candidates.append({
            "class_index": class_index,
            "champion": label,
            "confidence": score,
            "cx": cx / 256,
            "cy": cy / 256,
            "w": width / 256,
            "h": height / 256,
        })
    return suppress(candidates, 0.45), probe


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("capture_root", type=Path)
    parser.add_argument("--game-id")
    parser.add_argument("--champions", default="")
    parser.add_argument("--confidence", type=float, default=0.28)
    parser.add_argument("--details", action="store_true")
    parser.add_argument(
        "--probe-champion",
        help="Report the target class's strongest raw score even when another class wins the box.",
    )
    arguments = parser.parse_args()

    model_directory = repository / "resources" / "minimap-model"
    manifest = json.loads((model_directory / "manifest.json").read_text(encoding="utf-8"))
    labels = json.loads((model_directory / manifest["labelsFile"]).read_text(encoding="utf-8"))
    net = cv2.dnn.readNetFromONNX(str(model_directory / manifest["artifactFile"]))
    roster = {entry.strip().lower() for entry in arguments.champions.split(",") if entry.strip()}
    probe_class_index = None
    probe_template = None
    if arguments.probe_champion:
        normalized_probe = arguments.probe_champion.strip().lower()
        probe_class_index = next(
            (index for index, label in enumerate(labels) if label.lower() == normalized_probe),
            None,
        )
        if probe_class_index is None:
            raise RuntimeError(f"Champion is not in model labels: {arguments.probe_champion}")
        portrait_directory = repository / "resources" / "champion-portraits"
        portrait_path = next(
            (entry for entry in portrait_directory.glob("*.png")
             if entry.stem.lower() == normalized_probe),
            None,
        )
        if portrait_path:
            probe_template = cv2.imread(str(portrait_path), cv2.IMREAD_COLOR)

    pattern = f"{arguments.game_id}-*" if arguments.game_id else "*"
    directories = [entry for entry in arguments.capture_root.glob(pattern) if entry.is_dir()]
    frames = sorted(
        frame
        for directory in directories
        for frame in directory.glob("*.png")
        if not frame.name.endswith(".overlay.png")
    )
    summary = defaultdict(lambda: {"frames": 0, "detections": 0, "confidence": []})
    detailed = []
    probes = []
    for frame in frames:
        image = cv2.imread(str(frame), cv2.IMREAD_COLOR)
        if image is None:
            continue
        detections, probe = detect(
            net,
            image,
            labels,
            arguments.confidence,
            roster,
            probe_class_index,
        )
        if probe is not None:
            if probe_template is not None:
                probe["portraitScore"] = portrait_score(image, probe, probe_template)
            probes.append({"frame": str(frame), **probe})
        seen = set()
        for detection in detections:
            item = summary[detection["champion"]]
            item["detections"] += 1
            item["confidence"].append(detection["confidence"])
            seen.add(detection["champion"])
        for champion in seen:
            summary[champion]["frames"] += 1
        if arguments.details and detections:
            detailed.append({"frame": str(frame), "detections": detections})

    result = {
        "captureFrames": len(frames),
        "confidenceThreshold": arguments.confidence,
        "champions": {
            champion: {
                "frames": values["frames"],
                "detections": values["detections"],
                "meanConfidence": sum(values["confidence"]) / len(values["confidence"]),
                "maximumConfidence": max(values["confidence"]),
            }
            for champion, values in sorted(summary.items())
        },
        **({
            "probeChampion": arguments.probe_champion,
            "probe": sorted(probes, key=lambda entry: -entry["confidence"])[:25],
        } if arguments.probe_champion else {}),
        **({"details": detailed} if arguments.details else {}),
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
