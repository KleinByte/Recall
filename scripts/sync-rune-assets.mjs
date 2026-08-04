import { mkdir, readFile, writeFile } from "node:fs/promises"
import { request as httpsRequest } from "node:https"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default"
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const runeDirectory = resolve(root, "public/game-data/runes")
const spellDirectory = resolve(root, "public/game-data/spells")
const styleDirectory = resolve(root, "public/game-data/rune-styles")
let lcu
try {
  const lockfile = await readFile("C:/Riot Games/League of Legends/lockfile", "utf8")
  const [, , port, password, protocol] = lockfile.trim().split(":")
  lcu = { port: Number(port), password, protocol }
} catch {
  lcu = undefined
}

function fromLcu(path) {
  if (!lcu) return Promise.reject(new Error("League Client is not available"))
  return new Promise((resolve, reject) => {
    const request = httpsRequest({
      hostname: "127.0.0.1",
      port: lcu.port,
      path,
      rejectUnauthorized: false,
      headers: { Authorization: `Basic ${Buffer.from(`riot:${lcu.password}`).toString("base64")}` },
    }, (response) => {
      const chunks = []
      response.on("data", (chunk) => chunks.push(chunk))
      response.on("end", () => response.statusCode >= 200 && response.statusCode < 300
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`LCU ${response.statusCode}: ${path}`)))
    })
    request.on("error", reject)
    request.end()
  })
}

async function request(url) {
  const assetPath = new URL(url).pathname.replace(
    /^\/latest\/plugins\/rcp-be-lol-game-data\/global\/default/i,
    "/lol-game-data/assets",
  )
  if (lcu) {
    try {
      return await fromLcu(assetPath)
    } catch {
      // A stale lockfile can outlive the client's loopback listener.
      lcu = undefined
    }
  }
  let error
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (caught) {
      error = caught
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
    }
  }
  throw error
}

const json = async (path) => JSON.parse((await request(`${ROOT}/${path}`)).toString("utf8"))
const assetUrl = (path) => `${ROOT}/${path.replace(/^\/lol-game-data\/assets\//i, "").toLowerCase()}`

async function download(path, target) {
  if (!path) return
  const bytes = new Uint8Array(await request(assetUrl(path)))
  if (bytes.length < 32) throw new Error(`Empty asset: ${path}`)
  await writeFile(target, bytes)
}

const [perks, stylePayload, classicRunes, spells] = await Promise.all([
  json("v1/perks.json"),
  json("v1/perkstyles.json"),
  json("v1/jade-perks.json"),
  json("v1/summoner-spells.json"),
])
const styles = stylePayload.styles ?? []

await Promise.all([runeDirectory, spellDirectory, styleDirectory].map((dir) => mkdir(dir, { recursive: true })))

const runeCatalog = {
  source: ROOT,
  modern: perks.map((perk) => ({
    id: perk.id,
    name: perk.name,
    shortDesc: perk.shortDesc,
    longDesc: perk.longDesc,
    endOfGameStatDescs: perk.endOfGameStatDescs ?? [],
  })),
  classic: classicRunes.map((perk) => ({
    id: perk.id,
    name: perk.title || perk.statName,
    type: perk.type,
    statName: perk.statName,
    tooltip: perk.tooltip,
    amount: perk.amount,
    totalAmount: perk.totalAmount,
    isPerLevel: perk.isPerLevel,
  })),
  styles: styles.map((style) => ({
    id: style.id,
    name: style.name,
    tooltip: style.tooltip,
    slots: style.slots?.map((slot) => ({ type: slot.type, label: slot.slotLabel, perks: slot.perks })) ?? [],
  })),
}
const spellCatalog = spells.map((spell) => ({ id: spell.id, name: spell.name }))

const jobs = [
  ...perks.map((perk) => download(perk.iconPath, resolve(runeDirectory, `${perk.id}.png`))),
  ...classicRunes.map((perk) => download(perk.iconPath, resolve(runeDirectory, `${perk.id}.png`))),
  ...spells.map((spell) => download(spell.iconPath, resolve(spellDirectory, `${spell.id}.png`))),
  ...styles.map((style) => download(style.iconPath, resolve(styleDirectory, `${style.id}.png`))),
]
for (let index = 0; index < jobs.length; index += 4) await Promise.all(jobs.slice(index, index + 4))

await writeFile(resolve(root, "src/data/rune-catalog.json"), `${JSON.stringify(runeCatalog, null, 2)}\n`)
await writeFile(resolve(root, "src/data/spell-catalog.json"), `${JSON.stringify(spellCatalog, null, 2)}\n`)
console.log(`Saved ${perks.length} modern runes, ${classicRunes.length} Classic runes, ${styles.length} styles, and ${spells.length} spells.`)
