import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  MATCH_SUMMARY_COLUMNS,
  matchSummaryCsv,
  writeMatchSummaryCsv,
} from "../electron/main/background/match-summary-export.js"
import type { MatchRow } from "../electron/main/matches/types.js"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function match(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    gameId: 1,
    playedAt: 1_000,
    mode: "CLASSIC",
    championId: 84,
    win: true,
    kills: 5,
    deaths: 2,
    assists: 8,
    durationSecs: 1_800,
    ...overrides,
  } as MatchRow
}

describe("match summary background export", () => {
  it("preserves the existing column order and RFC-style CSV escaping", () => {
    const csv = matchSummaryCsv([match({ grade: 'S,"quoted"' })])
    const [header, row] = csv.split("\r\n")

    expect(header).toBe(MATCH_SUMMARY_COLUMNS.join(","))
    expect(row).toContain('"S,""quoted"""')
    expect(csv.endsWith("\r\n")).toBe(true)
  })

  it("atomically writes the file and returns its exact digest", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "recall-export-"))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, "matches.csv")
    const rows = [match(), match({ gameId: 2, win: false })]

    const result = writeMatchSummaryCsv(filePath, rows)
    const bytes = readFileSync(filePath, "utf8")

    expect(result).toEqual({
      exported: 2,
      filePath,
      digest: createHash("sha256").update(bytes, "utf8").digest("hex"),
    })
  })
})

