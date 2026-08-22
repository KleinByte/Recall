/** Launch a minimap_training Python module from the reproducible local environment. */

import { access } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import process from "node:process"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const configured = process.env.RECALL_TRAINING_PYTHON?.trim()
const environmentPython = process.platform === "win32"
  ? resolve(repositoryRoot, ".minimap-training/python/Scripts/python.exe")
  : resolve(repositoryRoot, ".minimap-training/python/bin/python")
const python = configured || environmentPython

try {
  await access(python)
} catch {
  throw new Error(
    "Minimap training Python is not ready. Run `pnpm minimap:setup` or set " +
    "RECALL_TRAINING_PYTHON.",
  )
}
if (process.argv.length < 3) {
  throw new Error("usage: run-minimap-training.mjs PYTHON_MODULE [ARGUMENTS...]")
}

const child = spawn(python, ["-m", process.argv[2], ...process.argv.slice(3)], {
  cwd: repositoryRoot,
  env: { ...process.env, PYTHONUNBUFFERED: "1" },
  stdio: "inherit",
  windowsHide: true,
})
child.once("error", (error) => {
  throw error
})
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`Minimap training was terminated by ${signal}.`)
    process.exitCode = 1
  } else {
    process.exitCode = code ?? 1
  }
})
