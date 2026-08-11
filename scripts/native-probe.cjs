const moduleName = process.argv[2]

if (!moduleName) {
  throw new Error("Native probe requires a module name.")
}

const Database = require(moduleName)
const database = new Database(":memory:")

try {
  const result = database.prepare("SELECT 1 AS healthy").get()
  if (result?.healthy !== 1) {
    throw new Error(`${moduleName} returned an unexpected SQLite result.`)
  }
  console.log(
    `${moduleName} loaded successfully (Node ${process.versions.node}, ABI ${process.versions.modules}).`,
  )
} finally {
  database.close()
}
