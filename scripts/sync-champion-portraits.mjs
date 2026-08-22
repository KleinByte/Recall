/**
 * Downloads the complete Data Dragon champion portrait catalog for offline
 * minimap vision. Runtime code never contacts Data Dragon.
 *
 * Run with: pnpm sync:champion-portraits
 */

import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const targetDirectory = resolve(root, "resources/champion-portraits")
const versionsUrl = "https://ddragon.leagueoflegends.com/api/versions.json"
const checkOnly = process.argv.includes("--check")

async function fetchBytes(url) {
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      await new Promise((resolveRetry) => setTimeout(resolveRetry, 400 * 2 ** attempt))
    }
  }
  throw lastError
}

const versions = JSON.parse((await fetchBytes(versionsUrl)).toString("utf8"))
const patch = Array.isArray(versions) ? versions.find((entry) => typeof entry === "string") : undefined
if (!patch) throw new Error("Data Dragon returned no usable patch version")

const catalogUrl = `https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/champion.json`
const catalog = JSON.parse((await fetchBytes(catalogUrl)).toString("utf8"))
const champions = Object.values(catalog.data ?? {})
  .map((champion) => ({
    id: Number(champion.key),
    assetKey: String(champion.id),
    name: String(champion.name),
    file: String(champion.image?.full ?? `${champion.id}.png`),
  }))
  .sort((left, right) => left.id - right.id)
if (champions.length < 150) throw new Error(`Data Dragon catalog is incomplete (${champions.length} champions)`)

if (checkOnly) {
  const local = JSON.parse(await readFile(resolve(targetDirectory, "manifest.json"), "utf8"))
  const localKeys = (local.champions ?? []).map((champion) => String(champion.assetKey)).sort()
  const remoteKeys = champions.map((champion) => champion.assetKey).sort()
  const localSet = new Set(localKeys)
  const remoteSet = new Set(remoteKeys)
  const added = remoteKeys.filter((key) => !localSet.has(key))
  const removed = localKeys.filter((key) => !remoteSet.has(key))
  if (added.length > 0 || removed.length > 0) {
    throw new Error(
      `Data Dragon ${patch} differs from local ${local.patch}: ` +
      `added=[${added.join(", ")}], removed=[${removed.join(", ")}]. ` +
      "Run pnpm sync:champion-portraits and pnpm sync:minimap-training-roster.",
    )
  }
  console.log(
    `Local champion portraits cover Data Dragon ${patch} (${remoteKeys.length} champions); ` +
    `no downloads were performed.`,
  )
  process.exit(0)
}

await mkdir(targetDirectory, { recursive: true })
const entries = []
for (let index = 0; index < champions.length; index += 4) {
  const batch = champions.slice(index, index + 4)
  entries.push(...await Promise.all(batch.map(async (champion) => {
    if (!/^[A-Za-z0-9]+\.png$/.test(champion.file)) {
      throw new Error(`Unsafe champion portrait filename: ${champion.file}`)
    }
    const url = `https://ddragon.leagueoflegends.com/cdn/${patch}/img/champion/${champion.file}`
    const bytes = await fetchBytes(url)
    if (bytes.length < 256 || !bytes.subarray(1, 4).equals(Buffer.from("PNG"))) {
      throw new Error(`Invalid champion portrait: ${champion.file}`)
    }
    await writeFile(resolve(targetDirectory, champion.file), bytes)
    return {
      ...champion,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }
  })))
}

const retainedFiles = new Set(["manifest.json", ...entries.map((entry) => entry.file)])
for (const file of await readdir(targetDirectory)) {
  if (!retainedFiles.has(file) && file.toLowerCase().endsWith(".png")) {
    await rm(resolve(targetDirectory, file))
  }
}

const manifest = {
  schemaVersion: 1,
  patch,
  locale: "en_US",
  source: `https://ddragon.leagueoflegends.com/cdn/${patch}`,
  championCount: entries.length,
  champions: entries,
}
await writeFile(
  resolve(targetDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
)
console.log(`Saved ${entries.length} champion portraits from Data Dragon ${patch}.`)
