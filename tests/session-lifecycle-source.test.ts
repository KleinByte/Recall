import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync("electron/main/index.ts", "utf8")

function body(start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from, start).toBeGreaterThanOrEqual(0)
  expect(to, end).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe("LCU session lifecycle source contract", () => {
  it("generation-gates startup after awaited LCU reads and before profile writes", () => {
    const startup = body("async function startSession(", "function stopSession(")
    const currentSummoner = startup.indexOf("await client.request<Summoner>")
    const postSummonerGate = startup.indexOf("if (!isCurrent())", currentSummoner)
    const locale = startup.indexOf("await client.request<{", postSummonerGate)
    const finalGate = startup.indexOf("if (!isCurrent())", locale)
    const profileWrite = startup.indexOf("getAccountProfileCapture().record")

    expect(currentSummoner).toBeGreaterThanOrEqual(0)
    expect(postSummonerGate).toBeGreaterThan(currentSummoner)
    expect(locale).toBeGreaterThan(postSummonerGate)
    expect(finalGate).toBeGreaterThan(locale)
    expect(profileWrite).toBeGreaterThan(finalGate)
  })

  it("carries one active Session through sync and gates post-await snapshot writes", () => {
    const sync = body("async function performFullSync(", "async function startRiotHistoryBackfill(")
    const beforeAccount = sync.indexOf("await snapshotAccountProfile(win, active)")
    const matchSync = sync.indexOf("const result = await active.sync.syncNow()")
    const afterAccount = sync.indexOf(
      "await snapshotAccountProfile(win, active)",
      beforeAccount + 1,
    )
    const postSync = sync.indexOf("await afterSync(win, active, result)")
    expect(beforeAccount).toBeGreaterThanOrEqual(0)
    expect(matchSync).toBeGreaterThan(beforeAccount)
    expect(afterAccount).toBeGreaterThan(matchSync)
    expect(postSync).toBeGreaterThan(afterAccount)
    expect(sync).toContain("if (collectionDisabled() || session !== active) return")

    const after = body("async function afterSync(", "/** Refreshes mutable LCU identity")
    expect(after).toContain("const isCurrent = () => !collectionDisabled() && session === active")

    for (const name of ["snapshotRanked", "snapshotProfile"]) {
      const snapshot = body(`async function ${name}(`,
        name === "snapshotRanked" ? "/** Records challenge standing" : "function connectToLcu(")
      const request = snapshot.indexOf("await active.client.request")
      const gate = snapshot.indexOf(
        "if (collectionDisabled() || session !== active) return",
        request,
      )
      expect(request, name).toBeGreaterThanOrEqual(0)
      expect(gate, name).toBeGreaterThan(request)
    }
  })
})
