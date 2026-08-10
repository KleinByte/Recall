import { describe, expect, it, vi } from "vitest"
import {
  SETTINGS_REGISTRY,
  SettingsStore,
} from "../electron/main/settings-store.js"

function fakeStore(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    get: vi.fn((key: string) => values.get(key)),
    set: vi.fn((key: string, value: unknown) => values.set(key, value)),
    delete: vi.fn((key: string) => values.delete(key)),
  }
}

describe("typed settings store", () => {
  it("enumerates the complete settings registry", () => {
    expect(Object.keys(SETTINGS_REGISTRY)).toEqual([
      "settings",
      "recommendation-objective",
      "skill-view-preferences",
      "pinned-challenges",
      "display-timezone",
      "last-seen-patch-notes-version",
      "launch-at-login",
      "last-puuid",
      "riot-api-key-encrypted",
      "champion-catalog",
      "ddragon-version",
      "aram-stats",
      "last-daily-backup",
      "collection-mode",
    ])
  })

  it("migrates the legacy JSON UI setting exactly once", () => {
    const raw = fakeStore({
      settings: JSON.stringify({
        isColoredWhenDone: true,
        showChampionNames: false,
        sidebarCollapsed: true,
      }),
    })
    const settings = new SettingsStore(raw)

    expect(settings.getMain("settings")).toEqual({
      isColoredWhenDone: true,
      showChampionNames: false,
      sidebarCollapsed: true,
    })
    expect(raw.set).toHaveBeenCalledWith("settings", {
      isColoredWhenDone: true,
      showChampionNames: false,
      sidebarCollapsed: true,
    })
  })

  it("rejects renderer access before touching storage", () => {
    const raw = fakeStore()
    const settings = new SettingsStore(raw)
    const forbidden = [
      "riot-api-key-encrypted",
      "last-puuid",
      "champion-catalog",
      "ddragon-version",
      "aram-stats",
      "last-daily-backup",
      "collection-mode",
      "unknown",
    ]

    for (const key of forbidden) {
      expect(() => settings.getRenderer(key)).toThrow(/setting_not_renderer_readable/)
      expect(() => settings.setRenderer(key, true)).toThrow(/setting_not_renderer_writable/)
    }
    expect(raw.get).not.toHaveBeenCalled()
    expect(raw.set).not.toHaveBeenCalled()
  })

  it("validates and canonicalizes renderer values", () => {
    const raw = fakeStore()
    const settings = new SettingsStore(raw)

    settings.setMain("pinned-challenges", [9, 2, 9])
    expect(raw.values.get("pinned-challenges")).toEqual([2, 9])
    expect(() => settings.setRenderer("launch-at-login", 1)).toThrow(/invalid_setting_value/)
  })

  it("persists a validated Skill selection", () => {
    const raw = fakeStore()
    const settings = new SettingsStore(raw)
    const selection = {
      scopeId: "rankedSolo",
      seasonId: "2026-s3",
      role: "MIDDLE",
      championId: 8,
      tab: "insights",
    }

    expect(settings.setRenderer("skill-view-preferences", selection)).toEqual(selection)
    expect(settings.getRenderer("skill-view-preferences")).toEqual(selection)
    expect(() => settings.setRenderer("skill-view-preferences", {
      ...selection,
      scopeId: "made-up-mode",
    })).toThrow(/invalid_setting_value/)
  })
})
