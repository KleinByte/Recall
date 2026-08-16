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

const layoutMatrix = [
  { label: "minimum", width: 1_080, height: 700, zoom: 1 },
  { label: "laptop-125", width: 1_366, height: 768, zoom: 1.25 },
  { label: "desktop-150", width: 1_920, height: 1_080, zoom: 1.5 },
] as const

test("the real Electron shell remains readable without page-level overflow", async ({}, testInfo) => {
  const userData = await mkdtemp(path.join(os.tmpdir(), "recall-e2e-"))
  const environment = { ...process.env }
  for (const key of [
    "ELECTRON_RUN_AS_NODE",
    "RECALL_LCU_LOCKFILE",
    "RECALL_LEAGUE_DIR",
    "VITE_DEV_SERVER_URL",
    "VSCODE_DEBUG",
  ]) {
    delete environment[key]
  }
  const application = await electron.launch({
    executablePath: electronExecutable,
    args: ["--no-sandbox", "--disable-gpu", "."],
    cwd: repositoryRoot,
    env: {
      ...environment,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      // A configured-but-absent lockfile prevents normal Windows discovery,
      // so this test can never connect to the developer's live League client.
      RECALL_LCU_LOCKFILE: path.join(userData, "league-client-not-running.lockfile"),
      RECALL_USER_DATA_DIR: userData,
    },
  })

  try {
    const page = await application.firstWindow()
    await page.waitForLoadState("domcontentloaded")
    await page.locator(".app-window").waitFor({ state: "visible" })
    await page.locator(".update-recall").waitFor({ state: "detached", timeout: 8_000 })

    const closePatchNotes = page.getByLabel("Close patch notes")
    if (await closePatchNotes.isVisible().catch(() => false)) {
      await closePatchNotes.click()
    }

    const surfaces = [
      { name: "dashboard", navLabel: "Dashboard", heading: "Performance dashboard" },
      { name: "skill", navLabel: "Skill", heading: "Skill" },
      { name: "settings", navLabel: "Settings", heading: "Settings" },
    ] as const

    for (const surface of surfaces) {
      await page.locator(".nav-item").filter({ hasText: surface.navLabel }).click()
      await expect(page.getByRole("heading", { name: surface.heading, exact: true }))
        .toBeVisible()

      if (surface.name === "settings") {
        const createBackup = page.getByRole("button", { name: "Create backup" })
        await expect(createBackup).toBeEnabled()
        await createBackup.click()
        await expect(page.locator(".backup-row")).toHaveCount(1)
      }

      for (const sample of layoutMatrix) {
        await application.evaluate(
          ({ BrowserWindow }, dimensions) => {
            const window = BrowserWindow.getAllWindows()[0]
            if (!window) throw new Error("Recall did not create a BrowserWindow.")
            window.setSize(dimensions.width, dimensions.height)
            window.webContents.setZoomFactor(dimensions.zoom)
            return true
          },
          sample,
        )
        await page.waitForTimeout(200)

        const result = await page.evaluate(() => {
          const root = document.documentElement
          const body = document.body
          const app = document.querySelector<HTMLElement>(".app-window")
          const primaryRegions = [
            document.querySelector<HTMLElement>("nav.sidebar"),
            document.querySelector<HTMLElement>("main.content"),
          ].filter((entry): entry is HTMLElement => entry !== null)

          const overflow = Math.max(
            root.scrollWidth - root.clientWidth,
            body.scrollWidth - root.clientWidth,
            (app?.scrollWidth ?? 0) - root.clientWidth,
          )
          const escapedRegions = primaryRegions.flatMap((region) => {
            const rect = region.getBoundingClientRect()
            return rect.left < -1 || rect.right > root.clientWidth + 1
              ? [`${region.tagName.toLowerCase()}.${region.className}: ${rect.left}..${rect.right}`]
              : []
          })

          const tinyText = Array.from(
            document.querySelectorAll<HTMLElement>("nav.sidebar *, main.content *"),
          ).flatMap((element) => {
            const hasDirectText = Array.from(element.childNodes).some(
              (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
            )
            if (!hasDirectText || element.closest('[aria-hidden="true"], svg, canvas')) return []

            const style = getComputedStyle(element)
            const rect = element.getBoundingClientRect()
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              Number(style.opacity) === 0 ||
              rect.width === 0 ||
              rect.height === 0
            ) return []

            const size = Number.parseFloat(style.fontSize)
            return size < 11
              ? [`${element.tagName.toLowerCase()}.${element.className}: ${size}px “${element.textContent?.trim().slice(0, 50)}”`]
              : []
          })

          return { overflow, escapedRegions, tinyText }
        })

        const problems = [
          ...(result.overflow > 1 ? [`page overflow: ${result.overflow}px`] : []),
          ...result.escapedRegions,
          ...result.tinyText,
        ]
        if (problems.length > 0) {
          await testInfo.attach(`${surface.name}-${sample.label}.png`, {
            body: await page.screenshot(),
            contentType: "image/png",
          })
        }
        expect(problems, `${surface.name} at ${sample.label}`).toEqual([])
      }
    }
  } finally {
    await application.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
