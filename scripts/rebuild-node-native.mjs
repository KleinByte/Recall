import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import process from "node:process"

const require = createRequire(import.meta.url)
const modulePackage = require.resolve("better-sqlite3-node/package.json")
const moduleDirectory = path.dirname(modulePackage)
const moduleRequire = createRequire(modulePackage)
const prebuildInstall = moduleRequire.resolve("prebuild-install/bin.js")
const nodeGyp = require.resolve("node-gyp/bin/node-gyp.js")
const nativeBinary = path.join(
  moduleDirectory,
  "build",
  "Release",
  "better_sqlite3.node",
)

// pnpm may initially import two aliases from the same content-addressed file.
// Unlink the test copy before replacing it so the Electron binary is untouched.
rmSync(nativeBinary, { force: true })

function execute(command, args) {
  return spawnSync(command, args, {
    cwd: moduleDirectory,
    env: {
      ...process.env,
      npm_config_runtime: "node",
      npm_config_target: process.versions.node,
    },
    stdio: "inherit",
  })
}

const prebuilt = execute(process.execPath, [
  prebuildInstall,
  "--runtime=node",
  `--target=${process.versions.node}`,
  "--force",
])

if (prebuilt.error) throw prebuilt.error
if (prebuilt.status === 0) {
  console.log("Installed the Node-native better-sqlite3 test binary.")
  process.exit(0)
}

console.warn("No matching prebuilt Node binary was available; building from source.")
const compiled = execute(process.execPath, [nodeGyp, "rebuild", "--release"])
if (compiled.error) throw compiled.error
if (compiled.status !== 0) {
  throw new Error(
    `Node-native better-sqlite3 rebuild failed with exit code ${compiled.status ?? "unknown"}.`,
  )
}

console.log("Built the Node-native better-sqlite3 test binary from source.")
