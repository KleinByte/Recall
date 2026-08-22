# Training Recall's minimap champion detector

This guide explains what the minimap model learns, how the training pipeline works, how to run it safely, and how to recover from an interruption. Run every command from the repository root. No command depends on a user-specific absolute path.

## What this model does

The model is a YOLO11 object detector for champion portraits on a League of Legends minimap. For each captured minimap frame, it predicts champion bounding boxes, identities, and confidence scores.

It does **not** perform temporal tracking, route interpolation, fog-of-war estimation, or playback smoothing. Those downstream systems consume its per-frame detections. It also does not detect jungle-camp state or timers. Jungle glyphs appear in synthetic scenes as context and distractors, but they are not labeled training targets.

The complete flow is:

```text
local portraits + synthetic minimap assets
                    |
                    v
         synthetic YOLO dataset
                    |
                    v
pinned 170-class checkpoint
                    |
                    v
  173-class expansion by champion name
                    |
                    v
 head warm-up -> full fine-tune -> held-out evaluation
                                      |
                                      v
                               publication gates
                                      |
                                      v
                              bundled ONNX model
                                      |
                                      v
                       per-frame runtime detections
                                      |
                                      v
                    tracking, routes, and playback
```

Improving this model improves the observations available to tracking. It does not, by itself, decide how observations are joined into a route.

## How roster expansion works

The authoritative target roster is `minimap_training/roster.json`. In the current snapshot:

- the pinned upstream checkpoint has 170 classes;
- the local portrait catalog has 173 classes;
- Locke, Yunara, and Zaahen are absent from the pinned checkpoint and are focus champions.

This is transfer learning, not training from scratch. The pipeline starts from the pretrained `boboyes/leagueoflegends-minimap-detection` checkpoint.

Adding alphabetically ordered champions changes many numeric class IDs. The expansion code therefore copies classifier weights by champion name, not by old numeric index. Every existing champion keeps its learned classifier channel in the correct new position across the detector branches. Only genuinely new channels receive neutral initialization.

Training then has two stages:

1. **Head warm-up:** five epochs with the backbone frozen. This teaches the new classifier channels without immediately changing the feature extractor.
2. **Full fine-tuning:** fifty epochs with the complete model trainable and a conservative learning rate.

This reduces catastrophic forgetting, but it cannot prove that every old champion retained the same real-game accuracy. A real-capture regression comparison is still required before release.

## How synthetic data works

The production defaults generate:

- 100,000 training images;
- 10,000 validation images;
- 10,000 held-out test images;
- 256 by 256 pixel model inputs.

Each scene places ten unique champion portraits. With the default `--focus-per-image 1`, every image intentionally includes one focus champion, cycling deterministically through the focus list. The other nine champions are sampled from the full roster. Old champions therefore still make up most labels collectively; this is not a three-class dataset.

The generator varies conditions seen on real minimaps:

- blue-side and red-side rings;
- fog and viewport visibility;
- minimap variants and scales;
- structures, jungle and epic glyphs, wards, and pings;
- recall and teleport overlays;
- overlap and partial visibility;
- color, blur, resizing, noise, and JPEG degradation.

Generation is deterministic per split and image index. Changing `--workers` changes throughput, not the intended samples.

A completed dataset has three metadata files:

- `config.yaml` defines the splits and exact ordered YOLO class map.
- `generation-manifest.json` records the seed, split sizes, class order, focus policy, image size, and generator options.
- `dataset-validation.json` records image/label pairing, bounding-box checks, class counts, focus coverage, errors, and final validity.

The pipeline reuses a dataset only when its manifest matches the requested split sizes, seed, image size, roster, and focus policy. Batch size and worker count are not part of dataset identity and may be changed later.

## Requirements

For a production run, use:

- the Node.js and pnpm versions declared in `package.json`;
- Python 3.12;
- an NVIDIA GPU with a compatible driver;
- enough GPU memory for the selected batch;
- at least 30 GB of free working space as a comfortable margin.

CPU-only setup is useful for smoke tests and dataset tooling, but full YOLO11m training on a CPU is generally impractical.

Generated data, packages, checkpoints, plots, and logs stay under ignored `.minimap-training` storage. Only files under `resources/minimap-model` are bundled into the application.

## One-time setup

Verify that the committed portraits, bundled model, and training roster agree:

```powershell
pnpm minimap:roster:check
```

Create the isolated Python environment and install pinned dependencies:

```powershell
pnpm minimap:setup
```

On Windows and Linux, setup installs the CUDA 12.4 build of PyTorch by default. Its final output reports the PyTorch version and whether CUDA is available. A production GPU machine should report `cuda=True`.

Download and checksum the immutable upstream checkpoint:

```powershell
pnpm minimap:download-base
```

The download is skipped if the existing checkpoint has the expected SHA-256. Champion portraits are already local, so normal generation and training do not call Data Dragon.

## Verify the plumbing

Before a production run:

```powershell
pnpm minimap:pipeline -- --smoke
```

Smoke mode generates 30 training, 9 validation, and 9 test images, expands the checkpoint, and trains for one epoch. It verifies code paths and formats only. It is too small to measure quality and cannot be combined with `--publish`.

## Recommended production workflow

Separate dataset creation from GPU training. This creates a clean pause point and prevents training from starting immediately when generation finishes.

### 1. Generate and validate

On a 16-core system, eight workers are a balanced starting point:

```powershell
pnpm minimap:pipeline -- --generate-only --workers 8
```

This generates all 120,000 images, writes the dataset configuration and manifest, validates every image/label pair and bounding box, writes the validation report, prints a JSON summary, and exits without training.

The message `Synthetic Data generation completed.` only means the image workers finished. Metadata is written afterward, and the validator then reads 120,000 small label files serially. Validation may take several more minutes while showing little CPU usage because it is filesystem-bound.

Check the completion markers in PowerShell:

```powershell
$dataset = ".\.minimap-training\data\synthetic\lol-minimap-16.16.1-focused"

[pscustomobject]@{
    Config     = Test-Path -LiteralPath (Join-Path $dataset "config.yaml")
    Manifest   = Test-Path -LiteralPath (Join-Path $dataset "generation-manifest.json")
    Validation = Test-Path -LiteralPath (Join-Path $dataset "dataset-validation.json")
}
```

All three values must be `True`, the command must have returned to the shell, and the report must contain `"valid": true`.

```powershell
Get-Content ".\.minimap-training\data\synthetic\lol-minimap-16.16.1-focused\dataset-validation.json"
```

### 2. Train, evaluate, and conditionally publish

After generation-only completes:

```powershell
pnpm minimap:pipeline -- --publish --batch 32 --workers 8
```

The matching dataset is reused rather than regenerated. Validation runs again before the GPU model loads, so a delay before GPU activity is normal.

The remaining phases are checkpoint expansion, five head epochs, fifty full fine-tuning epochs, held-out test evaluation, metric-gated ONNX export, and publication. `--publish` means "publish only if all gates pass"; it does not bypass evaluation.

## Choosing batch and workers

The options control different resources:

- `--batch` controls images processed together by the GPU and primarily affects GPU memory.
- `--workers` controls CPU generation or data-loader processes and primarily affects CPU, RAM, and disk pressure.

For a 16-core desktop:

- `--batch 32 --workers 8` is balanced;
- `--batch 16 --workers 4` leaves more resources for other applications;
- `--workers 12` can be tested on a dedicated machine with fast storage;
- all 16 workers often give diminishing returns and make Windows, antivirus, and storage compete with training.

The pipeline defaults are batch 64 and 8 workers. Reduce batch first for CUDA out-of-memory errors. Reduce workers when the computer is sluggish but GPU memory is comfortable.

## Monitoring and outputs

Monitor the GPU from a second terminal:

```powershell
nvidia-smi -l 2
```

The work directory is organized like this:

```text
.minimap-training/
  checkpoints/                 downloaded and expanded PyTorch checkpoints
  data/synthetic/              generated train, validation, and test splits
  runs/<run-id>-head/          frozen-backbone warm-up
  runs/<run-id>/               full fine-tuning
  runs/evaluations/            reports and evaluation plots
```

A training directory normally contains:

```text
weights/best.pt                best validation-fitness checkpoint
weights/last.pt                most recently completed epoch
metadata.json                  inputs, settings, roster hash, and Git state
results.csv                    per-epoch metrics
results.png                    training curves
```

The default run ID comes from the roster's Data Dragon patch. Use `--run-id` for a separate experiment so it cannot collide with an existing directory.

Training duration depends mainly on GPU throughput. Generation and validation generally take minutes to around an hour; production training generally takes hours. The estimate printed after the first full epoch is more useful than a pre-run estimate.

## Stopping and resuming safely

There is no true suspend button. `Ctrl+C` stops the process, and what can be reused depends on the phase.

### During generation

Do not intentionally interrupt generation. The generator cannot resume a partially written dataset, and it rejects a non-empty incomplete directory to prevent mixed samples.

The safe pause point is after `--generate-only` exits successfully and all three metadata files exist.

If generation was interrupted, the safest recovery is a new dataset name:

```powershell
pnpm minimap:pipeline -- --generate-only --dataset-name lol-minimap-retry --workers 8
```

Pass the same custom `--dataset-name` to the later training command.

If the partial data is not needed, verify and remove only that exact dataset directory before retrying:

```powershell
$partialDataset = Resolve-Path ".\.minimap-training\data\synthetic\lol-minimap-16.16.1-focused"
$partialDataset
Remove-Item -LiteralPath $partialDataset -Recurse -Force
```

This is destructive. Confirm the resolved path is the intended dataset, not the repository or the whole `.minimap-training` directory.

### During training

Ultralytics preserves `last.pt` from completed epochs. Stopping mid-epoch loses work from only that partial epoch.

Do not start a second trainer against the same run. After confirming the original process stopped, resume the appropriate checkpoint directly.

On Windows PowerShell:

```powershell
& ".\.minimap-training\python\Scripts\python.exe" -c "from ultralytics import YOLO; YOLO(r'.minimap-training\runs\RUN_ID\weights\last.pt').train(resume=True)"
```

On Linux:

```bash
.minimap-training/python/bin/python -c "from ultralytics import YOLO; YOLO('.minimap-training/runs/RUN_ID/weights/last.pt').train(resume=True)"
```

Replace `RUN_ID` with the interrupted directory name. The head run ends in `-head`; the full fine-tuning run does not.

The top-level pipeline is not a phase-aware resumer. Re-running it can reuse a complete dataset, but it does not attach to an interrupted Ultralytics run. Existing run directories may instead produce an `exist_ok=False` error.

After directly resuming full fine-tuning, run evaluation and publication manually:

```powershell
pnpm minimap:evaluate -- --weights ".minimap-training/runs/RUN_ID/weights/best.pt" --dataset lol-minimap-16.16.1-focused --evaluation-id RUN_ID-test --split test --device 0

pnpm minimap:publish -- ".minimap-training/runs/RUN_ID/weights/best.pt" --evaluation ".minimap-training/runs/evaluations/RUN_ID-test/evaluation.json"
```

Use a new evaluation ID if that directory already exists.

If the interrupted run was the head warm-up, finish its resume and then start full fine-tuning from the head's best checkpoint with a new, unused main run ID:

```powershell
pnpm minimap:train -- --weights ".minimap-training/runs/HEAD_RUN_ID/weights/best.pt" --dataset lol-minimap-16.16.1-focused --run-id MAIN_RUN_ID --config minimap_training/configs/finetune.yaml --epochs 50 --batch 32 --workers 8 --device 0
```

## Evaluation and publication

The candidate is evaluated against the held-out synthetic `test` split. The report contains overall metrics, exact-order per-class metrics, focus metrics, the evaluated checkpoint hash, and the split name.

Publication requires:

- evaluation schema version 1;
- a checkpoint SHA-256 matching the report;
- the held-out `test` split;
- the exact target class count and ordering;
- a valid result for every champion;
- finite metric values;
- overall mAP50 of at least 0.75;
- mAP50 of at least 0.60 for every focus champion.

If all gates pass, the exporter creates a static ONNX model with a 256 by 256 RGB input and replaces:

```text
resources/minimap-model/yolo11m-minimap.onnx
resources/minimap-model/labels.json
resources/minimap-model/manifest.json
```

The manifest records model hashes, roster provenance, attribution, training base, focus champions, and evaluation. When a gate fails, the candidate and report stay under `.minimap-training`, but the bundled release model is not replaced.

### Limits of the automated gates

The held-out split is synthetic and comes from the same generator family as training data. It can expose broken labels, missing classes, and major model failure, but it does not fully measure the real-game domain gap.

Build the local real-frame corpus with `pnpm minimap:live:build`. Its fully labeled object tier can be evaluated as dataset `recall-live-v1` with `--minimum-focus-instances 0`; its roster tier keeps weaker roster-presence annotations separate. Before committing a published model, compare it with representative recorded minimaps. Include both teams, base and river terrain, icon overlap, fog transitions, different minimap scales, brief visibility, and every focus champion. Compare old-champion recall to the currently bundled model as well. Publication does not yet enforce this real-replay comparison automatically.

## Running stages manually

The top-level pipeline is preferred because it preserves order and provenance. Individual commands are useful for experiments and recovery.

Generate and validate a smaller named dataset:

```powershell
pnpm minimap:generate -- --n-train 1000 --n-val 100 --n-test 100 --dataset-name experiment --workers 4
pnpm minimap:dataset:validate -- experiment
```

Expand the pinned checkpoint:

```powershell
pnpm minimap:checkpoint:expand -- ".minimap-training/checkpoints/upstream-yolo11m-minimap.pt" ".minimap-training/checkpoints/experiment-expanded.pt"
```

Warm the detection head:

```powershell
pnpm minimap:train -- --weights ".minimap-training/checkpoints/experiment-expanded.pt" --dataset experiment --run-id experiment-head --config minimap_training/configs/head.yaml --epochs 5 --batch 32 --workers 8 --device 0
```

Fine-tune the whole model:

```powershell
pnpm minimap:train -- --weights ".minimap-training/runs/experiment-head/weights/best.pt" --dataset experiment --run-id experiment --config minimap_training/configs/finetune.yaml --epochs 50 --batch 32 --workers 8 --device 0
```

Evaluate and publish:

```powershell
pnpm minimap:evaluate -- --weights ".minimap-training/runs/experiment/weights/best.pt" --dataset experiment --evaluation-id experiment-test --split test --device 0

pnpm minimap:publish -- ".minimap-training/runs/experiment/weights/best.pt" --evaluation ".minimap-training/runs/evaluations/experiment-test/evaluation.json"
```

Manual publication uses the same default metric gates. Do not use `--skip-metric-gate` for a release candidate.

## Adding future champions

Portrait updates are intentional and separate from training:

```powershell
pnpm sync:champion-portraits
pnpm sync:minimap-training-roster
pnpm minimap:roster:check
```

`sync:champion-portraits` is the networked Data Dragon update. Later generation uses the committed local portraits and does not call Data Dragon.

The roster updater preserves the pinned base-model definition. The focus set is therefore every target class absent from that pinned base, not just the single newest champion. With the current 170-class base, Locke, Yunara, and Zaahen remain focus classes in later roster snapshots unless the project deliberately adopts and records a newer base checkpoint.

After a roster change:

1. Review the portrait and roster changes.
2. Use new dataset and run IDs; old datasets have a different class map.
3. Run smoke generation, then the production pipeline.
4. Review synthetic metrics and real captures.
5. Commit the portraits, roster, and gated release artifacts together.

## Docker and CI

The CUDA container runs the same pipeline:

```powershell
pnpm minimap:download-base
docker compose -f compose.minimap-training.yaml build
docker compose -f compose.minimap-training.yaml run --rm minimap-training --smoke
```

For a production candidate:

```powershell
docker compose -f compose.minimap-training.yaml run --rm minimap-training --publish --batch 32 --workers 8
```

The GitHub workflow provides a CPU generator/label smoke test, a weekly catalog check, and a manually dispatched full-training job for a self-hosted Linux GPU runner. The GPU job uploads candidate artifacts for review; it does not commit a release model automatically.

## Troubleshooting

### `Synthetic dataset directory is not empty`

The directory contains a complete or partial prior attempt. The generator refuses to mix samples. Let the top-level pipeline reuse it if all metadata is complete and compatible. Otherwise use a new dataset name or deliberately remove only the exact partial directory.

### Generation says complete, but validation is missing

Wait. The 100% message precedes metadata writing and serial validation. Do not stop until `dataset-validation.json` exists and the command exits successfully.

### The pipeline looks idle before training

It validates the dataset every time before loading the model. Scanning 120,000 small files can be storage-bound and show low CPU utilization.

### CUDA is unavailable

Run `pnpm minimap:setup` and inspect its final version line. Confirm the NVIDIA driver is installed and `nvidia-smi` works. An environment created with CPU-only PyTorch must be recreated or updated with CUDA PyTorch for GPU training.

### CUDA runs out of memory

Reduce `--batch`. Reducing workers usually does not solve GPU-memory exhaustion.

### Windows becomes unresponsive

Reduce `--workers`, close GPU-heavy applications, and keep enough disk space free. Eight workers are a balanced choice, not a requirement imposed by a 16-core CPU.

### A run directory already exists

Training uses `exist_ok=False` to avoid mixing experiments. Resume that run's `last.pt` if it is the same experiment, or choose a new `--run-id`.

### The cached dataset does not match

The roster, seed, split sizes, image size, or focus policy changed. Use a new `--dataset-name`; never edit the manifest to force compatibility.

### Publication fails

The release model remains unchanged. Inspect the evaluation JSON and plots, especially per-class recall and focus mAP50. Fix the data or training issue and create a new run rather than lowering gates just to publish.

## Check what currently ships

The target roster and bundled release can have different class counts while a candidate is in training. Check both directly:

```powershell
node -e "const fs=require('node:fs'); const roster=JSON.parse(fs.readFileSync('minimap_training/roster.json')); const labels=JSON.parse(fs.readFileSync('resources/minimap-model/labels.json')); console.log({trainingRoster: roster.classCount, bundledModel: labels.length, focusChampions: roster.focusChampions})"
```

Only the files under `resources/minimap-model` determine what ships with Recall.

## Provenance

The synthetic generator is adapted from `bsowlx/DeepestLeague`. The pinned checkpoint comes from `boboyes/leagueoflegends-minimap-detection`. Their revisions, checksums, license material, and attribution are recorded in the repository and generated model metadata.
