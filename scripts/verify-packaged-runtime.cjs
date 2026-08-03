const path = require("node:path")
const { listPackage } = require("@electron/asar")

const REQUIRED_RUNTIME_FILES = [
  "node_modules/ajv/package.json",
  "node_modules/env-paths/package.json",
]

module.exports = async context => {
  const archivePath = path.join(context.appOutDir, "resources", "app.asar")
  const archiveFiles = new Set(
    listPackage(archivePath, { isPack: false }).map(filePath =>
      filePath.replace(/^[/\\]+/, "").replaceAll("\\", "/")
    )
  )
  const missingFiles = REQUIRED_RUNTIME_FILES.filter(
    filePath => !archiveFiles.has(filePath)
  )

  if (missingFiles.length > 0) {
    throw new Error(
      `Packaged runtime is incomplete. Missing from app.asar: ${missingFiles.join(", ")}`
    )
  }
}
