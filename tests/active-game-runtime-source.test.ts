import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync("electron/main/index.ts", "utf8")

function between(start: string, end: string) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from).toBeGreaterThanOrEqual(0)
  expect(to).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe("active game runtime wiring", () => {
  it("owns Port 2999 and minimap capture outside the replaceable LCU session", () => {
    const lcu = between("interface Session {", "/** State owned by the logical game")
    const game = between("interface ActiveGameRuntime {", "let session:")

    expect(lcu).not.toContain("GameClient")
    expect(lcu).not.toContain("RecallMinimapIntegration")
    expect(game).toContain("gameClient: GameClient")
    expect(game).toContain("minimapTelemetry: RecallMinimapIntegration")
    expect(game).toContain("lifecycle: GameLifecycleCoordinator")
    expect(game).toContain("liveTimer: NodeJS.Timeout")
  })

  it("preserves capture on discovery loss and lets Port 2999 promote a draft", () => {
    const discovery = between("function connectToLcu(", "function stopLcuDiscovery(")
    const live = between("async function refreshLiveGameData(", "/** Covers the case")

    expect(discovery).toContain("preserveActiveGame: true")
    expect(live).toContain("probingFromDraft")
    expect(live).toContain("readLiveGameSnapshot(runtime.gameClient)")
    expect(live).toContain('phase: "InProgress"')
  })

  it("keeps optional identity enrichment off the critical startup path", () => {
    const refresh = between("async function refreshLiveSession(", "/**\n * Adds the documented")

    expect(refresh).toContain("resolvePlayerNames: false")
    expect(refresh.indexOf("broadcastLive(win)")).toBeLessThan(
      refresh.indexOf("enrichLiveSessionNames("),
    )
  })
})
