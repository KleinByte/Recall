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
    expect(website).toContain("Master · 392 LP")
    expect(website).toContain("recall-dial-master.jpg")
    expect(website).toContain("recall-social-card.png")
    expect(website).toContain("recall-personal-records.png")
    expect(website).toContain("recall-review-context.png")
  })
})
