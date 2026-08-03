const fs = require("node:fs")
const path = require("node:path")
const { extractFile, listPackage } = require("@electron/asar")

const REQUIRED_ARCHIVE_FILES = [
  "node_modules/better-sqlite3/package.json",
  "node_modules/ws/package.json",
]
const REQUIRED_UNPACKED_FILES = [
  "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
]
const MODULES_THAT_MUST_BE_BUNDLED = [
  "builder-util-runtime",
  "electron-store",
  "electron-updater",
]

module.exports = async context => {
  const archivePath = path.join(context.appOutDir, "resources", "app.asar")
  const archiveFiles = new Set(
    listPackage(archivePath, { isPack: false }).map(filePath =>
      filePath.replace(/^[/\\]+/, "").replaceAll("\\", "/")
    )
  )
  const missingArchiveFiles = REQUIRED_ARCHIVE_FILES.filter(
    filePath => !archiveFiles.has(filePath)
  )
  const unpackedRoot = path.join(
    context.appOutDir,
    "resources",
    "app.asar.unpacked"
  )
  const missingUnpackedFiles = REQUIRED_UNPACKED_FILES.filter(
    filePath => !fs.existsSync(path.join(unpackedRoot, filePath))
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
    missingUnpackedFiles.length > 0 ||
    externalModules.length > 0
  ) {
    throw new Error(
      [
        "Packaged runtime is incomplete.",
        missingArchiveFiles.length > 0
          ? `Missing from app.asar: ${missingArchiveFiles.join(", ")}.`
          : "",
        missingUnpackedFiles.length > 0
          ? `Missing unpacked native files: ${missingUnpackedFiles.join(", ")}.`
          : "",
        externalModules.length > 0
          ? `Main-process modules were not bundled: ${externalModules.join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    )
  }

  console.log(
    `Packaged runtime verified: ${REQUIRED_ARCHIVE_FILES.length} external modules, ${REQUIRED_UNPACKED_FILES.length} native binary, and bundled main-process dependencies.`
  )
}
