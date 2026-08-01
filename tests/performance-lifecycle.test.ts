import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("performance and resource lifecycle", () => {
  it("owns one native IPC callback per channel and removes it when empty", () => {
    const preload = read("electron/preload/index.ts")
    const overlay = read("src/Overlay.vue")

    expect(preload).toContain("channelSubscriptions")
    expect(preload).toContain("one native listener per channel")
    expect(preload).toContain("subscription.listeners.delete(subscriptionId)")
    expect(preload).toContain("ipcRenderer.off(channel, subscription.wrapped)")
    expect(preload).toContain('removeEventListener("readystatechange", handleReadyState)')
    expect(overlay).toContain("useApiEvents")
    expect(overlay).not.toContain("window.ipcRenderer.on")
  })

  it("keeps League discovery singular, non-overlapping, and cheap while idle", () => {
    const main = read("electron/main/index.ts")
    const discovery = read("electron/main/lcu-discovery.ts")
    const events = read("electron/main/lcu-events.ts")

    expect(main).toContain("let lcuDiscovery")
    expect(main).toContain("if (lcuDiscovery) return")
    expect(main).toContain("stopLcuDiscovery()")
    expect(discovery).toContain("DISCOVERY_INTERVAL_MS = 10_000")
    expect(discovery).toContain("this.discovering")
    expect(discovery).toContain("clearInterval(this.discoveryTimer)")
    expect(events).toContain("this.socket?.terminate()")
    expect(events).toContain("this.removeAllListeners()")
  })

  it("coalesces bursty page loads and avoids deep chart option traversal", () => {
    const chart = read("src/components/charts/BaseEChart.vue")
    const app = read("src/App.vue")
    const review = read("src/pages/ReviewPage.vue")

    for (const page of ["DashboardPage", "ChallengesPage", "ChampionsPage", "MatchesPage", "ProgressPage", "SkillPage"]) {
      expect(read(`src/pages/${page}.vue`), page).toContain("useCoalescedTask")
    }
    expect(chart).not.toContain("deep: true")
    expect(chart).toContain("resizeFrame")
    expect(app).toContain("defineAsyncComponent")
    expect(review).toContain("annotationSavesInFlight")
    expect(review).toContain("refreshCurrent")
  })
})
