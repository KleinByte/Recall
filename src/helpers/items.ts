import catalog from "../data/items.json"

interface ItemCatalogEntry {
  name: string
}

const items = catalog as Record<string, ItemCatalogEntry>

export interface ItemAsset {
  name: string
  iconUrl: string
  fallback: boolean
}

export function itemAsset(itemId: number): ItemAsset {
  const item = items[String(itemId)]
  if (item) {
    return {
      name: item.name,
      iconUrl: `/items/${itemId}.png`,
      fallback: false,
    }
  }

  return {
    name: `Item ${itemId}`,
    iconUrl: "/recall-icon.png",
    fallback: true,
  }
}