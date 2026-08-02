import catalog from "../data/items.json"
import classic from "../data/classic-items.json"
import { publicAssetUrl } from "./assets"

interface ItemCatalogEntry {
  name: string
}

const items = catalog as Record<string, ItemCatalogEntry>
const classicItems = new Map(
  classic.items.map((item) => [String(item.id), { name: item.name }]),
)

export interface ItemAsset {
  name: string
  iconUrl: string
  fallback: boolean
}

export function itemAsset(itemId: number): ItemAsset {
  const item = items[String(itemId)] ?? classicItems.get(String(itemId))
  if (item) {
    return {
      name: item.name,
      iconUrl: publicAssetUrl(`items/${itemId}.png`),
      fallback: false,
    }
  }

  return {
    name: `Item ${itemId}`,
    iconUrl: publicAssetUrl("recall-icon.png"),
    fallback: true,
  }
}
