import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("Windows update compatibility", () => {
  it("keeps the installer identity used by releases through 1.1.2", () => {
    const config = JSON.parse(readFileSync("electron-builder.json", "utf8"))

    // Before appId was explicit, electron-builder derived the NSIS GUID from
    // `com.electron.recall`. Keep that installer identity while allowing the
    // app/taskbar identity to use the current branded value.
    expect(config.appId).toBe("com.kleinbyte.recall")
    expect(config.nsis.guid).toBe("f055652a-03fc-5862-8fe3-2be04dffe9f6")
  })

  it("publishes a stable installer name for direct downloads", () => {
    const config = JSON.parse(readFileSync("electron-builder.json", "utf8"))
    const workflow = readFileSync(".github/workflows/release.yml", "utf8")
    const website = readFileSync("website/index.html", "utf8")

    expect(config.win.artifactName).toBe("${productName}-Windows-Setup.${ext}")
    expect(workflow).toContain("Recall-Windows-Setup.exe")
    expect(website).toContain(
      "https://github.com/KleinByte/Recall/releases/latest/download/Recall-Windows-Setup.exe",
    )
    expect(website).toContain("https://ko-fi.com/kleinbyte")
    expect(website).toContain('class="showcase-stage"')
    expect(website).toContain("RiverQuartz#DEMO")
    expect(website).toContain("recall-social-card.png")
    expect(website).toContain("recall-playback.png")
    expect(website).toContain("recall-jungle-clear.png")
    expect(website).toContain("recall-champion-clear-times.png")
    expect(website).toContain("recall-review-rvi.png")
    expect(website).toContain("recall-review-overview.png")
    expect(website).toContain("recall-review-breakdown.png")
    expect(website).toContain("recall-skill-overview.png")
    expect(website).toContain("recall-skill-insights.png")
    expect(website).toContain("recall-skill-analyze.png")
    expect(website).toContain("recall-progress-records.png")
    expect(website).toContain("recall-live-panel.png")
    expect(website).toContain("recall-tempo-overdrive.gif")
    expect(website).toContain("recall-tempo-pentakill.png")
    expect(website).toContain(
      "https://www.virustotal.com/gui/file-analysis/MDM3OWMyOWNkOWY5MGFkYzI3ZjgyZTc5NzgwOTIwMjM6MTc4NzI4MTcyNw==",
    )
  })

  it("keeps the Store installer on the existing signed offline NSIS identity", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"))
    const baseConfig = JSON.parse(readFileSync("electron-builder.json", "utf8"))
    const signedConfig = readFileSync("electron-builder.azure.cjs", "utf8")
    const storeConfig = readFileSync("electron-builder.store.cjs", "utf8")
    const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8")

    expect(pkg.scripts["store:package"]).toContain("package:store")
    expect(pkg.scripts["store:package"]).toContain("store:defender")
    expect(pkg.scripts["store:package"]).toContain("store:verify")
    expect(baseConfig.appId).toBe("com.kleinbyte.recall")
    expect(baseConfig.nsis.guid).toBe("f055652a-03fc-5862-8fe3-2be04dffe9f6")
    expect(baseConfig.win.artifactName).toBe("${productName}-Windows-Setup.${ext}")
    expect(baseConfig.asarUnpack).toEqual([
      "**/node_modules/better-sqlite3/prebuilds/win32-x64.node",
    ])
    expect(baseConfig.files).toContain(
      "!node_modules/better-sqlite3/prebuilds/win32-arm64.node",
    )
    expect(signedConfig).toContain('signExts: [".dll", ".node"]')
    expect(storeConfig).toContain('target: "nsis"')
    expect(storeConfig).toContain('arch: ["x64"]')
    expect(releaseWorkflow).toContain("scripts/test-store-installer.ps1")
    expect(releaseWorkflow).toContain("Recall-Windows-Setup.defender.json")
    expect(releaseWorkflow).toContain("Recall-Windows-Setup.store-inventory.json")
    expect(releaseWorkflow).toContain("Recall-Windows-Setup.sha256")
    expect(releaseWorkflow).toContain("expected immutable URL")
  })
})
