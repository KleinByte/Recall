import { publicAssetUrl } from "./assets"

const DDRAGON = "https://ddragon.leagueoflegends.com"
const COMMUNITY = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global"
const MATCH_HISTORY = "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-match-history/global/default"

export interface GameAsset {
  name: string
  description?: string
  icon: string
  rarity?: string
}

export interface GameAssetCatalog {
  version: string
  items: Record<number, GameAsset>
  augments: Record<number, GameAsset>
  abilities: Record<number, GameAsset[]>
}

interface DDragonItem {
  name?: string
  description?: string
  image?: { full?: string }
}

interface DDragonChampion {
  key?: string
  spells?: Array<{
    name?: string
    description?: string
    image?: { full?: string }
  }>
}

interface CommunityItem {
  id?: number | string
  name?: string
  description?: string
  iconPath?: string
}

interface CommunityAugment {
  id?: number | string
  nameTRA?: string
  name?: string
  descriptionTRA?: string
  description?: string
  iconPath?: string
  augmentSmallIconPath?: string
  rarity?: string
}

let catalogPromise: Promise<GameAssetCatalog> | undefined

export function normalizeAugmentId(value: unknown): number | undefined {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

function communityIcon(path?: string) {
  if (!path) return ""
  const normalized = path.replace(/^\/+/, "").toLowerCase()
  const assetIndex = normalized.indexOf("assets/")
  return `${COMMUNITY}/default/${assetIndex >= 0 ? normalized.slice(assetIndex + 7) : normalized}`
}

export function itemIconUrl(itemId?: number, version = "latest") {
  if (!itemId) return publicAssetUrl("recall-icon.png")
  return version === "latest"
    ? publicAssetUrl("recall-icon.png")
    : `${DDRAGON}/cdn/${version}/img/item/${itemId}.png`
}

/** League-client match-history art for objectives Data Dragon does not expose. */
export function timelineObjectiveIconUrl(
  type: string,
  objective?: string,
  teamId?: number,
) {
  const team = teamId === 200 ? 200 : 100
  const token = (objective ?? "").toUpperCase().replaceAll("_", "")
  if (type === "TURRET_PLATE_DESTROYED") return `${MATCH_HISTORY}/tower-${team}.png`
  if (type === "BUILDING_KILL") {
    if (token.includes("INHIBITOR")) return `${MATCH_HISTORY}/inhibitor-${team}.png`
    if (token.includes("NEXUS")) {
      return `${MATCH_HISTORY}/nexus_building_${team === 100 ? "blue" : "red"}.png`
    }
    return `${MATCH_HISTORY}/tower-${team}.png`
  }
  if (type !== "ELITE_MONSTER_KILL") return undefined
  if (token.includes("BARON")) return `${MATCH_HISTORY}/baron-${team}.png`
  if (token.includes("HERALD")) return `${MATCH_HISTORY}/herald-${team}.png`
  if (token.includes("ELDER")) return `${MATCH_HISTORY}/elder-${team}.png`
  if (token.includes("HORDE") || token.includes("GRUB")) return `${MATCH_HISTORY}/right_icons_grub.png`
  if (token.includes("VILEMAW")) return `${MATCH_HISTORY}/vilemaw-${team}.png`
  if (token.includes("DRAGON")) return `${MATCH_HISTORY}/dragon-${team}.png`
  return undefined
}

/** League-client icons used to keep review feeds visually native to League. */
export const timelineKillIconUrl = () => publicAssetUrl("game-data/ui/timeline-kill.png")
export const aramPoroIconUrl = () => publicAssetUrl("game-data/ui/aram-poro.png")

export function loadGameAssets(): Promise<GameAssetCatalog> {
  catalogPromise ??= (async () => {
    let version = "latest"
    const items: Record<number, GameAsset> = {}
    const augments: Record<number, GameAsset> = {}
    const abilities: Record<number, GameAsset[]> = {}
    try {
      const versions = await fetch(`${DDRAGON}/api/versions.json`).then(
        (response) => response.ok ? response.json() as Promise<string[]> : [],
      )
      version = versions[0] ?? version
      const [itemData, championData] = await Promise.all([
        fetch(`${DDRAGON}/cdn/${version}/data/en_US/item.json`).then((response) => response.ok
          ? response.json() as Promise<{ data?: Record<string, DDragonItem> }>
          : Promise.resolve({} as { data?: Record<string, DDragonItem> })),
        fetch(`${DDRAGON}/cdn/${version}/data/en_US/championFull.json`).then((response) => response.ok
          ? response.json() as Promise<{ data?: Record<string, DDragonChampion> }>
          : Promise.resolve({} as { data?: Record<string, DDragonChampion> })),
      ])
      for (const [id, item] of Object.entries(itemData.data ?? {})) {
        items[Number(id)] = {
          name: item.name ?? `Item ${id}`,
          description: item.description,
          icon: `${DDRAGON}/cdn/${version}/img/item/${item.image?.full ?? `${id}.png`}`,
        }
      }
      for (const champion of Object.values(championData.data ?? {})) {
        const championId = Number(champion.key)
        if (!Number.isSafeInteger(championId) || championId <= 0) continue
        abilities[championId] = (champion.spells ?? []).map((spell, index) => ({
          name: spell.name ?? `Ability ${index + 1}`,
          description: spell.description,
          icon: spell.image?.full
            ? `${DDRAGON}/cdn/${version}/img/spell/${spell.image.full}`
            : publicAssetUrl("recall-icon.png"),
        }))
      }
    } catch {
      // The review remains usable offline and falls back to stable asset URLs.
    }
    try {
      const clientItems = await fetch(
        `${COMMUNITY}/en_gb/v1/items.json`,
      ).then((response) => response.ok ? response.json() as Promise<CommunityItem[]> : [])
      for (const item of clientItems) {
        const itemId = Number(item.id)
        if (!Number.isSafeInteger(itemId) || itemId <= 0 || items[itemId]) continue
        items[itemId] = {
          name: item.name ?? `Item ${itemId}`,
          description: item.description,
          icon: communityIcon(item.iconPath) || publicAssetUrl("recall-icon.png"),
        }
      }
    } catch {
      // Mode-specific items still have readable IDs when the client catalog is offline.
    }
    try {
      const augmentData = await fetch(
        `${COMMUNITY}/en_gb/v1/cherry-augments.json`,
      ).then((response) => response.ok
        ? response.json() as Promise<CommunityAugment[]>
        : [])
      for (const augment of augmentData) {
        const augmentId = normalizeAugmentId(augment.id)
        if (augmentId === undefined) continue
        augments[augmentId] = {
          name: augment.nameTRA ?? augment.name ?? `Augment ${augmentId}`,
          description: augment.descriptionTRA ?? augment.description,
          icon: communityIcon(augment.augmentSmallIconPath ?? augment.iconPath),
          rarity: augment.rarity,
        }
      }
    } catch {
      // IDs and capture completeness still render when the catalog is unavailable.
    }
    return { version, items, augments, abilities }
  })()
  return catalogPromise
}
