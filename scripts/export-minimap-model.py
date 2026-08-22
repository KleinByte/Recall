"""Development-only conversion of the pinned YOLO checkpoint to ONNX."""

import json
import sys
from pathlib import Path

from ultralytics import YOLO


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: export-minimap-model.py CHECKPOINT OUTPUT_DIRECTORY")

    checkpoint = Path(sys.argv[1]).resolve()
    output_directory = Path(sys.argv[2]).resolve()
    output_directory.mkdir(parents=True, exist_ok=True)

    model = YOLO(str(checkpoint))
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
    target = output_directory / "yolo11m-minimap.onnx"
    exported.replace(target)
    names = model.names
    ordered_names = [str(names[index]) for index in range(len(names))]
    (output_directory / "labels.json").write_text(
        json.dumps(ordered_names, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
