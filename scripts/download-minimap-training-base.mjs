/** Download the immutable upstream training checkpoint once into ignored work storage. */

import { createHash } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const destination = resolve(
  repositoryRoot,
  ".minimap-training/checkpoints/upstream-yolo11m-minimap.pt",
)
const temporary = `${destination}.download`
const repository = "boboyes/leagueoflegends-minimap-detection"
const revision = "5c98bdcfa1961a3bb1be57591e7d20d6eb0ac531"
const file = "yolo11m-minimap.pt"
const expectedSha256 = "c247901341e905fd39633ccb7a4ef3133bcb7c8f9375bfda962d13f6bfa3d755"
const url = `https://huggingface.co/${repository}/resolve/${revision}/${file}`

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function existingIsValid() {
  try {
    return sha256(await readFile(destination)) === expectedSha256
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

if (await existingIsValid()) {
  console.log(`Pinned minimap training checkpoint is ready: ${destination}`)
  process.exit(0)
}
if (process.argv.includes("--check")) {
  throw new Error(`Pinned minimap training checkpoint is missing or invalid: ${destination}`)
}

let lastError
let bytes
for (let attempt = 0; attempt < 5; attempt += 1) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    bytes = Buffer.from(await response.arrayBuffer())
    break
  } catch (error) {
    lastError = error
    await new Promise((resolveRetry) => setTimeout(resolveRetry, 500 * 2 ** attempt))
  }
}
if (!bytes) throw lastError
const actualSha256 = sha256(bytes)
if (actualSha256 !== expectedSha256) {
  throw new Error(`Checkpoint checksum mismatch: expected ${expectedSha256}, received ${actualSha256}`)
}

await mkdir(dirname(destination), { recursive: true })
try {
  await writeFile(temporary, bytes)
  await rm(destination, { force: true })
  await rename(temporary, destination)
} finally {
  await rm(temporary, { force: true })
}
console.log(`Downloaded ${Math.round(bytes.length / 1024 / 1024)} MB pinned checkpoint to ${destination}.`)
