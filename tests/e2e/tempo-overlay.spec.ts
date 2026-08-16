import { _electron as electron, expect, test } from "@playwright/test"
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

test("Alt+T Tempo overlay surface is transparent, reusable, and lockable", async () => {
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
    // Windows may retain a two-DIP DWM resize border on a transparent frame.
    expect(windowState.bounds.height).toBeGreaterThanOrEqual(232)
    expect(windowState.bounds.height).toBeLessThanOrEqual(234)

    await overlay.getByRole("button", { name: "Lock" }).click()
    const locked = await main.evaluate(() => (window as unknown as OverlayIpcWindow).ipcRenderer.invoke<{
      locked: boolean
    }>("tempo-overlay:status"))
    expect(locked.locked).toBe(true)

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
