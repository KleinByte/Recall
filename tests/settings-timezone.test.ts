import { describe, expect, it } from "vitest"
import { SettingsStore } from "../electron/main/settings-store.js"
import { resolveDisplayTimezone } from "../electron/main/matches/time-contract.js"

class MemoryStore {
  values = new Map<string, unknown>()
  get(key: string) { return this.values.get(key) }
  set(key: string, value: unknown) { this.values.set(key, value) }
  delete(key: string) { this.values.delete(key) }
}

describe("display timezone settings", () => {
  it("uses a valid override, then OS timezone, then UTC", () => {
    expect(resolveDisplayTimezone("America/Chicago", "Europe/London")).toBe("America/Chicago")
    expect(resolveDisplayTimezone("bad zone", "Europe/London")).toBe("Europe/London")
    expect(resolveDisplayTimezone("bad zone", "also bad")).toBe("UTC")
  })

  it("validates saves and deletes the override for system mode", () => {
    const raw = new MemoryStore()
    const settings = new SettingsStore(raw)
    expect(settings.setRenderer("display-timezone", "America/Chicago")).toBe("America/Chicago")
    expect(() => settings.setRenderer("display-timezone", "bad zone")).toThrow()
    settings.deleteRenderer("display-timezone")
    expect(settings.getRenderer("display-timezone")).toBeUndefined()
  })
})
