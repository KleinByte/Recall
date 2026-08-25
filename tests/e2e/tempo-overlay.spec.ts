import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test"
import { mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const electronExecutable = require("electron") as string
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
)

interface OverlayIpcWindow extends Window {
  ipcRenderer: {
    invoke<T>(channel: string): Promise<T>
  }
}

const pentakillSession = {
  phase: "InProgress",
  gameId: 9_100_005,
  queueId: 420,
  queueName: "Ranked Solo/Duo",
  gameMode: "CLASSIC",
  mapId: 11,
  benchChampionIds: [],
  allies: [],
  enemies: [],
  game: {
    available: true,
    gameTime: 1_245,
    gameMode: "CLASSIC",
    mapName: "Summoner's Rift",
    mapNumber: 11,
    allies: [],
    enemies: [],
    events: [],
    analysis: {
      resources: {
        allyGold: 42_500,
        enemyGold: 38_100,
        difference: 4_400,
        quality: "strong",
        source: "estimated",
      },
      winConfidence: {
        percent: 78,
        label: "Strongly favored",
        factors: ["Pentakill opened the map"],
      },
      tempo: {
        score: 100,
        label: "Pentakill",
        direction: "up",
        leadDelta: 42,
        factors: ["Pentakill surge"],
        surgeTier: "master",
      },
    },
    updatedAt: Date.now(),
  },
  updatedAt: Date.now(),
}

const stableSession = {
  ...pentakillSession,
  game: {
    ...pentakillSession.game,
    analysis: {
      ...pentakillSession.game.analysis,
      tempo: {
        score: 66,
        label: "Stable",
        direction: "steady",
        leadDelta: 0,
        factors: ["Recent pace holding"],
      },
    },
  },
}

async function publishLiveSession(
  application: ElectronApplication,
  title: "main" | "overlay",
  session: unknown,
) {
  await application.evaluate(({ BrowserWindow }, { target, session }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => target === "overlay"
      ? candidate.getTitle() === "Recall Tempo Overlay"
      : candidate.getTitle() !== "Recall Tempo Overlay")
    if (!window) throw new Error(`Missing ${target} window`)
    window.webContents.send("live:updated", session)
  }, { target: title, session })
}

async function animationSample(page: Page, selector: string, name: string) {
  return page.locator(selector).evaluate((element, animationName) => {
    const animation = element.getAnimations().find(
      (candidate) => (candidate as CSSAnimation).animationName.startsWith(animationName),
    )
    const style = getComputedStyle(element)
    return {
      animationDelay: style.animationDelay,
      animationDuration: style.animationDuration,
      animationName: style.animationName,
      currentTime: Number(animation?.currentTime ?? -1),
      playState: animation?.playState ?? "missing",
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      visibilityState: document.visibilityState,
    }
  }, name)
}

test("Tempo motion advances on the Live page and locked Alt+T overlay", async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), "recall-overlay-e2e-"))
  const environment = { ...process.env }
  for (const key of [
    "ELECTRON_RUN_AS_NODE",
    "RECALL_LCU_LOCKFILE",
    "RECALL_LEAGUE_DIR",
    "VITE_DEV_SERVER_URL",
    "VSCODE_DEBUG",
  ]) delete environment[key]

  const application = await electron.launch({
    executablePath: electronExecutable,
    args: ["--no-sandbox", "--disable-gpu", "."],
    cwd: repositoryRoot,
    env: {
      ...environment,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      RECALL_LCU_LOCKFILE: path.join(userData, "league-client-not-running.lockfile"),
      RECALL_USER_DATA_DIR: userData,
    },
  })

  try {
    const main = await application.firstWindow()
    await main.waitForLoadState("domcontentloaded")
    await main.locator(".app-window").waitFor({ state: "visible" })
    await main.locator(".update-recall").waitFor({ state: "detached" })

    await expect(async () => {
      await publishLiveSession(application, "main", stableSession)
      await expect(main.locator(".live-page")).toBeVisible()
    }).toPass()
    await expect(async () => {
      await publishLiveSession(application, "main", stableSession)
      await expect(main.locator(".tempo-gauge.phase-idle")).toBeVisible()
    }).toPass()
    await expect(main.locator("html")).toHaveAttribute("data-live-phase", "InProgress")

    await publishLiveSession(application, "main", pentakillSession)
    await expect(main.locator(".tempo-gauge.tier-master.phase-rupturing")).toBeVisible()
    await expect(main.locator(".core-label")).toHaveText("Pentakill")
    const mainRuptureBefore = await animationSample(
      main,
      ".master-rupture",
      "master-rupture",
    )
    expect(mainRuptureBefore.playState).toBe("running")
    await main.waitForTimeout(220)
    const mainRuptureAfter = await animationSample(
      main,
      ".master-rupture",
      "master-rupture",
    )
    expect(mainRuptureAfter.currentTime).toBeGreaterThan(mainRuptureBefore.currentTime)

    await expect(main.locator(".tempo-gauge.tier-master.phase-burning")).toBeVisible()
    const mainOrbitBefore = await animationSample(main, ".halo-band-orbit", "orbit-spin")
    expect(mainOrbitBefore).toMatchObject({
      animationName: expect.stringMatching(/^orbit-spin/),
      playState: "running",
      reducedMotion: false,
    })
    expect(mainOrbitBefore.currentTime).toBeGreaterThanOrEqual(0)
    await main.waitForTimeout(220)
    const mainOrbitAfter = await animationSample(main, ".halo-band-orbit", "orbit-spin")
    expect(mainOrbitAfter.currentTime).toBeGreaterThan(mainOrbitBefore.currentTime)

    await publishLiveSession(application, "main", stableSession)
    await expect(main.locator(".tempo-gauge.tier-master.phase-discharging")).toBeVisible()
    const mainDischargeBefore = await animationSample(
      main,
      ".halo-band-orbit",
      "orbit-retract",
    )
    expect(mainDischargeBefore).toMatchObject({
      animationDuration: "1.3s",
      animationName: expect.stringMatching(/^orbit-retract/),
      playState: "running",
      reducedMotion: false,
      visibilityState: "visible",
    })
    await main.waitForTimeout(220)
    const mainDischargeAfter = await animationSample(
      main,
      ".halo-band-orbit",
      "orbit-retract",
    )
    expect(
      mainDischargeAfter.currentTime,
      JSON.stringify({ before: mainDischargeBefore, after: mainDischargeAfter }),
    ).toBeGreaterThan(mainDischargeBefore.currentTime)
    expect(await main.locator(".titlebar-mark").evaluate((element) =>
      getComputedStyle(element, "::before").animationPlayState)).toBe("paused")

    const overlayPromise = application.waitForEvent("window")
    const opened = await main.evaluate(() => (window as unknown as OverlayIpcWindow).ipcRenderer.invoke<{
      visible: boolean
      locked: boolean
    }>("tempo-overlay:toggle"))
    expect(opened).toMatchObject({ visible: true, locked: false })

    const overlay = await overlayPromise
    await overlay.waitForLoadState("domcontentloaded")
    await expect(overlay.locator(".tempo-overlay")).toBeVisible()
    await expect(overlay.getByText("Waiting for live Tempo")).toBeVisible()

    await expect(async () => {
      await publishLiveSession(application, "overlay", stableSession)
      await expect(overlay.locator(".tempo-gauge.phase-idle")).toBeVisible()
    }).toPass()

    const windowState = await application.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.getTitle() === "Recall Tempo Overlay",
      )
      if (!win) throw new Error("Tempo overlay window was not created")
      return {
        bounds: win.getBounds(),
        alwaysOnTop: win.isAlwaysOnTop(),
        focusable: win.isFocusable(),
        visible: win.isVisible(),
      }
    })
    expect(windowState).toMatchObject({
      bounds: { width: 360 },
      alwaysOnTop: true,
      focusable: false,
      visible: true,
    })
    // Windows may retain a small DWM border on a transparent frame.
    expect(windowState.bounds.height).toBeGreaterThanOrEqual(232)
    expect(windowState.bounds.height).toBeLessThanOrEqual(236)

    await overlay.getByRole("button", { name: "Lock" }).click()
    const locked = await main.evaluate(() => (window as unknown as OverlayIpcWindow).ipcRenderer.invoke<{
      locked: boolean
    }>("tempo-overlay:status"))
    expect(locked.locked).toBe(true)

    await publishLiveSession(application, "overlay", pentakillSession)
    await expect(overlay.locator(".tempo-gauge.tier-master.phase-rupturing")).toBeVisible()
    await expect(overlay.locator(".core-label")).toHaveText("Pentakill")
    const overlayRuptureBefore = await animationSample(
      overlay,
      ".master-rupture",
      "master-rupture",
    )
    expect(overlayRuptureBefore.playState).toBe("running")
    await overlay.waitForTimeout(220)
    const overlayRuptureAfter = await animationSample(
      overlay,
      ".master-rupture",
      "master-rupture",
    )
    expect(overlayRuptureAfter.currentTime).toBeGreaterThan(overlayRuptureBefore.currentTime)

    await expect(overlay.locator(".tempo-gauge.tier-master.phase-burning")).toBeVisible()
    const overlayOrbitBefore = await animationSample(overlay, ".halo-band-orbit", "orbit-spin")
    expect(overlayOrbitBefore).toMatchObject({
      animationName: expect.stringMatching(/^orbit-spin/),
      playState: "running",
      reducedMotion: false,
    })
    expect(overlayOrbitBefore.currentTime).toBeGreaterThanOrEqual(0)
    await overlay.waitForTimeout(220)
    const overlayOrbitAfter = await animationSample(overlay, ".halo-band-orbit", "orbit-spin")
    expect(overlayOrbitAfter.currentTime).toBeGreaterThan(overlayOrbitBefore.currentTime)

    await publishLiveSession(application, "overlay", stableSession)
    await expect(overlay.locator(".tempo-gauge.tier-master.phase-discharging")).toBeVisible()
    const overlayDischargeBefore = await animationSample(
      overlay,
      ".halo-band-orbit",
      "orbit-retract",
    )
    expect(overlayDischargeBefore).toMatchObject({
      animationDuration: "1.3s",
      animationName: expect.stringMatching(/^orbit-retract/),
      playState: "running",
      reducedMotion: false,
      visibilityState: "visible",
    })
    await overlay.waitForTimeout(220)
    const overlayDischargeAfter = await animationSample(
      overlay,
      ".halo-band-orbit",
      "orbit-retract",
    )
    expect(
      overlayDischargeAfter.currentTime,
      JSON.stringify({ before: overlayDischargeBefore, after: overlayDischargeAfter }),
    ).toBeGreaterThan(overlayDischargeBefore.currentTime)

    await overlay.emulateMedia({ reducedMotion: "reduce" })
    await expect(overlay.locator(".halo-band-orbit")).toHaveCSS("animation-name", "none")

    const hidden = await main.evaluate(() => (window as unknown as OverlayIpcWindow).ipcRenderer.invoke<{
      visible: boolean
    }>("tempo-overlay:toggle"))
    expect(hidden.visible).toBe(false)

    const finalWindowState = await application.evaluate(({ BrowserWindow }) => ({
      count: BrowserWindow.getAllWindows().length,
      overlayVisible: BrowserWindow.getAllWindows().find(
        (candidate) => candidate.getTitle() === "Recall Tempo Overlay",
      )?.isVisible(),
    }))
    expect(finalWindowState).toEqual({ count: 2, overlayVisible: false })
  } finally {
    await application.close()
    await rm(userData, { recursive: true, force: true })
  }
})
