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
})
