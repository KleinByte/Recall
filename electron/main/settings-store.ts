import {
  validateSkillViewPreferences,
  type SkillViewPreferences,
} from "../../src/shared/skill-preferences.js"

export interface UiSettings {
  isColoredWhenDone: boolean
  showChampionNames: boolean
  sidebarCollapsed: boolean
}

export interface TempoOverlayPosition {
  x: number
  y: number
}

export type RecommendationObjective =
  | "best_overall"
  | "recent_form"
  | "challenges"
  | "practice"
  | "most_reliable"

export interface SettingsValues {
  settings: UiSettings
  "recommendation-objective": RecommendationObjective
  "pinned-challenges": number[]
  "display-timezone": string
  "last-seen-patch-notes-version": string
  "launch-at-login": boolean
  "minimap-telemetry-enabled": boolean
  "minimap-vision-debug-enabled": boolean
  "minimap-vision-overlay-enabled": boolean
  "tempo-overlay-position": TempoOverlayPosition
  "minimap-vision-overlay-position": TempoOverlayPosition
  "last-puuid": string
  "riot-api-key-encrypted": string
  "champion-catalog": unknown[]
  "ddragon-version": string
  "aram-stats": Record<string, unknown>
  "last-daily-backup": string
  "collection-mode": "enabled" | "disabled_after_clear"
  "skill-view-preferences": SkillViewPreferences
}

export type SettingsKey = keyof SettingsValues

export interface StoreLike {
  get(key: string): unknown
  set(key: string, value: unknown): unknown
  delete(key: string): unknown
}

interface RegistryEntry<T> {
  class: "user_preference" | "machine_preference" | "identity_pointer" | "secret" |
    "internal_rollback" | "rebuildable_cache" | "maintenance"
  rendererRead: boolean
  rendererWrite: boolean
  fullBackup: boolean
  validate(value: unknown): T | undefined
}

const exactObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const uiSettings = (value: unknown): UiSettings | undefined => {
  let parsed = value
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed) } catch { return undefined }
  }
  if (!exactObject(parsed) || Object.keys(parsed).some((key) =>
    !["isColoredWhenDone", "showChampionNames", "sidebarCollapsed"].includes(key))) return undefined
  if (typeof parsed.isColoredWhenDone !== "boolean" ||
      typeof parsed.showChampionNames !== "boolean" ||
      typeof parsed.sidebarCollapsed !== "boolean") return undefined
  return {
    isColoredWhenDone: parsed.isColoredWhenDone,
    showChampionNames: parsed.showChampionNames,
    sidebarCollapsed: parsed.sidebarCollapsed,
  }
}

const asciiVersion = (value: unknown): string | undefined =>
  typeof value === "string" && value.length >= 1 && value.length <= 64 &&
  /^[A-Za-z0-9_.:+-]+$/.test(value) ? value : undefined

const opaquePuuid = (value: unknown): string | undefined =>
  typeof value === "string" && value.length >= 1 && value.length <= 128 &&
  /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined

const timezone = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return undefined
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone
      ? value
      : undefined
  } catch {
    return undefined
  }
}

const parsedRecord = (value: unknown): Record<string, unknown> | undefined => {
  let parsed = value
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed) } catch { return undefined }
  }
  return exactObject(parsed) && JSON.stringify(parsed).length <= 5_000_000 ? parsed : undefined
}

const tempoOverlayPosition = (value: unknown): TempoOverlayPosition | undefined => {
  if (!exactObject(value) || Object.keys(value).some((key) => !["x", "y"].includes(key))) {
    return undefined
  }
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return undefined
  const x = Math.round(value.x as number)
  const y = Math.round(value.y as number)
  if (Math.abs(x) > 100_000 || Math.abs(y) > 100_000) return undefined
  return { x, y }
}

export const SETTINGS_REGISTRY: { [K in SettingsKey]: RegistryEntry<SettingsValues[K]> } = {
  settings: {
    class: "user_preference", rendererRead: true, rendererWrite: true, fullBackup: true,
    validate: uiSettings,
  },
  "recommendation-objective": {
    class: "user_preference", rendererRead: true, rendererWrite: true, fullBackup: true,
    validate: (value) => typeof value === "string" && [
      "best_overall", "recent_form", "challenges", "practice", "most_reliable",
    ].includes(value) ? value as RecommendationObjective : undefined,
  },
  "skill-view-preferences": {
    class: "user_preference", rendererRead: true, rendererWrite: true, fullBackup: true,
    validate: validateSkillViewPreferences,
  },
  "pinned-challenges": {
    class: "user_preference", rendererRead: false, rendererWrite: false, fullBackup: true,
    validate: (value) => {
      if (!Array.isArray(value) || value.length > 500 || value.some((id) =>
        !Number.isSafeInteger(id) || (id as number) <= 0)) return undefined
      return [...new Set(value as number[])].sort((a, b) => a - b)
    },
  },
  "display-timezone": {
    class: "user_preference", rendererRead: true, rendererWrite: true, fullBackup: true,
    validate: timezone,
  },
  "last-seen-patch-notes-version": {
    class: "user_preference", rendererRead: true, rendererWrite: true, fullBackup: true,
    validate: asciiVersion,
  },
  "launch-at-login": {
    class: "machine_preference", rendererRead: true, rendererWrite: true, fullBackup: false,
    validate: (value) => typeof value === "boolean" ? value : undefined,
  },
  "minimap-telemetry-enabled": {
    class: "machine_preference", rendererRead: true, rendererWrite: true, fullBackup: false,
    validate: (value) => typeof value === "boolean" ? value : undefined,
  },
  "minimap-vision-debug-enabled": {
    class: "machine_preference", rendererRead: true, rendererWrite: true, fullBackup: false,
    validate: (value) => typeof value === "boolean" ? value : undefined,
  },
  "minimap-vision-overlay-enabled": {
    class: "machine_preference", rendererRead: true, rendererWrite: true,
    fullBackup: false,
    validate: (value) => typeof value === "boolean" ? value : undefined,
  },
  "tempo-overlay-position": {
    class: "machine_preference", rendererRead: false, rendererWrite: false, fullBackup: false,
    validate: tempoOverlayPosition,
  },
  "minimap-vision-overlay-position": {
    class: "machine_preference", rendererRead: false, rendererWrite: false,
    fullBackup: false,
    validate: tempoOverlayPosition,
  },
  "last-puuid": {
    class: "identity_pointer", rendererRead: false, rendererWrite: false, fullBackup: false,
    validate: opaquePuuid,
  },
  "riot-api-key-encrypted": {
    class: "secret", rendererRead: false, rendererWrite: false, fullBackup: false,
    validate: (value) => typeof value === "string" && value.length > 0 ? value : undefined,
  },
  "champion-catalog": {
    class: "rebuildable_cache", rendererRead: false, rendererWrite: false, fullBackup: false,
    validate: (value) => Array.isArray(value) && value.length <= 5_000 ? value : undefined,
  },
  "ddragon-version": {
    class: "rebuildable_cache", rendererRead: false, rendererWrite: false, fullBackup: false,
    validate: asciiVersion,
  },
  "aram-stats": {
    class: "rebuildable_cache", rendererRead: false, rendererWrite: false, fullBackup: false,
    validate: parsedRecord,
  },
  "last-daily-backup": {
    class: "maintenance", rendererRead: false, rendererWrite: false, fullBackup: false,
    validate: (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : undefined,
  },
  "collection-mode": {
    class: "maintenance", rendererRead: false, rendererWrite: false, fullBackup: false,
    validate: (value) => value === "enabled" || value === "disabled_after_clear" ? value : undefined,
  },
}

export class SettingsStore {
  constructor(private readonly store: StoreLike) {}

  getMain<K extends SettingsKey>(key: K): SettingsValues[K] | undefined {
    const raw = this.store.get(key)
    if (raw === undefined) return undefined
    const value = SETTINGS_REGISTRY[key].validate(raw)
    if (value !== undefined && raw !== value &&
        (key === "settings" || key === "aram-stats")) this.store.set(key, value)
    return value
  }

  setMain<K extends SettingsKey>(key: K, value: unknown): SettingsValues[K] {
    const validated = SETTINGS_REGISTRY[key].validate(value)
    if (validated === undefined) throw new Error(`invalid_setting_value:${key}`)
    this.store.set(key, validated)
    return validated
  }

  deleteMain(key: SettingsKey): void {
    this.store.delete(key)
  }

  getRenderer(key: string): unknown {
    const entry = SETTINGS_REGISTRY[key as SettingsKey]
    if (!entry?.rendererRead) throw new Error(`setting_not_renderer_readable:${key}`)
    return this.getMain(key as SettingsKey)
  }

  setRenderer(key: string, value: unknown): unknown {
    const entry = SETTINGS_REGISTRY[key as SettingsKey]
    if (!entry?.rendererWrite) throw new Error(`setting_not_renderer_writable:${key}`)
    return this.setMain(key as SettingsKey, value)
  }

  deleteRenderer(key: string): void {
    const entry = SETTINGS_REGISTRY[key as SettingsKey]
    if (!entry?.rendererWrite) throw new Error(`setting_not_renderer_writable:${key}`)
    this.deleteMain(key as SettingsKey)
  }

  snapshotRestorable(): RecallSettingsSnapshotV1 {
    const snapshot = <K extends SettingsKey>(key: K): SettingSnapshot<SettingsValues[K]> => {
      const value = this.getMain(key)
      return value === undefined ? { state: "absent" } : { state: "present", value }
    }
    return {
      format: "recall-restorable-settings",
      version: 1,
      values: {
        ui: snapshot("settings"),
        recommendationObjective: snapshot("recommendation-objective"),
        pinnedChallenges: snapshot("pinned-challenges"),
        displayTimezone: snapshot("display-timezone"),
        lastSeenPatchNotesVersion: snapshot("last-seen-patch-notes-version"),
        skillViewPreferences: snapshot("skill-view-preferences"),
      },
    }
  }
}

export type SettingSnapshot<T> = { state: "absent" } | { state: "present"; value: T }

export interface RecallSettingsSnapshotV1 {
  format: "recall-restorable-settings"
  version: 1
  values: {
    ui: SettingSnapshot<UiSettings>
    recommendationObjective: SettingSnapshot<RecommendationObjective>
    pinnedChallenges: SettingSnapshot<number[]>
    displayTimezone: SettingSnapshot<string>
    lastSeenPatchNotesVersion: SettingSnapshot<string>
    skillViewPreferences: SettingSnapshot<SkillViewPreferences>
  }
}

export const ACCOUNT_CACHE_RESET_V1 = [
  { domain: "electron_store", key: "last-puuid", action: "delete" },
  { domain: "main_memory", key: "active-summoner/current-puuid", action: "clear" },
  { domain: "main_memory", key: "query-and-source-caches", action: "clear" },
  { domain: "renderer_memory", key: "summoner/match/review/stats stores", action: "reset-event" },
] as const
