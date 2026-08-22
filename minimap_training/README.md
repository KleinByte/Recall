# Recall minimap model training

This directory contains the complete, reproducible lifecycle for the YOLO11 minimap detector shipped by Recall: roster reconciliation, synthetic generation, checkpoint class expansion, training, evaluation, metric gates, ONNX export, Docker, and CI/GPU workflows.

The implementation is adapted from [bsowlx/DeepestLeague](https://github.com/bsowlx/DeepestLeague) revision `8cb084f6ae9a89362d30dc2200e775d91cf66f64`, which is the generator used for [boboyes/leagueoflegends-minimap-detection](https://huggingface.co/boboyes/leagueoflegends-minimap-detection). Its MIT license is preserved in `UPSTREAM_LICENSE`.

## Current roster update

The pinned upstream checkpoint has 170 classes. Recall's local Data Dragon 16.16.1 catalog has 173. The exact additions are:

- Locke
- Yunara
- Zaahen

`roster.json` is the authoritative 173-class ordering. It is derived entirely from the portraits already committed under `resources/champion-portraits`; dataset generation does not call Data Dragon.

Every focused synthetic image contains at least one of the added champions while its remaining slots sample the complete roster. The generator cycles focus classes deterministically, so even smoke datasets cover all three. It still includes both team rings, fog, map variants, structures, jungle and epic glyphs, wards, pings, recall/teleport effects, viewport rectangles, overlap, blur, downscaling, color changes, and JPEG degradation from the upstream pipeline.

## Local quick start

Requirements are Python 3.12 and, for full training, an NVIDIA GPU with a compatible CUDA driver.

```powershell
pnpm minimap:roster:check
pnpm minimap:setup
pnpm minimap:download-base
pnpm minimap:pipeline -- --smoke
```

`minimap:setup` creates `.minimap-training/python`, which is ignored by Git. It installs PyTorch 2.5.1 CUDA 12.4 by default on Windows/Linux. Set `RECALL_TORCH_FLAVOR=cpu` for CPU-only setup or `RECALL_TRAINING_PYTHON` to select a specific Python executable.

The smoke run verifies the 173-class checkpoint expansion and one training epoch. It is not suitable for release.

For a full run using the upstream defaults:

```powershell
pnpm minimap:pipeline -- --publish
```

This generates 100,000 training, 10,000 validation, and 10,000 test images; warms the expanded classifier head for 5 frozen-backbone epochs; fine-tunes the complete model for 50 epochs; evaluates every class; requires overall mAP50 of at least 0.75 and each focus champion's mAP50 of at least 0.60; and only then replaces `resources/minimap-model/yolo11m-minimap.onnx` plus its labels and manifest. Generated datasets, checkpoints, and run output stay under ignored `.minimap-training/` storage.

Useful individual stages:

```powershell
pnpm minimap:generate -- --n-train 1000 --n-val 100 --n-test 100 --dataset-name experiment
pnpm minimap:dataset:validate -- .minimap-training/data/synthetic/experiment/config.yaml
pnpm minimap:checkpoint:expand -- .minimap-training/checkpoints/upstream-yolo11m-minimap.pt .minimap-training/checkpoints/expanded.pt
pnpm minimap:train -- --weights .minimap-training/checkpoints/expanded.pt --dataset experiment --run-id experiment
pnpm minimap:evaluate -- --weights .minimap-training/runs/experiment/weights/best.pt --dataset experiment --evaluation-id experiment-test
pnpm minimap:publish -- .minimap-training/runs/experiment/weights/best.pt --evaluation .minimap-training/runs/evaluations/experiment-test/evaluation.json
```

## Live-frame regression data

Build the local real-capture corpus after placing the AAAI26 replay dataset at
`.minimap-training/data/live-regression/sources/aaai26/replays`:

```powershell
pnpm minimap:live:build
pnpm minimap:dataset:validate -- .minimap-training/data/live-regression/recall-live-v1/object/config.yaml --minimum-focus-instances 0
```

The builder remaps the 170 public replay classes by champion name, imports
privacy-scrubbed Recall debug captures, and imports the curated Yunara VOD
minimap crops. Output stays under ignored `.minimap-training` storage. The
generated `coverage.json` distinguishes fully boxed object annotations from
roster-presence-only captures; roster presence must never be scored as though
all ten champions are visible in that frame.

Evaluate the fully labeled object tier with:

```powershell
pnpm minimap:evaluate -- --weights .minimap-training/runs/RUN_ID/weights/best.pt --dataset recall-live-v1 --evaluation-id RUN_ID-live --split test --device 0 --minimum-focus-instances 0
```

The public object tier covers the 170 legacy champions. Locke, Yunara, and
Zaahen are present in the roster tier but require target-only, baseline, or
human-reviewed box annotations before their object recall can be gated.

## Why checkpoint expansion matters

Adding alphabetically ordered classes changes many numeric class IDs. Letting Ultralytics replace a 170-channel classifier with a fresh 173-channel classifier would discard learned classification weights for every existing champion. `expand_checkpoint.py` creates the larger classifier and copies each old channel by champion name, independent of index shifts. Only genuinely new channels receive neutral initialization.

The expanded dataset still contains all champions. Focused sampling accelerates learning for new channels without training a three-class model that would forget the existing roster.

## Docker and GitHub Actions

The same pipeline runs in the CUDA container:

```powershell
pnpm minimap:download-base
docker compose -f compose.minimap-training.yaml build
docker compose -f compose.minimap-training.yaml run --rm minimap-training --smoke
```

`.github/workflows/minimap-training.yml` provides:

- a CPU generator/label smoke test on relevant pull requests and pushes;
- a weekly lightweight Data Dragon roster check that downloads only catalog JSON, never portraits;
- a manual full-training job for a self-hosted Linux runner labeled `self-hosted`, `linux`, `x64`, and `gpu`;
- uploaded candidate ONNX, checkpoint, evaluation, and provenance artifacts instead of an automatic commit.

## Adding the next champion

Portrait downloads are explicit and happen once per roster update:

```powershell
pnpm sync:champion-portraits
pnpm sync:minimap-training-roster
pnpm minimap:roster:check
```

The roster snapshot computes the difference between the current trained model and the new local portrait catalog. Those missing classes automatically become the next focus set. Then run the pipeline and review the evaluation artifact before committing the published ONNX files.

## Reproducibility and provenance

- Data generation uses a per-split/per-image seed that is stable across worker counts.
- `generation-manifest.json` records class order, focus policy, seed, split sizes, and augmentations.
- `dataset-validation.json` records image/label pairing, every class count, bounding-box validation, and focus coverage.
- Training, evaluation, expansion, and publication record hashes and Git state.
- The upstream checkpoint is pinned by immutable Hugging Face revision and SHA-256 and is downloaded only when absent.
