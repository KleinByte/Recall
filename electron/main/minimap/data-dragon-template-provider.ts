import { nativeImage } from "electron"
import type { ChampionVisionTeam, RgbaFrame } from "../../../src/shared/minimap/contracts.js"
import {
  createChampionMarkerTemplate,
  type ChampionMarkerTemplate,
} from "./champion-marker-detector.js"

export interface ChampionRosterTemplateInput {
  participantKey: string
  championName: string
  team: ChampionVisionTeam
  isLocal: boolean
}

const SPECIAL_ASSET_KEYS: Record<string, string> = {
  "Bel'Veth": "Belveth",
  "Cho'Gath": "Chogath",
  "Dr. Mundo": "DrMundo",
  "Jarvan IV": "JarvanIV",
  "Kai'Sa": "Kaisa",
  "Kha'Zix": "Khazix",
  "Kog'Maw": "KogMaw",
  "K'Sante": "KSante",
  "LeBlanc": "Leblanc",
  "Lee Sin": "LeeSin",
  "Master Yi": "MasterYi",
  "Miss Fortune": "MissFortune",
  "Nunu & Willump": "Nunu",
  "Renata Glasc": "Renata",
  "Rek'Sai": "RekSai",
  "Tahm Kench": "TahmKench",
  "Twisted Fate": "TwistedFate",
  "Vel'Koz": "Velkoz",
  "Wukong": "MonkeyKing",
  "Xin Zhao": "XinZhao",
}

export function championAssetKey(championName: string) {
  return SPECIAL_ASSET_KEYS[championName] ?? championName.replace(/[^A-Za-z0-9]/g, "")
}

/**
 * Returns a usable template set only when every requested participant has one
 * exact identity match. A partial roster must never make the remaining
 * champions compete for the wrong identities.
 */
export function completeChampionTemplateRoster(
  roster: ChampionRosterTemplateInput[],
  templates: ChampionMarkerTemplate[],
) {
  if (roster.length === 0 || templates.length !== roster.length) return []
  const expected = new Map(roster.map((entry) => [entry.participantKey, entry]))
  if (expected.size !== roster.length) return []
  const seen = new Set<string>()
  for (const template of templates) {
    const descriptor = expected.get(template.participantKey)
    if (!descriptor || seen.has(template.participantKey) ||
        descriptor.championName !== template.championName ||
        descriptor.team !== template.team ||
        descriptor.isLocal !== template.isLocal) return []
    seen.add(template.participantKey)
  }
  return seen.size === expected.size ? [...templates] : []
}

function bgraFrame(bitmap: Buffer, width: number, height: number): RgbaFrame {
  const data = new Uint8Array(bitmap.length)
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    data[offset] = bitmap[offset + 2]
    data[offset + 1] = bitmap[offset + 1]
    data[offset + 2] = bitmap[offset]
    data[offset + 3] = bitmap[offset + 3]
  }
  return {
    width,
    height,
    data,
    capturedMonotonicMs: 0,
    frameSequence: 0,
  }
}

export class DataDragonTemplateProvider {
  private readonly cache = new Map<string, Promise<RgbaFrame>>()

  constructor(private readonly version: () => string | undefined) {}

  async load(roster: ChampionRosterTemplateInput[]): Promise<ChampionMarkerTemplate[]> {
    const version = this.version()
    if (!version) return []
    const templates = await Promise.all(roster.map(async (entry) => {
      const key = championAssetKey(entry.championName)
      const cacheKey = `${version}:${key}`
      let pending = this.cache.get(cacheKey)
      if (!pending) {
        pending = this.fetchIcon(version, key)
        this.cache.set(cacheKey, pending)
      }
      try {
        const frame = await pending
        return createChampionMarkerTemplate(entry, frame)
      } catch {
        this.cache.delete(cacheKey)
        return undefined
      }
    }))
    return templates.filter((entry): entry is ChampionMarkerTemplate => Boolean(entry))
  }

  private async fetchIcon(version: string, key: string) {
    const response = await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${encodeURIComponent(version)}/img/champion/${encodeURIComponent(key)}.png`,
      { signal: AbortSignal.timeout(5_000) },
    )
    if (!response.ok) throw new Error(`ddragon_icon_http_${response.status}`)
    const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()))
      .resize({ width: 24, height: 24, quality: "good" })
    if (image.isEmpty()) throw new Error("ddragon_icon_decode_failed")
    const size = image.getSize()
    return bgraFrame(image.toBitmap(), size.width, size.height)
  }
}
