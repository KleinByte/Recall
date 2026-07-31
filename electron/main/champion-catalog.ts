export interface ChampionCatalogEntry {
  id: number
  alias: string
  name: string
  roles: string[]
  isVisibleInClient: boolean
}

function champion(value: unknown): ChampionCatalogEntry | undefined {
  if (!value || typeof value !== "object") return undefined

  const entry = value as Partial<ChampionCatalogEntry>
  if (!Number.isInteger(entry.id) || (entry.id ?? 0) <= 0) return undefined
  if (typeof entry.name !== "string" || entry.name.trim() === "") return undefined

  return {
    id: entry.id!,
    alias: typeof entry.alias === "string" ? entry.alias : "",
    name: entry.name.trim(),
    roles: Array.isArray(entry.roles)
      ? entry.roles.filter((role): role is string => typeof role === "string")
      : [],
    isVisibleInClient: entry.isVisibleInClient !== false,
  }
}

/**
 * Produces a durable union of every valid champion catalog Recall has seen.
 * New metadata wins, but a partial or temporarily smaller client response can
 * never erase names that were already known.
 */
export function mergeChampionCatalog(
  stored: unknown,
  fetched: unknown = [],
): ChampionCatalogEntry[] {
  const merged = new Map<number, ChampionCatalogEntry>()

  for (const source of [stored, fetched]) {
    if (!Array.isArray(source)) continue
    for (const value of source) {
      const entry = champion(value)
      if (entry) merged.set(entry.id, entry)
    }
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
}
