import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("performance and resource lifecycle", () => {
  it("uses the in-app champion-select banner without an overlay window", () => {
    const app = read("src/App.vue")
    const main = read("electron/main/index.ts")
    const entry = read("src/main.ts")

    expect(app).toContain("ChampSelectBanner")
    expect(main).toContain('broadcast(win, "pick", championId)')
    expect(main).not.toContain("updateOverlay")
    expect(entry).not.toContain("#overlay")
  })

  it("owns one native IPC callback per channel and removes it when empty", () => {
    const preload = read("electron/preload/index.ts")

    expect(preload).toContain("channelSubscriptions")
    expect(preload).toContain("one native listener per channel")
    expect(preload).toContain("subscription.listeners.delete(subscriptionId)")
    expect(preload).toContain("ipcRenderer.off(channel, subscription.wrapped)")
    expect(preload).toContain('removeEventListener("readystatechange", handleReadyState)')
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
    const reviewData = read("src/features/review/use-review-page-data.ts")

    for (const page of ["DashboardPage", "ChallengesPage", "ChampionsPage", "MatchesPage", "ProgressPage", "SkillPage"]) {
      expect(read(`src/pages/${page}.vue`), page).toContain("useCoalescedTask")
    }
    expect(chart).not.toContain("deep: true")
    expect(chart).toContain("resizeFrame")
    expect(app).toContain("defineAsyncComponent")
    expect(review).toContain("useReviewPageData")
    expect(reviewData).toContain("annotationSavesInFlight")
    expect(reviewData).toContain("refreshCurrent")
  })

  it("keeps Settings trust refreshes coalesced and backup work off the main thread", () => {
    const settings = read("src/pages/SettingsPage.vue")
    const main = read("electron/main/index.ts")
    const dataTrustIpc = read("electron/main/ipc/data-trust-ipc.ts")
    const backups = read("electron/main/database/backup-manager.ts")

    expect(settings).toContain("useCoalescedTask")
    expect(settings).toContain("events.on(\"data-trust:updated\", () => void refreshTrust())")
    expect(main).toContain("registerDataTrustIpc")
    expect(dataTrustIpc).toContain("createAsync(")
    expect(dataTrustIpc).toContain('"manual"')
    expect(dataTrustIpc).toContain("prepareRestoreAsync(")
    expect(backups).toContain("await db.backup(staging)")
    expect(backups).not.toContain("integrity: sha256(database)")
  })

  it("refreshes only the dashboard data affected by each client event", () => {
    const dashboard = read("src/pages/DashboardPage.vue")
    const main = read("electron/main/index.ts")

    expect(dashboard).toContain('queueRefresh("stats")')
    expect(dashboard).toContain('queueRefresh("profile")')
    expect(dashboard).toContain('queueRefresh("ranked")')
    expect(dashboard).not.toContain('events.on("lcu:status"')
    expect(main).toContain('if (changed) broadcast(win, "profile:updated")')
    expect(main).toContain('if (imported > 0 && state.status !== "running")')
    expect(main).not.toContain("imported >= 10")
  })

  it("enriches retained timelines before freezing a direct Recall recipe cutover", () => {
    const main = read("electron/main/index.ts")
    const sessionStart = main.indexOf("async function startSession(")
    const sessionEnd = main.indexOf("function stopSession", sessionStart)
    const startSession = main.slice(sessionStart, sessionEnd)
    const start = main.indexOf("async function afterSync(")
    const end = main.indexOf("async function snapshotRanked", start)
    const afterSync = main.slice(start, end)

    expect(main).toContain("if (needsDirectCutover && !win) return status")
    expect(startSession).toContain("getMatchGradingService().needsDirectCutover()")
    expect(startSession.indexOf("startRiotHistoryBackfill(win, true)")).toBeLessThan(
      startSession.indexOf("await runSync(win)"),
    )
    expect(afterSync.indexOf(".queueRecentMatches(")).toBeGreaterThan(-1)
    expect(afterSync.indexOf(".queueRecentMatches(")).toBeLessThan(
      afterSync.indexOf("ensureRecallFrozen(win)"),
    )
    expect(afterSync).toContain("if (needsDirectCutover) await trackedTimelineTask")
    expect(afterSync).toContain("if (needsDirectCutover && riotBackfillTask)")
  })

  it("opens database-less recovery while keeping derived startup analysis rebuildable", () => {
    const main = read("electron/main/index.ts")
    const startup = main.slice(main.indexOf("async function main()"))
    const openHistory = startup.indexOf("getRepository()")
    const recoveryState = startup.indexOf("startupState = recoveryStartupState(")
    const derivedAnalysis = startup.indexOf("await ensureRecallFrozen()")
    const maintenanceWarning = startup.indexOf(
      '"Recall opened with analysis pending"',
    )

    expect(openHistory).toBeGreaterThan(-1)
    expect(recoveryState).toBeGreaterThan(openHistory)
    expect(derivedAnalysis).toBeGreaterThan(recoveryState)
    expect(maintenanceWarning).toBeGreaterThan(derivedAnalysis)
    expect(startup).toContain("const win = await createWindow(startHidden)")
    expect(startup).toContain("registerBaseIpc(win, updater)")
    expect(startup).toContain("registerRecoveryIpc(win)")
    expect(startup).toContain('if (startupState.kind === "ready")')
    expect(main).toContain('title: "Choose a Recall database backup"')
    expect(main).toContain("restoreDatabaseFromSelectedBackup(")
    expect(startup).not.toContain('"Recall could not open your history"')
    expect(startup).not.toContain("promptForCompatibleBackupRestore")
    expect(startup).toContain("Recall will retry after the next successful sync.")
  })
})
