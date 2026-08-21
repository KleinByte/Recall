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

export const DEFAULT_DDRAGON_VERSION = "16.14.1"

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
  const validated = validatedChampionTemplateRoster(roster, templates)
  return validated.length === roster.length ? validated : []
}

/**
 * Keeps every exact participant/template match that is safe to use. Missing
 * portraits remain untracked instead of disabling vision for the entire
 * roster. The detector's global assignment still abstains when two identical
 * portraits are ambiguous.
 */
export function validatedChampionTemplateRoster(
  roster: ChampionRosterTemplateInput[],
  templates: ChampionMarkerTemplate[],
) {
  if (roster.length === 0 || templates.length === 0) return []
  const expected = new Map(roster.map((entry) => [entry.participantKey, entry]))
  if (expected.size !== roster.length) return []
  const seen = new Set<string>()
  const validated: ChampionMarkerTemplate[] = []
  for (const template of templates) {
    const descriptor = expected.get(template.participantKey)
    if (!descriptor || seen.has(template.participantKey) ||
        descriptor.championName !== template.championName ||
        descriptor.team !== template.team || descriptor.isLocal !== template.isLocal ||
        !Number.isSafeInteger(template.width) || template.width <= 0 ||
        !Number.isSafeInteger(template.height) || template.height <= 0 ||
        !(template.rgba instanceof Uint8Array) ||
        template.rgba.length !== template.width * template.height * 4) continue
    seen.add(template.participantKey)
    validated.push(template)
  }
  return validated
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

export interface DataDragonTemplateProviderOptions {
  fetcher?: typeof fetch
  timeoutMs?: number
  fallbackVersion?: string
  onVersionResolved?(version: string): void
}

export class DataDragonTemplateProvider {
  private readonly cache = new Map<string, Promise<RgbaFrame>>()
  private readonly fetcher: typeof fetch
  private readonly timeoutMs: number
  private readonly fallbackVersion: string
  private remoteVersion?: Promise<string>

  constructor(
    private readonly version: () => string | undefined,
    private readonly options: DataDragonTemplateProviderOptions = {},
  ) {
    this.fetcher = options.fetcher ?? fetch
    this.timeoutMs = options.timeoutMs ?? 5_000
    this.fallbackVersion = options.fallbackVersion ?? DEFAULT_DDRAGON_VERSION
  }

  async load(roster: ChampionRosterTemplateInput[]): Promise<ChampionMarkerTemplate[]> {
    if (roster.length === 0) return []
    const version = await this.resolveVersion()
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

  private async resolveVersion() {
    const configured = this.version()?.trim()
    if (configured) return configured
    if (!this.remoteVersion) {
      this.remoteVersion = this.fetchLatestVersion()
        .then((resolved) => {
          this.options.onVersionResolved?.(resolved)
          return resolved
        })
        .catch(() => this.fallbackVersion)
    }
    return this.remoteVersion
  }

  private async fetchLatestVersion() {
    const response = await this.fetcher(
      "https://ddragon.leagueoflegends.com/api/versions.json",
      { signal: AbortSignal.timeout(this.timeoutMs), cache: "no-cache" },
    )
    if (!response.ok) throw new Error(`ddragon_versions_http_${response.status}`)
    const versions = await response.json() as unknown
    const latest = Array.isArray(versions)
      ? versions.find((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
      : undefined
    if (!latest) throw new Error("ddragon_versions_invalid")
    return latest.trim()
  }

  private async fetchIcon(version: string, key: string) {
    const response = await this.fetcher(
      `https://ddragon.leagueoflegends.com/cdn/${encodeURIComponent(version)}/img/champion/${encodeURIComponent(key)}.png`,
      { signal: AbortSignal.timeout(this.timeoutMs) },
    )
    if (!response.ok) throw new Error(`ddragon_icon_http_${response.status}`)
    const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()))

    if (image.isEmpty()) throw new Error("ddragon_icon_decode_failed")
    const size = image.getSize()
    return bgraFrame(image.toBitmap(), size.width, size.height)
  }
}
