import { CHAMPION_CLASSES, type ChampionClass } from "./champion-classes.js"

/** The six Riot class tags shipped by Data Dragon and the LCU catalog. */
export const VALID_CLASSES: ReadonlySet<string> = new Set<ChampionClass>([
  "assassin", "fighter", "mage", "marksman", "support", "tank",
])

/**
 * Multipliers applied to each metric's "excellent" benchmark by the
 * champion's primary Riot class tag. A tank is not expected to match a
 * marksman's damage share, and a marksman is not expected to match a tank's
 * crowd control, so each class is measured against its own ceiling. Classes
 * without an entry keep the base benchmark.
 */
export const CLASS_SCALE: Record<string, Partial<Record<ChampionClass, number>>> = {
  damageShare: { assassin: .9, fighter: .85, tank: .65, support: .55 },
  kdaPace: { fighter: .9, tank: .8 },
  deathRate: { fighter: 1.1, tank: 1.2 },
  goldPace: { tank: .9, support: .7 },
  csPace: { tank: .85, support: .4 },
  objectivePace: { marksman: 1.15, assassin: .9, mage: .8, tank: .75, support: .5 },
  visionPace: { support: 1.25, mage: .85, marksman: .75, assassin: .75 },
  ccPace: { tank: 1.15, fighter: .75, mage: .65, assassin: .45, marksman: .35 },
  allySupport: { support: 1, tank: .5, mage: .5, fighter: .4, assassin: .4, marksman: .4 },
}

export type ClassResolver = (championId: number | undefined) => ChampionClass | undefined

/** Live catalog roles win; the bundled Data Dragon snapshot covers offline. */
export function classResolver(catalogRoles?: ReadonlyMap<number, readonly string[]>): ClassResolver {
  return (championId) => {
    if (championId === undefined) return undefined
    const live = catalogRoles?.get(championId)?.find((role) => VALID_CLASSES.has(role))
    return (live as ChampionClass | undefined) ?? CHAMPION_CLASSES.get(championId)?.[0]
  }
}

const resolveFromSnapshot = classResolver()

/** The champion's primary class from the bundled Data Dragon snapshot. */
export function resolveChampionClass(championId: number | undefined): ChampionClass | undefined {
  return resolveFromSnapshot(championId)
}
