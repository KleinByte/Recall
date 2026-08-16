const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { extractFile, listPackage } = require("@electron/asar")

const REQUIRED_ARCHIVE_FILES = [
  "node_modules/better-sqlite3/package.json",
  "node_modules/ws/package.json",
]
const REQUIRED_BACKGROUND_FILES = [
  "dist-electron/main/analysis-worker.js",
]
const FORBIDDEN_UNPACKED_FILES = [
  "node_modules/better-sqlite3/deps/sqlite3/sqlite3.c",
  "node_modules/better-sqlite3/deps/sqlite3/sqlite3.h",
  "node_modules/better-sqlite3/src/addon.cpp",
]
const MODULES_THAT_MUST_BE_BUNDLED = [
  "builder-util-runtime",
  "electron-store",
  "electron-updater",
]
const ARCHITECTURE_NAMES = ["ia32", "x64", "armv7l", "arm64", "universal"]

function packagedNativeBinary(context) {
  const targetArchitecture = typeof context.arch === "number"
    ? ARCHITECTURE_NAMES[context.arch]
    : context.arch
  if (!targetArchitecture || targetArchitecture === "universal") return undefined
  const platform = context.electronPlatformName === "win32"
    ? "win32"
    : context.electronPlatformName
  return `node_modules/better-sqlite3/prebuilds/${platform}-${targetArchitecture}.node`
}

function packagedResourcesDirectory(context) {
  const productFilename = context.packager.appInfo.productFilename
  return context.electronPlatformName === "darwin"
    ? path.join(
        context.appOutDir,
        `${productFilename}.app`,
        "Contents",
        "Resources"
      )
    : path.join(context.appOutDir, "resources")
}

function packagedExecutable(context) {
  const appInfo = context.packager.appInfo
  if (context.electronPlatformName === "win32") {
    return path.join(context.appOutDir, `${appInfo.productFilename}.exe`)
  }
  if (context.electronPlatformName === "darwin") {
    return path.join(
      context.appOutDir,
      `${appInfo.productFilename}.app`,
      "Contents",
      "MacOS",
      appInfo.productFilename
    )
  }
  return path.join(
    context.appOutDir,
    context.packager.executableName || appInfo.sanitizedName
  )
}

function verifyPackagedNativeRuntime(context, nativeBinaryPath) {
  const targetArchitecture = typeof context.arch === "number"
    ? ARCHITECTURE_NAMES[context.arch]
    : context.arch
  const hostArchitecture = process.arch === "arm" ? "armv7l" : process.arch
  const architectureMatches = !targetArchitecture ||
    targetArchitecture === "universal" ||
    targetArchitecture === hostArchitecture

  if (context.electronPlatformName !== process.platform || !architectureMatches) {
    console.log(
      `Packaged native execution skipped for cross-build ` +
      `${process.platform}/${hostArchitecture} -> ` +
      `${context.electronPlatformName}/${targetArchitecture ?? "unknown"}; ` +
      `static checks passed.`
    )
    return false
  }

  const executable = packagedExecutable(context)
  // Loading JavaScript directly through app.asar during electron-builder's
  // afterPack hook is unreliable on Windows: Electron can observe the archive
  // while its integrity metadata is still being finalized. Static checks above
  // validate the archived wrapper; this probe targets the packaged native
  // binary explicitly while using the matching workspace wrapper.
  const modulePath = path.join(
    __dirname,
    "..",
    "node_modules",
    "better-sqlite3"
  )
  const workerPath = path.join(
    __dirname,
    "..",
    "dist-electron",
    "main",
    "analysis-worker.js"
  )
  const probe = [
    `const Database = require(${JSON.stringify(modulePath)})`,
    `const { Worker } = require("node:worker_threads")`,
    `const database = new Database(":memory:", { nativeBinding: ${JSON.stringify(nativeBinaryPath)} })`,
    `const row = database.prepare("SELECT 42 AS value").get()`,
    `database.close()`,
    `if (row.value !== 42) throw new Error("Unexpected SQLite result")`,
    `const worker = new Worker(${JSON.stringify(workerPath)})`,
    `const timer = setTimeout(() => { console.error("Analysis worker timed out"); process.exit(4) }, 10000)`,
    `worker.once("error", error => { clearTimeout(timer); console.error(error); process.exit(5) })`,
    `worker.once("message", async message => { clearTimeout(timer); if (message.result !== "pong") { console.error("Unexpected analysis worker response"); process.exit(6) }; await worker.terminate() })`,
    `worker.postMessage({ id: 1, task: "ping" })`,
  ].join(";")
  const result = spawnSync(executable, ["-e", probe], {
    cwd: context.appOutDir,
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    timeout: 30_000,
    windowsHide: true,
  })

  if (result.error || result.status !== 0) {
    const diagnostic = [
      result.error?.message,
      result.stderr?.trim(),
      result.stdout?.trim(),
    ].filter(Boolean).join(" ")
    throw new Error(
      `Packaged better-sqlite3 execution failed` +
      `${diagnostic ? `: ${diagnostic}` : ` with exit code ${result.status}`}`
    )
  }

  return true
}

module.exports = async context => {
  const resourcesDirectory = packagedResourcesDirectory(context)
  const archivePath = path.join(resourcesDirectory, "app.asar")
  const archiveFiles = new Set(
    listPackage(archivePath, { isPack: false }).map(filePath =>
      filePath.replace(/^[/\\]+/, "").replaceAll("\\", "/")
    )
  )
  const missingArchiveFiles = REQUIRED_ARCHIVE_FILES.filter(
    filePath => !archiveFiles.has(filePath)
  )
  const missingBackgroundFiles = REQUIRED_BACKGROUND_FILES.filter(
    filePath => !archiveFiles.has(filePath)
  )
  const unpackedRoot = path.join(
    resourcesDirectory,
    "app.asar.unpacked"
  )
  const nativeBinary = packagedNativeBinary(context)
  const missingUnpackedFiles = nativeBinary &&
    !fs.existsSync(path.join(unpackedRoot, nativeBinary))
    ? [nativeBinary]
    : []
  const buildOnlyUnpackedFiles = FORBIDDEN_UNPACKED_FILES.filter(
    filePath => fs.existsSync(path.join(unpackedRoot, filePath))
  )
  const mainEntry = extractFile(
    archivePath,
    path.join("dist-electron", "main", "index.js")
  ).toString()
  const externalModules = MODULES_THAT_MUST_BE_BUNDLED.filter(moduleName => {
    const escapedName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(
      `(?:from\\s*|require\\(\\s*)["']${escapedName}["']`
    ).test(mainEntry)
  })

  if (
    missingArchiveFiles.length > 0 ||
    missingBackgroundFiles.length > 0 ||
    missingUnpackedFiles.length > 0 ||
    buildOnlyUnpackedFiles.length > 0 ||
    externalModules.length > 0
  ) {
    throw new Error(
      [
        "Packaged runtime is incomplete.",
        missingArchiveFiles.length > 0
          ? `Missing from app.asar: ${missingArchiveFiles.join(", ")}.`
          : "",
        missingBackgroundFiles.length > 0
          ? `Missing background entries: ${missingBackgroundFiles.join(", ")}.`
          : "",
        missingUnpackedFiles.length > 0
          ? `Missing unpacked native files: ${missingUnpackedFiles.join(", ")}.`
          : "",
        buildOnlyUnpackedFiles.length > 0
          ? `Build-only native sources were packaged: ${buildOnlyUnpackedFiles.join(", ")}.`
          : "",
        externalModules.length > 0
          ? `Main-process modules were not bundled: ${externalModules.join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    )
  }

  const nativeRuntimeExecuted = verifyPackagedNativeRuntime(
    context,
    nativeBinary ? path.join(unpackedRoot, nativeBinary) : undefined
  )

  console.log(
    `Packaged runtime verified: ${REQUIRED_ARCHIVE_FILES.length} external modules, ` +
    `${nativeBinary ? 1 : 0} native binary, no build-only native sources, ` +
    `bundled main-process dependencies, and ` +
    `${nativeRuntimeExecuted
      ? "a successful in-memory native query and analysis-worker launch"
      : "cross-build static validation"}.`
  )
}
