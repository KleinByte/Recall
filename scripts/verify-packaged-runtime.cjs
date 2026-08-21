const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { extractFile, listPackage } = require("@electron/asar")

const REQUIRED_ARCHIVE_FILES = [
  "node_modules/@techstark/opencv-js/package.json",
  "node_modules/@techstark/opencv-js/dist/opencv.js",
  "node_modules/better-sqlite3/package.json",
  "node_modules/ws/package.json",
]
const REQUIRED_BACKGROUND_FILES = [
  "dist-electron/main/analysis-worker.js",
  "dist-electron/main/vision-worker.js",
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
  const analysisWorkerPath = path.join(
    __dirname,
    "..",
    "dist-electron",
    "main",
    "analysis-worker.js"
  )
  const visionWorkerPath = path.join(
    __dirname,
    "..",
    "dist-electron",
    "main",
    "vision-worker.js"
  )
  const probe = [
    `const Database = require(${JSON.stringify(modulePath)})`,
    `const { Worker } = require("node:worker_threads")`,
    `const database = new Database(":memory:", { nativeBinding: ${JSON.stringify(nativeBinaryPath)} })`,
    `const row = database.prepare("SELECT 42 AS value").get()`,
    `database.close()`,
    `if (row.value !== 42) throw new Error("Unexpected SQLite result")`,
    `const runWorker = (file, request, validate, label) => new Promise((resolve, reject) => { const worker = new Worker(file); const timer = setTimeout(() => { worker.terminate().catch(() => undefined); reject(new Error(label + " timed out")) }, 30000); worker.once("error", error => { clearTimeout(timer); reject(error) }); worker.once("message", async message => { clearTimeout(timer); try { validate(message); await worker.terminate(); resolve() } catch (error) { await worker.terminate().catch(() => undefined); reject(error) } }); worker.postMessage(request) })`,
    `;(async () => { await runWorker(${JSON.stringify(analysisWorkerPath)}, { id: 1, task: "ping" }, message => { if (message.result !== "pong") throw new Error("Unexpected analysis worker response") }, "Analysis worker"); await runWorker(${JSON.stringify(visionWorkerPath)}, { id: 2, task: "initialize", canonicalSize: 320 }, message => { if (!message.ok || message.task !== "initialize" || message.result?.engine !== "opencv_js") throw new Error("Unexpected OpenCV vision worker response") }, "OpenCV vision worker") })().catch(error => { console.error(error); process.exit(6) })`,
  ].join(";")
  const result = spawnSync(executable, ["-e", probe], {
    cwd: context.appOutDir,
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    timeout: 70_000,
    windowsHide: true,
  })

  if (result.error || result.status !== 0) {
    const diagnostic = [
      result.error?.message,
      result.stderr?.trim(),
      result.stdout?.trim(),
    ].filter(Boolean).join(" ")
    throw new Error(
      `Packaged runtime execution failed` +
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
  const nativePrebuildDirectory = path.join(
    unpackedRoot,
    "node_modules",
    "better-sqlite3",
    "prebuilds"
  )
  const packagedNativeBinaries = fs.existsSync(nativePrebuildDirectory)
    ? fs.readdirSync(nativePrebuildDirectory)
      .filter(fileName => fileName.endsWith(".node"))
      .sort()
    : []
  const missingUnpackedFiles = nativeBinary &&
    !fs.existsSync(path.join(unpackedRoot, nativeBinary))
    ? [nativeBinary]
    : []
  const expectedNativeFileName = nativeBinary && path.basename(nativeBinary)
  const unexpectedNativeBinaries = packagedNativeBinaries.filter(
    fileName => fileName !== expectedNativeFileName
  )
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
    unexpectedNativeBinaries.length > 0 ||
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
        unexpectedNativeBinaries.length > 0
          ? `Foreign native binaries were packaged: ${unexpectedNativeBinaries.join(", ")}.`
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
    `${packagedNativeBinaries.length} target native binary, no foreign/build-only native sources, ` +
    `bundled main-process dependencies, and ` +
    `${nativeRuntimeExecuted
      ? "a successful SQLite query plus analysis/OpenCV worker launches"
      : "cross-build static validation"}.`
  )
}
