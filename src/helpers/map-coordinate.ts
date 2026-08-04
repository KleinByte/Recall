export type ReviewMapId = 11 | 12 | 453

interface MapCoordinateDomain {
  min: { x: number; y: number }
  max: { x: number; y: number }
}

/**
 * World-coordinate domains used by Riot's post-game map chart. Classic Rift
 * keeps Summoner's Rift's coordinate envelope, but has its own map artwork.
 */
export const REVIEW_MAP_DOMAINS: Record<ReviewMapId, MapCoordinateDomain> = {
  11: { min: { x: 0, y: 0 }, max: { x: 14_820, y: 14_881 } },
  12: { min: { x: -28, y: -19 }, max: { x: 12_849, y: 12_858 } },
  453: { min: { x: 0, y: 0 }, max: { x: 14_820, y: 14_881 } },
}

export function reviewMapId(modeFamily: string): ReviewMapId {
  if (modeFamily === "aram") return 12
  if (modeFamily === "classic") return 453
  return 11
}

function normalize(coordinate: number, minimum: number, maximum: number) {
  return Math.max(0, Math.min(1, (coordinate - minimum) / (maximum - minimum)))
}

export function mapPositionPercent(
  position: { x: number; y: number },
  mapId: ReviewMapId,
) {
  const domain = REVIEW_MAP_DOMAINS[mapId]
  return {
    left: normalize(position.x, domain.min.x, domain.max.x) * 100,
    top: (1 - normalize(position.y, domain.min.y, domain.max.y)) * 100,
  }
}
