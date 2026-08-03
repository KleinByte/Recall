/**
 * Regenerates electron/main/matches/champion-classes.ts from the latest
 * Riot Data Dragon champion data. Run with: pnpm sync:champion-classes
 */

import { writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const target = resolve(root, "electron/main/matches/champion-classes.ts")

const versions = await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json()
const patch = versions[0]
const catalog = await (
  await fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/champion.json`)
).json()

const champions = Object.values(catalog.data)
  .map((champion) => ({
    id: Number(champion.key),
    name: champion.name,
    tags: champion.tags.map((tag) => tag.toLowerCase()),
  }))
  .sort((left, right) => left.id - right.id)

const rows = champions
  .map(({ id, name, tags }) => `  [${id}, [${tags.map((tag) => `"${tag}"`).join(", ")}]], // ${name}`)
  .join("\n")

const body = `/**
 * Champion class tags bundled from Riot Data Dragon patch ${patch}.
 *
 * Used as the offline fallback for champion-class-aware RVI scaling. The
 * live LCU champion catalog overrides these entries whenever it is available,
 * so a new champion is covered as soon as the client reports it.
 * Regenerate with: pnpm sync:champion-classes
 */

export type ChampionClass = "assassin" | "fighter" | "mage" | "marksman" | "support" | "tank"

/** Riot lists the primary class first. */
export const CHAMPION_CLASSES: ReadonlyMap<number, readonly ChampionClass[]> = new Map([
${rows}
])
`

await writeFile(target, body, "utf8")
console.log(`Wrote ${champions.length} champions from patch ${patch} to ${target}`)
