"""Expand a YOLO Detect classifier while preserving existing champion channels."""

from __future__ import annotations

import argparse
import copy
import json
import shutil
from pathlib import Path

import torch
from torch import nn
from ultralytics import YOLO

from .common import load_roster, normalize_names, sha256_file


def _replacement_conv(layer: nn.Conv2d, output_channels: int) -> nn.Conv2d:
    replacement = nn.Conv2d(
        in_channels=layer.in_channels,
        out_channels=output_channels,
        kernel_size=layer.kernel_size,
        stride=layer.stride,
        padding=layer.padding,
        dilation=layer.dilation,
        groups=layer.groups,
        bias=layer.bias is not None,
        padding_mode=layer.padding_mode,
        device=layer.weight.device,
        dtype=layer.weight.dtype,
    )
    with torch.no_grad():
        mean_weight = layer.weight.mean(dim=0, keepdim=True)
        replacement.weight.copy_(mean_weight.expand_as(replacement.weight))
        if replacement.bias is not None and layer.bias is not None:
            replacement.bias.fill_(float(layer.bias.mean()))
    return replacement


def expand_checkpoint(source: Path, output: Path) -> dict:
    source = source.resolve()
    output = output.resolve()
    roster = load_roster()
    target_names = [entry["assetKey"] for entry in roster["classes"]]
    target_lookup = {name.lower(): index for index, name in enumerate(target_names)}

    yolo = YOLO(str(source))
    source_names = normalize_names(yolo.names)
    removed = [name for name in source_names if name.lower() not in target_lookup]
    if removed:
        raise RuntimeError(f"Target roster removed checkpoint classes: {', '.join(removed)}")

    output.parent.mkdir(parents=True, exist_ok=True)
    if source_names == target_names:
        shutil.copy2(source, output)
        report = {
            "schemaVersion": 1,
            "source": str(source),
            "sourceSha256": sha256_file(source),
            "output": str(output),
            "outputSha256": sha256_file(output),
            "sourceClassCount": len(source_names),
            "targetClassCount": len(target_names),
            "addedClasses": [],
            "copiedClassifierChannels": len(source_names),
        }
        output.with_suffix(".expansion.json").write_text(
            json.dumps(report, indent=2) + "\n", encoding="utf-8"
        )
        return report

    task_model = yolo.model
    detector = task_model.model[-1]
    source_lookup = {name.lower(): index for index, name in enumerate(source_names)}
    classifier_groups = []
    for attribute in ("cv3", "one2one_cv3"):
        branches = getattr(detector, attribute, None)
        if branches is not None:
            classifier_groups.append((attribute, branches))
    if not classifier_groups:
        raise RuntimeError("Unsupported Ultralytics Detect head: no classifier branches found")

    copied_channels = 0
    for attribute, branches in classifier_groups:
        for branch_index, branch in enumerate(branches):
            if not isinstance(branch, nn.Sequential) or not isinstance(branch[-1], nn.Conv2d):
                raise RuntimeError(f"Unsupported classifier branch: {attribute}[{branch_index}]")
            original = branch[-1]
            if original.out_channels != len(source_names):
                raise RuntimeError(
                    f"Classifier channel count {original.out_channels} does not match "
                    f"checkpoint labels {len(source_names)}"
                )
            replacement = _replacement_conv(original, len(target_names))
            with torch.no_grad():
                for target_index, target_name in enumerate(target_names):
                    source_index = source_lookup.get(target_name.lower())
                    if source_index is None:
                        continue
                    replacement.weight[target_index].copy_(original.weight[source_index])
                    if replacement.bias is not None and original.bias is not None:
                        replacement.bias[target_index].copy_(original.bias[source_index])
                    copied_channels += 1
            branch[-1] = replacement

    names = {index: name for index, name in enumerate(target_names)}
    detector.nc = len(target_names)
    detector.no = detector.nc + detector.reg_max * 4
    task_model.names = names
    task_model.nc = len(target_names)
    task_model.yaml = copy.deepcopy(task_model.yaml)
    task_model.yaml["nc"] = len(target_names)
    yolo.ckpt["model"] = task_model
    yolo.save(str(output))

    verification = YOLO(str(output))
    if normalize_names(verification.names) != target_names:
        raise RuntimeError("Expanded checkpoint failed class-map verification after reload")

    added = [name for name in target_names if name.lower() not in source_lookup]
    report = {
        "schemaVersion": 1,
        "source": str(source),
        "sourceSha256": sha256_file(source),
        "output": str(output),
        "outputSha256": sha256_file(output),
        "sourceClassCount": len(source_names),
        "targetClassCount": len(target_names),
        "addedClasses": added,
        "copiedClassifierChannels": copied_channels,
        "classifierBranchGroups": [name for name, _ in classifier_groups],
    }
    output.with_suffix(".expansion.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Existing trained YOLO .pt checkpoint")
    parser.add_argument("output", type=Path, help="Expanded output .pt checkpoint")
    arguments = parser.parse_args()
    print(json.dumps(expand_checkpoint(arguments.source, arguments.output), indent=2))


if __name__ == "__main__":
    main()
