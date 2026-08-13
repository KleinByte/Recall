import { createHash } from "node:crypto"
import { renameSync, rmSync, writeFileSync } from "node:fs"
import type { MatchRow } from "../matches/types.js"

export const MATCH_SUMMARY_COLUMNS = [
  "gameId",
  "playedAt",
  "mode",
  "championId",
  "win",
  "kills",
  "deaths",
  "assists",
  "durationSecs",
  "grade",
  "gradeScore",
  "recallScore",
  "gradeAlgorithmVersion",
  "gradeRecipeId",
  "gradeStatus",
  "gradeEvidenceCoverage",
  "gradeReferenceSampleCount",
] as const

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function matchSummaryCsv(matches: readonly MatchRow[]): string {
  const rows = matches.map((match) =>
    MATCH_SUMMARY_COLUMNS.map((column) => csvCell(match[column])).join(","))
  return `${MATCH_SUMMARY_COLUMNS.join(",")}\r\n${rows.join("\r\n")}\r\n`
}

export function writeMatchSummaryCsv(
  filePath: string,
  matches: readonly MatchRow[],
): { exported: number; filePath: string; digest: string } {
  const csv = matchSummaryCsv(matches)
  const temporary = `${filePath}.tmp-${process.pid}`
  try {
    writeFileSync(temporary, csv, { encoding: "utf8", flag: "wx" })
    renameSync(temporary, filePath)
  } finally {
    rmSync(temporary, { force: true })
  }
  return {
    exported: matches.length,
    filePath,
    digest: createHash("sha256").update(csv, "utf8").digest("hex"),
  }
}

