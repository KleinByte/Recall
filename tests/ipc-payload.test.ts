import { ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { api, toPlainPayload } from "../src/helpers/api.js"

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Electron clones every IPC argument with the structured clone algorithm,
 * which rejects proxies outright. A `ref` holding an array hands out a
 * reactive proxy, so a filter built straight from component state cannot
 * cross the boundary unless it is copied first.
 */
describe("toPlainPayload", () => {
  it("invokes the full refresh IPC endpoint", async () => {
    const invoke = vi.fn().mockResolvedValue({ fetched: 0, inserted: 0 })
    vi.stubGlobal("window", { ipcRenderer: { invoke } })

    await api.refreshAll()

    expect(invoke).toHaveBeenCalledWith("app:refresh-all")
  })

  it("makes a reactive array cloneable", () => {
    const selectedModes = ref<string[]>([])
    selectedModes.value = ["mayhem"]

    // Proof the untouched value is the thing Electron refuses to send.
    expect(() => structuredClone(selectedModes.value)).toThrow()

    const payload = toPlainPayload(selectedModes.value)

    expect(() => structuredClone(payload)).not.toThrow()
    expect(payload).toEqual(["mayhem"])
  })

  it("makes a filter holding a reactive array cloneable", () => {
    const selectedModes = ref<string[]>([])
    selectedModes.value = ["mayhem"]

    const payload = toPlainPayload({
      modes: selectedModes.value,
      sortBy: "played_at",
    })

    expect(() => structuredClone(payload)).not.toThrow()
    expect(payload).toEqual({ modes: ["mayhem"], sortBy: "played_at" })
  })

  it("keeps unset filters as absent rather than dropping the key", () => {
    const payload = toPlainPayload({ result: undefined, minGradeScore: 0.2 })

    expect(payload).toEqual({ result: undefined, minGradeScore: 0.2 })
    expect(() => structuredClone(payload)).not.toThrow()
  })

  it("passes primitives straight through", () => {
    expect(toPlainPayload(25)).toBe(25)
    expect(toPlainPayload("mayhem")).toBe("mayhem")
    expect(toPlainPayload(null)).toBe(null)
    expect(toPlainPayload(undefined)).toBe(undefined)
  })

  it("sends an API key only to the write-only secure IPC endpoint", async () => {
    const invoke = vi.fn().mockResolvedValue({ configured: true })
    vi.stubGlobal("window", { ipcRenderer: { invoke } })

    await api.saveRiotApiKey("development-key")

    expect(invoke).toHaveBeenCalledWith("riot-api-key:save", "development-key")
    expect(Object.keys(api)).not.toContain("getRiotApiKey")
  })

  it("copies nested reactive structures", () => {
    const championIds = ref<number[]>([])
    championIds.value = [84, 22]

    const payload = toPlainPayload({ filters: { championIds: championIds.value } })

    expect(() => structuredClone(payload)).not.toThrow()
    expect(payload).toEqual({ filters: { championIds: [84, 22] } })
  })
})

describe("getSkillReport", () => {
  it("invokes the stats:skill-report IPC endpoint with plain payload", async () => {
    const invoke = vi.fn().mockResolvedValue({ version: 2 })
    vi.stubGlobal("window", { ipcRenderer: { invoke } })

    const reactiveModes = ref(["sr_ranked_solo", "sr_ranked_flex"])

    await api.getSkillReport(
      { modes: reactiveModes.value },
      "sr",
    )
    expect(invoke).toHaveBeenCalledWith(
      "stats:skill-report",
      { modes: ["sr_ranked_solo", "sr_ranked_flex"] },
      "sr",
    )
  })
})
