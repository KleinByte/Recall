import { app, nativeImage } from "electron"
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { ChampionVisionTeam, RgbaFrame } from "../../../src/shared/minimap/contracts.js"
import {
  createChampionMarkerTemplate,
  type ChampionMarkerTemplate,
} from "./champion-marker-detector.js"
import { championAssetKey } from "./champion-asset-key.js"

export { championAssetKey } from "./champion-asset-key.js"

export interface ChampionRosterTemplateInput {
  participantKey: string
  championName: string
  team: ChampionVisionTeam
  isLocal: boolean
}

interface ChampionPortraitManifestEntry {
  id: number
  assetKey: string
  name: string
  file: string
  bytes: number
  sha256: string
}

interface ChampionPortraitManifest {
  schemaVersion: number
  patch: string
  championCount: number
  champions: ChampionPortraitManifestEntry[]
}

export function completeChampionTemplateRoster(
  roster: ChampionRosterTemplateInput[],
  templates: ChampionMarkerTemplate[],
) {
  const validated = validatedChampionTemplateRoster(roster, templates)
  return validated.length === roster.length ? validated : []
}

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
  return { width, height, data, capturedMonotonicMs: 0, frameSequence: 0 }
}

function decodePortrait(bytes: Buffer) {
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) throw new Error("bundled_portrait_decode_failed")
  const size = image.getSize()
  return bgraFrame(image.toBitmap(), size.width, size.height)
}

export function defaultChampionPortraitDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "champion-portraits")
    : path.join(app.getAppPath(), "resources", "champion-portraits")
}

export interface DataDragonTemplateProviderOptions {
  directory?: string
  readFile?: typeof readFile
  decode?: (bytes: Buffer) => RgbaFrame
}

/**
 * Loads the release-bundled Data Dragon portrait bank from disk. The legacy
 * class name is retained to keep the integration boundary stable; this class
 * deliberately contains no network code.
 */
export class DataDragonTemplateProvider {
  private readonly cache = new Map<string, Promise<RgbaFrame>>()
  private manifest?: Promise<ChampionPortraitManifest>
  private readonly directory?: string
  private readonly read: typeof readFile
  private readonly decode: (bytes: Buffer) => RgbaFrame

  constructor(options: DataDragonTemplateProviderOptions = {}) {
    this.directory = options.directory
    this.read = options.readFile ?? readFile
    this.decode = options.decode ?? decodePortrait
  }

  async load(roster: ChampionRosterTemplateInput[]): Promise<ChampionMarkerTemplate[]> {
    if (roster.length === 0) return []
    const directory = this.directory ?? defaultChampionPortraitDirectory()
    const manifest = await this.loadManifest(directory)
    const byName = new Map(manifest.champions.map((entry) => [entry.name.toLowerCase(), entry]))
    const byKey = new Map(manifest.champions.map((entry) => [entry.assetKey.toLowerCase(), entry]))
    const templates = await Promise.all(roster.map(async (entry) => {
      const portrait = byName.get(entry.championName.toLowerCase()) ??
        byKey.get(championAssetKey(entry.championName).toLowerCase())
      if (!portrait || path.basename(portrait.file) !== portrait.file ||
          !/^[A-Za-z0-9]+\.png$/.test(portrait.file)) return undefined
      let pending = this.cache.get(portrait.file)
      if (!pending) {
        pending = this.read(path.join(directory, portrait.file))
          .then((bytes) => this.decode(Buffer.from(bytes)))
        this.cache.set(portrait.file, pending)
      }
      try {
        return createChampionMarkerTemplate(entry, await pending)
      } catch {
        this.cache.delete(portrait.file)
        return undefined
      }
    }))
    return templates.filter((entry): entry is ChampionMarkerTemplate => Boolean(entry))
  }

  private loadManifest(directory: string) {
    if (!this.manifest) {
      this.manifest = this.read(path.join(directory, "manifest.json"), "utf8")
        .then((content) => {
          const manifest = JSON.parse(String(content)) as ChampionPortraitManifest
          if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.champions) ||
              manifest.championCount !== manifest.champions.length ||
              manifest.championCount < 150) {
            throw new Error("bundled_portrait_manifest_invalid")
          }
          return manifest
        })
    }
    return this.manifest
  }
}
