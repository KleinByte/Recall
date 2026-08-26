import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (fileName: string) => readFileSync(fileName, "utf8")

describe("database recovery UI contract", () => {
  it("checks startup state before notifying normal services", () => {
    const app = read("src/App.vue")
    expect(app.indexOf("await api.getStartupState()"))
      .toBeLessThan(app.indexOf("api.notifyReady()"))
    expect(app).toContain("startupState.value.kind !== \"ready\"")
    expect(app).toContain("<DatabaseRecovery")
  })

  it("provides a non-dismissible Recall recovery surface and explicit exits", () => {
    const recovery = read("src/components/DatabaseRecovery.vue")
    expect(recovery).toContain('aria-labelledby="recovery-title"')
    expect(recovery).toContain("Restore selected backup")
    expect(recovery).toContain("Browse for another backup")
    expect(recovery).toContain("Quit Recall")
    expect(recovery).toContain("Install Recall v{{ updateStatus.version }}")
    expect(recovery).not.toContain("<Dialog")
    expect(recovery).not.toContain("@click.self")
  })
})
