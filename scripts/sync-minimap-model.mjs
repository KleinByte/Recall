/**
 * Downloads the pinned third-party minimap detector and exports the release
 * ONNX artifact. Python/Ultralytics are development-only and are never shipped.
 *
 * Bootstrap the ignored local tool directory with:
 *   python -m pip install --target .model-tools -r scripts/minimap-model-requirements.txt
 * Set RECALL_MODEL_PYTHON when `python` is not the desired interpreter, then
 * run: pnpm sync:minimap-model
 */

import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path, { dirname, resolve } from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const MODEL_REPOSITORY = "boboyes/leagueoflegends-minimap-detection"
const MODEL_REVISION = "5c98bdcfa1961a3bb1be57591e7d20d6eb0ac531"
const MODEL_FILE = "yolo11m-minimap.pt"
// Filled from Hugging Face's immutable revision. The first bootstrap export
// records the same value in manifest.json; subsequent syncs fail on mismatch.
const EXPECTED_SOURCE_SHA256 = "c247901341e905fd39633ccb7a4ef3133bcb7c8f9375bfda962d13f6bfa3d755"
const INPUT_SIZE = 256
const BASE_CLASS_COUNT = 170

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outputDirectory = resolve(root, "resources/minimap-model")
const python = process.env.RECALL_MODEL_PYTHON?.trim() || "python"
const forceUpstream = process.argv.includes("--force-upstream")

async function fetchBytes(url) {
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      await new Promise((resolveRetry) => setTimeout(resolveRetry, 500 * 2 ** attempt))
    }
  }
  throw lastError
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const pythonPath = [
      resolve(root, ".model-tools"),
      process.env.PYTHONPATH,
    ].filter(Boolean).join(path.delimiter)
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, PYTHONPATH: pythonPath },
      stdio: "inherit",
      windowsHide: true,
    })
    child.once("error", rejectRun)
    child.once("exit", (code) => code === 0
      ? resolveRun()
      : rejectRun(new Error(`${command} exited with code ${code}`)))
  })
}

if (!forceUpstream) {
  try {
    const existing = JSON.parse(
      await readFile(resolve(outputDirectory, "manifest.json"), "utf8"),
    )
    if (Number(existing.classCount) > BASE_CLASS_COUNT) {
      throw new Error(
        `Refusing to replace a ${existing.classCount}-class trained model with the ` +
        `${BASE_CLASS_COUNT}-class upstream base. Pass --force-upstream only when intentional.`,
      )
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
}

const staging = await mkdtemp(path.join(tmpdir(), "recall-minimap-model-"))
try {
  const sourceUrl = `https://huggingface.co/${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}/${MODEL_FILE}`
  const checkpoint = await fetchBytes(sourceUrl)
  const sourceSha256 = sha256(checkpoint)
  if (EXPECTED_SOURCE_SHA256 && sourceSha256 !== EXPECTED_SOURCE_SHA256) {
    throw new Error(`Model checksum mismatch: expected ${EXPECTED_SOURCE_SHA256}, received ${sourceSha256}`)
  }
  const checkpointPath = path.join(staging, MODEL_FILE)
  await writeFile(checkpointPath, checkpoint)
  await mkdir(outputDirectory, { recursive: true })
  await run(python, [
    resolve(root, "scripts/export-minimap-model.py"),
    checkpointPath,
    outputDirectory,
  ])

  const modelPath = resolve(outputDirectory, "yolo11m-minimap.onnx")
  const modelBytes = await readFile(modelPath)
  const labels = JSON.parse(await readFile(resolve(outputDirectory, "labels.json"), "utf8"))
  if (!Array.isArray(labels) || labels.length !== BASE_CLASS_COUNT || !labels.includes("Garen")) {
    throw new Error(`Unexpected minimap label catalog (${labels?.length ?? "invalid"})`)
  }
  const manifest = {
    schemaVersion: 1,
    model: "YOLO11m League of Legends Minimap Detection",
    repository: MODEL_REPOSITORY,
    revision: MODEL_REVISION,
    sourceFile: MODEL_FILE,
    sourceSha256,
    artifactFile: path.basename(modelPath),
    artifactSha256: sha256(modelBytes),
    artifactBytes: modelBytes.length,
    format: "onnx",
    opset: 17,
    input: { name: "images", shape: [1, 3, INPUT_SIZE, INPUT_SIZE], color: "RGB", range: [0, 1] },
    classCount: labels.length,
    labelsFile: "labels.json",
    license: "CC-BY-NC-4.0",
    attribution: "boboyes/leagueoflegends-minimap-detection and bsowlx/DeepestLeague",
  }
  await writeFile(
    resolve(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  )
  console.log(`Saved ${Math.round(modelBytes.length / 1024 / 1024)} MB ONNX model with ${labels.length} labels.`)
  console.log(`Pinned source SHA-256: ${sourceSha256}`)
} finally {
  await rm(staging, { recursive: true, force: true })
}
