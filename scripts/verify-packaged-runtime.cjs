const fs = require("node:fs")
const path = require("node:path")
const { createHash } = require("node:crypto")
const { spawnSync } = require("node:child_process")
const { extractFile, listPackage } = require("@electron/asar")

const REQUIRED_ARCHIVE_FILES = [
  "node_modules/@techstark/opencv-js/package.json",
  "node_modules/@techstark/opencv-js/dist/opencv.js",
  "node_modules/better-sqlite3/package.json",
  "node_modules/onnxruntime-common/package.json",
  "node_modules/onnxruntime-node/package.json",
  "node_modules/onnxruntime-node/dist/index.js",
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

function packagedOnnxRuntimeFiles(context) {
  const targetArchitecture = typeof context.arch === "number"
    ? ARCHITECTURE_NAMES[context.arch]
    : context.arch
  if (context.electronPlatformName !== "win32" || targetArchitecture !== "x64") return []
  const root = "node_modules/onnxruntime-node/bin/napi-v6/win32/x64"
  return [
    `${root}/onnxruntime_binding.node`,
    `${root}/onnxruntime.dll`,
  ]
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

function verifyPackagedNativeRuntime(context, nativeBinaryPath, minimapModelPath, modelClassCount) {
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
  // SQLite exposes nativeBinding, so its workspace wrapper can target the
  // packaged binary explicitly. ONNX Runtime is also required directly from
  // app.asar below, exercising its packaged JavaScript/native lookup and model.
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
  const packagedOnnxRuntimePath = path.join(
    packagedResourcesDirectory(context),
    "app.asar",
    "node_modules",
    "onnxruntime-node"
  )
  const probe = [
    `const Database = require(${JSON.stringify(modulePath)})`,
    `const ort = require(${JSON.stringify(packagedOnnxRuntimePath)})`,
    `const { Worker } = require("node:worker_threads")`,
    `const database = new Database(":memory:", { nativeBinding: ${JSON.stringify(nativeBinaryPath)} })`,
    `const row = database.prepare("SELECT 42 AS value").get()`,
    `database.close()`,
    `if (row.value !== 42) throw new Error("Unexpected SQLite result")`,
    `const runWorker = (file, request, validate, label) => new Promise((resolve, reject) => { const worker = new Worker(file); const timer = setTimeout(() => { worker.terminate().catch(() => undefined); reject(new Error(label + " timed out")) }, 30000); worker.once("error", error => { clearTimeout(timer); reject(error) }); worker.once("message", async message => { clearTimeout(timer); try { validate(message); await worker.terminate(); resolve() } catch (error) { await worker.terminate().catch(() => undefined); reject(error) } }); worker.postMessage(request) })`,
    `;(async () => { await runWorker(${JSON.stringify(analysisWorkerPath)}, { id: 1, task: "ping" }, message => { if (message.result !== "pong") throw new Error("Unexpected analysis worker response") }, "Analysis worker"); await runWorker(${JSON.stringify(visionWorkerPath)}, { id: 2, task: "initialize", canonicalSize: 320 }, message => { if (!message.ok || message.task !== "initialize" || message.result?.engine !== "opencv_js" || message.result?.championModel?.available !== true) throw new Error("Unexpected OpenCV/ONNX vision worker response") }, "OpenCV/ONNX vision worker"); const session = await ort.InferenceSession.create(${JSON.stringify(minimapModelPath)}, { executionProviders: ["cpu"], graphOptimizationLevel: "all" }); const output = await session.run({ images: new ort.Tensor("float32", new Float32Array(3 * 256 * 256), [1, 3, 256, 256]) }); const prediction = output[session.outputNames[0]]; const expected = "1x" + (${modelClassCount} + 4) + "x1344"; if (!prediction || prediction.dims.join("x") !== expected) throw new Error("Unexpected packaged ONNX output"); await session.release() })().catch(error => { console.error(error); process.exit(6) })`,
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
  const noticesPath = path.join(resourcesDirectory, "THIRD_PARTY_NOTICES.md")
  if (!fs.existsSync(noticesPath)) {
    throw new Error("Packaged third-party attribution is missing.")
  }
  const portraitDirectory = path.join(resourcesDirectory, "champion-portraits")
  const portraitManifestPath = path.join(portraitDirectory, "manifest.json")
  const portraitManifest = fs.existsSync(portraitManifestPath)
    ? JSON.parse(fs.readFileSync(portraitManifestPath, "utf8"))
    : undefined
  const packagedPortraits = fs.existsSync(portraitDirectory)
    ? fs.readdirSync(portraitDirectory).filter(file => file.endsWith(".png"))
    : []
  if (!portraitManifest || portraitManifest.schemaVersion !== 1 ||
      portraitManifest.championCount !== portraitManifest.champions?.length ||
      portraitManifest.championCount !== packagedPortraits.length ||
      portraitManifest.championCount < 150) {
    throw new Error("Packaged champion portrait bank is missing or incomplete.")
  }
  const modelDirectory = path.join(resourcesDirectory, "minimap-model")
  const modelManifestPath = path.join(modelDirectory, "manifest.json")
  const modelManifest = fs.existsSync(modelManifestPath)
    ? JSON.parse(fs.readFileSync(modelManifestPath, "utf8"))
    : undefined
  const labelsPath = modelManifest
    ? path.join(modelDirectory, modelManifest.labelsFile)
    : ""
  const modelPath = modelManifest
    ? path.join(modelDirectory, modelManifest.artifactFile)
    : ""
  const labels = labelsPath && fs.existsSync(labelsPath)
    ? JSON.parse(fs.readFileSync(labelsPath, "utf8"))
    : undefined
  const modelBytes = modelPath && fs.existsSync(modelPath)
    ? fs.readFileSync(modelPath)
    : undefined
  const portraitKeys = new Set(
    portraitManifest.champions.map(champion => String(champion.assetKey).toLowerCase())
  )
  if (!modelManifest || modelManifest.schemaVersion !== 1 ||
      modelManifest.classCount < 150 ||
      modelManifest.classCount > portraitManifest.championCount || !Array.isArray(labels) ||
      labels.length !== modelManifest.classCount || !labels.includes("Garen") ||
      labels.some(label => typeof label !== "string" || !portraitKeys.has(label.toLowerCase())) ||
      new Set(labels.map(label => label.toLowerCase())).size !== labels.length ||
      !modelBytes || modelBytes.length !== modelManifest.artifactBytes ||
      createHash("sha256").update(modelBytes).digest("hex") !== modelManifest.artifactSha256) {
    throw new Error("Packaged minimap model is missing, corrupt, or incompatible.")
  }
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
  const onnxRuntimeFiles = packagedOnnxRuntimeFiles(context)
  const missingOnnxRuntimeFiles = onnxRuntimeFiles.filter(
    filePath => !fs.existsSync(path.join(unpackedRoot, filePath)),
  )
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
    missingOnnxRuntimeFiles.length > 0 ||
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
        missingOnnxRuntimeFiles.length > 0
          ? `Missing unpacked ONNX Runtime files: ${missingOnnxRuntimeFiles.join(", ")}.`
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
    nativeBinary ? path.join(unpackedRoot, nativeBinary) : undefined,
    modelPath,
    modelManifest.classCount
  )

  console.log(
    `Packaged runtime verified: ${REQUIRED_ARCHIVE_FILES.length} external modules, ` +
    `${packagedPortraits.length} offline champion portraits, ` +
    `a checksummed ${Math.round(modelBytes.length / 1024 / 1024)} MB minimap model, ` +
    `${packagedNativeBinaries.length} target native binary, no foreign/build-only native sources, ` +
    `bundled main-process dependencies, and ` +
    `${nativeRuntimeExecuted
      ? "a successful SQLite query plus analysis/OpenCV/ONNX worker launches"
      : "cross-build static validation"}.`
  )
}
