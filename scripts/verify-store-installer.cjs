const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const repositoryRoot = path.resolve(__dirname, "..")
const packageJson = require(path.join(repositoryRoot, "package.json"))
const builderConfig = require(path.join(repositoryRoot, "electron-builder.json"))
const releaseDirectory = path.join(
  repositoryRoot,
  "release",
  packageJson.version,
)
const defaultInstaller = path.join(
  releaseDirectory,
  `${builderConfig.productName}-Windows-Setup.exe`,
)
const installerPath = path.resolve(process.argv[2] || defaultInstaller)
const inventoryPath = path.join(
  path.dirname(installerPath),
  "Recall-Windows-Setup.store-inventory.json",
)
const checksumsPath = path.join(
  path.dirname(installerPath),
  "Recall-Windows-Setup.sha256",
)
const defenderReportPath = path.join(
  path.dirname(installerPath),
  "Recall-Windows-Setup.defender.json",
)

const SHIPPED_RUNTIME_PACKAGE_ROOTS = [
  ...Object.keys(packageJson.dependencies || {}),
  "@fortawesome/fontawesome-svg-core",
  "@fortawesome/free-brands-svg-icons",
  "@fortawesome/free-regular-svg-icons",
  "@fortawesome/free-solid-svg-icons",
  "@fortawesome/vue-fontawesome",
  "echarts",
  "electron",
  "electron-store",
  "electron-updater",
  "vue",
]
const LEAF_RUNTIME_PACKAGES = new Set(["electron"])

function fail(message) {
  throw new Error(`Store installer verification failed: ${message}`)
}

function assertFile(filePath, label) {
  if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    fail(`${label} is missing at ${filePath}`)
  }
}

function sha256File(filePath) {
  const digest = crypto.createHash("sha256")
  const descriptor = fs.openSync(filePath, "r")
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytesRead
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead))
    } while (bytesRead > 0)
  } finally {
    fs.closeSync(descriptor)
  }
  return digest.digest("hex")
}

function peMachine(filePath) {
  const descriptor = fs.openSync(filePath, "r")
  try {
    const header = Buffer.alloc(64)
    if (fs.readSync(descriptor, header, 0, header.length, 0) < header.length ||
        header.toString("ascii", 0, 2) !== "MZ") return undefined
    const peOffset = header.readUInt32LE(0x3c)
    const signatureAndMachine = Buffer.alloc(6)
    if (fs.readSync(descriptor, signatureAndMachine, 0, 6, peOffset) < 6 ||
        signatureAndMachine.toString("binary", 0, 4) !== "PE\u0000\u0000") {
      return undefined
    }
    return signatureAndMachine.readUInt16LE(4)
  } finally {
    fs.closeSync(descriptor)
  }
}

function walkFiles(root) {
  const result = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) pending.push(absolutePath)
      else if (entry.isFile()) result.push(absolutePath)
    }
  }
  return result
}

function commandPath(command) {
  const lookup = spawnSync("where.exe", [command], {
    encoding: "utf8",
    windowsHide: true,
  })
  if (lookup.status !== 0) return undefined
  return lookup.stdout.split(/\r?\n/).map(value => value.trim()).find(Boolean)
}

async function sevenZipPath() {
  const candidates = [
    process.env.SEVEN_ZIP,
    commandPath("7z.exe"),
    path.join(process.env.ProgramFiles || "", "7-Zip", "7z.exe"),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate
  }

  try {
    const { getPath7za } = require("app-builder-lib/out/toolsets/7zip")
    return await getPath7za()
  } catch (error) {
    fail(`7-Zip is unavailable: ${error.message}`)
  }
}

function run7Zip(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    fail([
      `7-Zip exited with ${result.status}`,
      result.error?.message,
      result.stderr?.trim(),
      result.stdout?.trim(),
    ].filter(Boolean).join(": "))
  }
}

function normalizeRelative(root, filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/")
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""))
}

function packageDirectory(packageName, fromDirectory = repositoryRoot) {
  const segments = packageName.split("/")
  let current = path.resolve(fromDirectory)
  while (true) {
    const candidate = path.join(current, "node_modules", ...segments)
    if (fs.statSync(path.join(candidate, "package.json"), {
      throwIfNoEntry: false,
    })?.isFile()) return candidate
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function repositoryUrl(repository) {
  if (typeof repository === "string") return repository
  return repository?.url || undefined
}

function licenseFiles(directory, packageName) {
  const searchDirectories = [directory]
  if (packageName === "electron") searchDirectories.push(path.join(directory, "dist"))
  const files = []
  for (const searchDirectory of searchDirectories) {
    if (!fs.statSync(searchDirectory, { throwIfNoEntry: false })?.isDirectory()) continue
    for (const entry of fs.readdirSync(searchDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^(?:licen[cs]e|copying|notice)/i.test(entry.name)) continue
      const absolutePath = path.join(searchDirectory, entry.name)
      files.push({
        path: normalizeRelative(repositoryRoot, absolutePath),
        sha256: sha256File(absolutePath),
      })
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function dependencyInventory() {
  const pending = SHIPPED_RUNTIME_PACKAGE_ROOTS.map(name => ({
    name,
    fromDirectory: repositoryRoot,
    required: true,
  }))
  const visitedDirectories = new Set()
  const visitedPackages = new Set()
  const dependencies = []

  while (pending.length > 0) {
    const request = pending.shift()
    const directory = packageDirectory(request.name, request.fromDirectory)
    if (!directory) {
      if (request.required) fail(`runtime dependency ${request.name} is not installed`)
      continue
    }
    const canonicalDirectory = fs.realpathSync(directory)
    if (visitedDirectories.has(canonicalDirectory)) continue
    visitedDirectories.add(canonicalDirectory)

    const metadata = readJson(path.join(directory, "package.json"))
    const packageIdentity = `${metadata.name}@${metadata.version}`
    if (visitedPackages.has(packageIdentity)) continue
    visitedPackages.add(packageIdentity)
    const licenses = licenseFiles(directory, metadata.name)
    const declaredLicense = typeof metadata.license === "string"
      ? metadata.license
      : metadata.license?.type
    if (!declaredLicense && licenses.length === 0) {
      fail(`runtime dependency ${metadata.name}@${metadata.version} has no license declaration or license file`)
    }
    dependencies.push({
      name: metadata.name,
      version: metadata.version,
      license: declaredLicense || "SEE LICENSE FILE",
      homepage: metadata.homepage || undefined,
      repository: repositoryUrl(metadata.repository),
      licenseFiles: licenses,
    })

    if (LEAF_RUNTIME_PACKAGES.has(metadata.name)) continue
    const childNames = new Set([
      ...Object.keys(metadata.dependencies || {}),
      ...Object.keys(metadata.optionalDependencies || {}),
    ])
    for (const name of [...childNames].sort()) {
      pending.push({ name, fromDirectory: directory, required: false })
    }
  }

  return dependencies.sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`))
}

function runAuthenticodeAudit(targets, temporaryDirectory) {
  if (process.platform !== "win32") fail("Authenticode verification requires Windows")
  const targetsPath = path.join(temporaryDirectory, "signature-targets.json")
  const outputPath = path.join(temporaryDirectory, "signatures.json")
  fs.writeFileSync(targetsPath, `${JSON.stringify(targets, null, 2)}\n`)
  const scriptPath = path.join(__dirname, "collect-authenticode.ps1")
  const powerShell = commandPath("pwsh.exe") || commandPath("powershell.exe")
  if (!powerShell) fail("PowerShell is unavailable for Authenticode verification")
  const result = spawnSync(powerShell, [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-TargetsPath",
    targetsPath,
    "-OutputPath",
    outputPath,
  ], {
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    fail([
      "Authenticode inventory could not be collected",
      result.error?.message,
      result.stderr?.trim(),
      result.stdout?.trim(),
    ].filter(Boolean).join(": "))
  }

  const signatures = readJson(outputPath)
  const invalid = signatures.filter(signature =>
    signature.status !== "Valid" ||
    !signature.signerSubject ||
    !signature.timestampSubject)
  if (invalid.length > 0) {
    fail(`unsigned, untrusted, or untimestamped PE files: ${invalid.map(item =>
      `${item.path} (${item.status || "missing signature"})`).join(", ")}`)
  }
  return signatures
}

function validateDefenderReport(installerSha256) {
  assertFile(defenderReportPath, "Microsoft Defender report")
  const report = readJson(defenderReportPath)
  if (report.format !== "recall-microsoft-defender-scan" ||
      report.version !== 1 ||
      report.exitCode !== 0 ||
      report.installerSha256 !== installerSha256) {
    fail("Microsoft Defender report does not describe the exact accepted installer")
  }
  return report
}

async function main() {
  assertFile(installerPath, "Store installer")
  const installerSha256 = sha256File(installerPath)
  const defender = validateDefenderReport(installerSha256)
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "recall-store-verify-"))

  try {
    const sevenZip = await sevenZipPath()
    const installerRoot = path.join(temporaryDirectory, "installer")
    const payloadRoot = path.join(temporaryDirectory, "payload")
    fs.mkdirSync(installerRoot)
    fs.mkdirSync(payloadRoot)
    run7Zip(sevenZip, ["x", "-bd", "-y", `-o${installerRoot}`, installerPath])

    const installerFiles = walkFiles(installerRoot)
    const applicationArchive = installerFiles.find(filePath =>
      path.basename(filePath).toLowerCase() === "app-64.7z")
    if (!applicationArchive) fail("NSIS payload app-64.7z is missing")
    run7Zip(sevenZip, ["x", "-bd", "-y", `-o${payloadRoot}`, applicationArchive])

    const payloadFiles = walkFiles(payloadRoot)
    const nativeModules = payloadFiles.filter(filePath =>
      path.extname(filePath).toLowerCase() === ".node")
    const nonWindowsNativeModules = nativeModules.filter(filePath =>
      peMachine(filePath) === undefined)
    if (nonWindowsNativeModules.length > 0) {
      fail(`non-Windows native modules were packaged: ${nonWindowsNativeModules.map(
        filePath => normalizeRelative(payloadRoot, filePath)).join(", ")}`)
    }
    const nonX64NativeModules = nativeModules.filter(filePath =>
      peMachine(filePath) !== 0x8664)
    if (nonX64NativeModules.length > 0) {
      fail(`non-x64 Windows native modules were packaged: ${nonX64NativeModules.map(
        filePath => normalizeRelative(payloadRoot, filePath)).join(", ")}`)
    }
    const packagedSqliteModules = nativeModules.filter(filePath =>
      normalizeRelative(payloadRoot, filePath).includes(
        "node_modules/better-sqlite3/prebuilds/"))
    const expectedSqliteModule = packagedSqliteModules.filter(filePath =>
      normalizeRelative(payloadRoot, filePath).endsWith(
        "node_modules/better-sqlite3/prebuilds/win32-x64.node"))
    if (packagedSqliteModules.length !== 1 || expectedSqliteModule.length !== 1) {
      fail(`expected only better-sqlite3/prebuilds/win32-x64.node; found ${
        packagedSqliteModules.map(filePath =>
          normalizeRelative(payloadRoot, filePath)).join(", ") || "none"}`)
    }
    const foreignNativeModules = nativeModules.filter(filePath =>
      /(?:darwin|linux|linuxmusl|arm64|armv7|ia32)/i.test(
        normalizeRelative(payloadRoot, filePath)))
    if (foreignNativeModules.length > 0) {
      fail(`foreign native modules were packaged: ${foreignNativeModules.map(filePath =>
        normalizeRelative(payloadRoot, filePath)).join(", ")}`)
    }

    const uninstaller = installerFiles.find(filePath =>
      /^uninstall .*\.exe$/i.test(path.basename(filePath)))
    if (!uninstaller) fail("embedded NSIS uninstaller is missing")
    const portableExecutables = payloadFiles.filter(filePath =>
      [".exe", ".dll", ".node"].includes(path.extname(filePath).toLowerCase()))
    if (portableExecutables.length === 0) fail("no installed PE files were found")

    const signatureTargets = [
      {
        role: "installer",
        path: path.basename(installerPath),
        absolutePath: installerPath,
      },
      {
        role: "uninstaller",
        path: path.basename(uninstaller),
        absolutePath: uninstaller,
      },
      ...portableExecutables.map(filePath => ({
        role: "application",
        path: normalizeRelative(payloadRoot, filePath),
        absolutePath: filePath,
      })),
    ].sort((left, right) =>
      `${left.role}:${left.path}`.localeCompare(`${right.role}:${right.path}`))
    const signatures = runAuthenticodeAudit(signatureTargets, temporaryDirectory)
    const dependencies = dependencyInventory()

    const inventory = {
      format: "recall-store-installer-inventory",
      version: 1,
      generatedAt: new Date().toISOString(),
      application: {
        name: builderConfig.productName,
        version: packageJson.version,
        appId: builderConfig.appId,
        nsisGuid: builderConfig.nsis.guid,
        architecture: "x64",
        packageType: "offline-nsis-exe",
      },
      installer: {
        fileName: path.basename(installerPath),
        sizeBytes: fs.statSync(installerPath).size,
        sha256: installerSha256,
        immutableDownloadUrl:
          `https://github.com/KleinByte/Recall/releases/download/` +
          `v${packageJson.version}/${path.basename(installerPath)}`,
        silentInstallArguments: ["/S"],
      },
      microsoftDefender: defender,
      nativeModules: nativeModules.map(filePath =>
        normalizeRelative(payloadRoot, filePath)).sort(),
      portableExecutables: signatures,
      dependencies,
      checksumManifest: path.basename(checksumsPath),
    }
    fs.writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`)

    const distributables = [
      installerPath,
      `${installerPath}.blockmap`,
      path.join(path.dirname(installerPath), "latest.yml"),
      defenderReportPath,
      inventoryPath,
    ]
    distributables.forEach(filePath => assertFile(filePath, "release artifact"))
    const checksumLines = distributables
      .map(filePath => `${sha256File(filePath)} *${path.basename(filePath)}`)
      .sort()
    fs.writeFileSync(checksumsPath, `${checksumLines.join("\n")}\n`)

    console.log(
      `Store installer verified: ${signatures.length} trusted and timestamped PE files, ` +
      `${nativeModules.length} x64 native module, ${dependencies.length} runtime dependency licenses.`,
    )
    console.log(`Immutable package URL: ${inventory.installer.immutableDownloadUrl}`)
    console.log(`Inventory: ${inventoryPath}`)
    console.log(`Checksums: ${checksumsPath}`)
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}

module.exports = {
  dependencyInventory,
  sha256File,
}
