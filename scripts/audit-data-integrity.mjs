#!/usr/bin/env node
import Database from "better-sqlite3-node"
import { existsSync, statSync } from "node:fs"
import path from "node:path"

const argument = process.argv.indexOf("--db")
if (argument < 0 || !process.argv[argument + 1]) {
  process.stderr.write("Usage: audit-data-integrity.mjs --db <explicit-database-path>\n")
  process.exitCode = 2
} else {
  const databasePath = path.resolve(process.argv[argument + 1])
  if (!existsSync(databasePath) || !statSync(databasePath).isFile()) {
    process.stderr.write("The explicit database path does not exist or is not a regular file.\n")
    process.exitCode = 2
  } else {
    const db = new Database(databasePath, { readonly: true, fileMustExist: true })
    const tableNames = new Set(db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all().map((row) => row.name))
    const scalar = (sql) => Number(db.prepare(sql).get().count)
    const countIf = (tables, sql) => tables.every((name) => tableNames.has(name)) ? scalar(sql) : 0
    try {
      const report = {
        databaseBytes: statSync(databasePath).size,
        schemaVersion: Number(db.pragma("user_version", { simple: true })),
        quickCheck: String(db.pragma("quick_check", { simple: true })),
        foreignKeyViolations: db.pragma("foreign_key_check").length,
        invalidJsonRows: countIf(["match_source_captures"],
          `SELECT COUNT(*) AS count FROM match_source_captures
           WHERE NOT json_valid(applicable_json) OR NOT json_valid(captured_json)
              OR NOT json_valid(partial_json) OR NOT json_valid(unavailable_json)
              OR NOT json_valid(invalid_json) OR NOT json_valid(not_applicable_json)
              OR NOT json_valid(intentionally_ignored_json) OR NOT json_valid(unknown_json)
              OR NOT json_valid(unknown_fields_json) OR NOT json_valid(conflicts_json)`),
        orphanRows: countIf(["match_grade_results", "matches"],
          `SELECT COUNT(*) AS count FROM match_grade_results r
           LEFT JOIN matches m ON m.game_id=r.game_id AND m.puuid=r.puuid
           WHERE m.game_id IS NULL`),
        partialGradePairs: countIf(["matches"],
          "SELECT COUNT(*) AS count FROM matches WHERE (grade IS NULL) <> (grade_score IS NULL)"),
        eligibleCurrentGradesWithoutBreakdown: countIf(["match_grade_results", "match_grade_breakdown_versions"],
          `SELECT COUNT(*) AS count FROM match_grade_results r
           LEFT JOIN match_grade_breakdown_versions b
             ON b.game_id=r.game_id AND b.puuid=r.puuid
            AND b.participant_id=r.participant_id AND b.algorithm_version=r.algorithm_version
           WHERE r.status='ready' AND b.game_id IS NULL`),
        currentBreakdownsWithoutResult: countIf(["match_grade_results", "match_grade_breakdown_versions"],
          `SELECT COUNT(*) AS count FROM match_grade_breakdown_versions b
           LEFT JOIN match_grade_results r
             ON r.game_id=b.game_id AND r.puuid=b.puuid
            AND r.participant_id=b.participant_id AND r.algorithm_version=b.algorithm_version
           WHERE r.game_id IS NULL`),
        gradeVersionDistribution: tableNames.has("match_grade_results")
          ? db.prepare("SELECT algorithm_version AS version, status, COUNT(*) AS count FROM match_grade_results GROUP BY algorithm_version,status ORDER BY algorithm_version,status").all()
          : [],
      }
      process.stdout.write(`${JSON.stringify(report)}\n`)
      if (report.quickCheck !== "ok" || report.foreignKeyViolations ||
          report.invalidJsonRows || report.orphanRows || report.partialGradePairs ||
          report.eligibleCurrentGradesWithoutBreakdown || report.currentBreakdownsWithoutResult) {
        process.exitCode = 1
      }
    } finally {
      db.close()
    }
  }
}
