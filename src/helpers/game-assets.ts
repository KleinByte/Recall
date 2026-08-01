const DDRAGON = "https://ddragon.leagueoflegends.com"
const COMMUNITY = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global"

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
}

interface DDragonItem {
  name?: string
  description?: string
  image?: { full?: string }
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
  if (!itemId) return "/recall-icon.png"
  return version === "latest"
    ? "/recall-icon.png"
    : `${DDRAGON}/cdn/${version}/img/item/${itemId}.png`
}

export function loadGameAssets(): Promise<GameAssetCatalog> {
  catalogPromise ??= (async () => {
    let version = "latest"
    const items: Record<number, GameAsset> = {}
    const augments: Record<number, GameAsset> = {}
    try {
      const versions = await fetch(`${DDRAGON}/api/versions.json`).then(
        (response) => response.ok ? response.json() as Promise<string[]> : [],
      )
      version = versions[0] ?? version
      const itemData: { data?: Record<string, DDragonItem> } = await fetch(
        `${DDRAGON}/cdn/${version}/data/en_US/item.json`,
      ).then((response) => response.ok
        ? response.json() as Promise<{ data?: Record<string, DDragonItem> }>
        : Promise.resolve({}))
      for (const [id, item] of Object.entries(itemData.data ?? {})) {
        items[Number(id)] = {
          name: item.name ?? `Item ${id}`,
          description: item.description,
          icon: `${DDRAGON}/cdn/${version}/img/item/${item.image?.full ?? `${id}.png`}`,
        }
      }
    } catch {
      // The review remains usable offline and falls back to stable asset URLs.
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
    return { version, items, augments }
  })()
  return catalogPromise
}
