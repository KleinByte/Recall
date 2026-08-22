/** Create the ignored Python environment used by the minimap training tools. */

import { access, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import process from "node:process"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const environmentDirectory = resolve(repositoryRoot, ".minimap-training/python")
process.env.NO_ALBUMENTATIONS_UPDATE ||= "1"
process.env.WANDB_DISABLED ||= "true"

function run(command, argumentsList, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, argumentsList, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: options.quiet ? "ignore" : "inherit",
      windowsHide: true,
    })
    child.once("error", rejectRun)
    child.once("exit", (code) => code === 0
      ? resolveRun()
      : rejectRun(new Error(`${command} exited with code ${code}`)))
  })
}

async function findPython() {
  const configured = process.env.RECALL_TRAINING_PYTHON?.trim()
  const candidates = configured
    ? [[configured, []]]
    : process.platform === "win32"
      ? [["py", ["-3.12"]], ["python", []]]
      : [["python3", []], ["python", []]]
  for (const [command, prefix] of candidates) {
    try {
      await run(command, [...prefix, "--version"], { quiet: true })
      return { command, prefix }
    } catch {
      // Try the next conventional interpreter name.
    }
  }
  throw new Error(
    "Python 3.12 was not found. Set RECALL_TRAINING_PYTHON to its executable path.",
  )
}

const environmentPython = process.platform === "win32"
  ? resolve(environmentDirectory, "Scripts/python.exe")
  : resolve(environmentDirectory, "bin/python")

try {
  await access(environmentPython)
} catch {
  const python = await findPython()
  await mkdir(dirname(environmentDirectory), { recursive: true })
  await run(python.command, [...python.prefix, "-m", "venv", environmentDirectory])
}

await run(environmentPython, ["-m", "pip", "install", "--upgrade", "pip==25.0.1"])
const torchFlavor = process.env.RECALL_TORCH_FLAVOR?.trim() ||
  (process.platform === "darwin" ? "pypi" : "cu124")
const torchArguments = [
  "-m", "pip", "install",
  "torch==2.5.1", "torchvision==0.20.1",
]
if (torchFlavor !== "pypi") {
  torchArguments.push("--index-url", `https://download.pytorch.org/whl/${torchFlavor}`)
}
await run(environmentPython, torchArguments)
await run(environmentPython, [
  "-m", "pip", "install", "-r",
  resolve(repositoryRoot, "minimap_training/requirements.txt"),
])
await run(environmentPython, [
  "-c",
  "import albumentations, cv2, onnx, torch, ultralytics, yaml; " +
  "print(f'torch={torch.__version__} cuda={torch.cuda.is_available()} ' " +
  "+ f'ultralytics={ultralytics.__version__} opencv={cv2.__version__}')",
])
console.log(`Minimap training environment is ready: ${environmentPython}`)
