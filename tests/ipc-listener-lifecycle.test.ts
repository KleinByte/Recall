import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("renderer IPC listener lifecycle", () => {
  it("owns page and component subscriptions through the unmount helper", () => {
    const files = [
      "src/App.vue",
      "src/components/ChampSelectBanner.vue",
      "src/components/WindowTitleBar.vue",
      "src/pages/ChallengesPage.vue",
      "src/pages/ChampionsPage.vue",
      "src/pages/DashboardPage.vue",
      "src/pages/LiveGamePage.vue",
      "src/pages/MatchesPage.vue",
      "src/pages/ProgressPage.vue",
      "src/pages/ReviewPage.vue",
      "src/pages/SettingsPage.vue",
      "src/pages/SkillPage.vue",
    ]

    for (const file of files) {
      const source = read(file)
      expect(source, file).toContain("useApiEvents")
      expect(source, file).not.toMatch(/api\.on(?:UpdateStatus)?\(/)
    }
  })

  it("unsubscribes registered and late-arriving listeners", () => {
    const helper = read("src/helpers/use-api-events.ts")
    const api = read("src/helpers/api.ts")

    expect(helper).toContain("onBeforeUnmount")
    expect(helper).toContain("disposed = true")
    expect(helper).toContain("if (disposed) dispose()")
    expect(api).toContain("const ipcSubscriptions = new Map")
    expect(api).toContain("current.subscribers.delete(subscriber)")
    expect(api).toContain("Keep the single channel bridge warm")
    expect(api).toContain("subscription.renderer.off(channel, subscription.wrapped, subscription.subscriptionId)")
    expect(api).toContain("import.meta.hot.dispose")
    const preload = read("electron/preload/index.ts")
    expect(preload).toContain("channelSubscriptions")
    expect(preload).toContain("one native listener per channel")
    expect(preload).toContain("subscription.listeners.set(subscriptionId, listener)")
    expect(preload).toContain("ipcRenderer.off(channel, subscription.wrapped)")
  })
})
