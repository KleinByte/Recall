import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const electronExecutable = require("electron")
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const probe = path.join(scriptDirectory, "native-probe.cjs")

function run(runtime, moduleName, environment = {}) {
  const extraArguments = moduleName === "onnxruntime-node"
    ? [path.resolve(scriptDirectory, "..", "resources", "minimap-model", "yolo11m-minimap.onnx")]
    : []
  const result = spawnSync(runtime, [probe, moduleName, ...extraArguments], {
    cwd: path.resolve(scriptDirectory, ".."),
    env: { ...process.env, ...environment },
    stdio: "inherit",
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${moduleName} failed its native smoke test with exit code ${result.status ?? "unknown"}.`,
    )
  }
}

run(process.execPath, "better-sqlite3-node")
run(electronExecutable, "better-sqlite3", { ELECTRON_RUN_AS_NODE: "1" })
run(process.execPath, "onnxruntime-node")
run(electronExecutable, "onnxruntime-node", { ELECTRON_RUN_AS_NODE: "1" })

console.log("Native module doctor passed for SQLite and ONNX inference under Node and Electron.")
