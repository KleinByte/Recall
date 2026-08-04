import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const DDRAGON = "https://ddragon.leagueoflegends.com"
const CLASSIC_MAP_ID = "453"
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const itemDirectory = resolve(root, "public/items")
const manifestPath = resolve(root, "src/data/classic-items.json")

async function json(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  return response.json()
}

async function dataDragonVersion() {
  const requested = process.argv[2]
  if (requested) return requested
  const versions = await json(`${DDRAGON}/api/versions.json`)
  if (!Array.isArray(versions) || typeof versions[0] !== "string") {
    throw new Error("Data Dragon did not return a current version")
  }
  return versions[0]
}

async function download(item, version) {
  const image = item.data.image?.full ?? `${item.id}.png`
  const url = `${DDRAGON}/cdn/${version}/img/item/${encodeURIComponent(image)}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  // A PNG signature catches CDN error documents that happen to return 200.
  if (
    bytes.length < 8 ||
    bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 || bytes[4] !== 0x0d || bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a || bytes[7] !== 0x0a
  ) {
    throw new Error(`Data Dragon returned a non-PNG asset for item ${item.id}`)
  }
  await writeFile(resolve(itemDirectory, `${item.id}.png`), bytes)
}

const version = await dataDragonVersion()
const source = `${DDRAGON}/cdn/${version}/data/en_US/item.json`
const payload = await json(source)
const items = Object.entries(payload.data ?? {})
  .filter(([, item]) => item.maps?.[CLASSIC_MAP_ID] === true)
  .map(([id, data]) => ({ id: Number(id), data }))
  .filter((item) => Number.isSafeInteger(item.id) && item.id > 0)
  .sort((left, right) => left.id - right.id)

if (items.length === 0) {
  throw new Error(`Data Dragon ${version} did not contain League Classic items`)
}

await mkdir(itemDirectory, { recursive: true })
for (let index = 0; index < items.length; index += 12) {
  await Promise.all(items.slice(index, index + 12).map((item) => download(item, version)))
}

const manifest = {
  version,
  source,
  mapId: Number(CLASSIC_MAP_ID),
  items: items.map((item) => ({
    id: item.id,
    name: item.data.name ?? `Item ${item.id}`,
  })),
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Saved ${items.length} League Classic item icons from Data Dragon ${version}.`)
