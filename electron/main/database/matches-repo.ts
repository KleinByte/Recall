import type { Database, Statement } from "better-sqlite3"
import type {
  MatchRow,
  ModeFamily,
  PerformanceLabel,
  TrackedMode,
} from "../matches/types.js"
import type { StyleAverages } from "../matches/style.js"
import { LABEL_EVALUATOR_VERSION } from "../matches/labels.js"
import {
  LEAGUE_CLASSIC_QUEUE_IDS,
  PERSONAL_RECORD_RIFT_QUEUE_IDS,
} from "../matches/eligibility.js"

export interface StatsFilter {
  puuid: string
  mode?: TrackedMode
  modes?: TrackedMode[]
  modeFamily?: ModeFamily
  sinceMs?: number
  untilMs?: number
  championIds?: number[]
  roles?: string[]
  excludeQueueIds?: number[]
  excludeLeagueClassic?: boolean
}

export interface StatsSummary {
  games: number
  wins: number
  losses: number
  winRate: number
  avgKills: number
  avgDeaths: number
  avgAssists: number
  kda: number
  avgDamageToChampions: number
  avgDamageTaken: number
  avgGold: number
  avgDurationSecs: number
  pentaKills: number
  currentStreak: number
  longestWinStreak: number
  /** Average grade z-score across graded games, or undefined if none. */
  avgGradeScore?: number
  gradedGames: number
}

export interface ChampionStatRow {
  championId: number
  games: number
  wins: number
  winRate: number
  avgKills: number
  avgDeaths: number
  avgAssists: number
  kda: number
  avgDamageToChampions: number
  /** Average grade z-score across this champion's graded games. */
  avgGradeScore?: number
  gradedGames: number
}

/** How many games to read, counting back from the most recent. */
export interface MatchWindow {
  limit?: number
  offset?: number
}

export interface PersonalRecord {
  key: string
  label: string
  value: number
  gameId: number
  championId: number
  playedAt: number
  mode: TrackedMode
}

/** The single best game for each of these is worth remembering. */
const RECORDS: { key: string; label: string; expression: string }[] = [
  { key: "kills", label: "Most kills", expression: "kills" },
  { key: "assists", label: "Most assists", expression: "assists" },
  { key: "damage", label: "Most damage", expression: "damage_to_champions" },
  { key: "gold", label: "Most gold", expression: "gold_earned" },
  {
    key: "spree",
    label: "Longest killing spree",
    expression: "largest_killing_spree",
  },
  {
    key: "cs",
    label: "Most creep score",
    expression: "total_minions_killed + neutral_minions",
  },
  {
    key: "kda",
    label: "Best KDA",
    expression: "(kills + assists) * 1.0 / MAX(1, deaths)",
  },
]

export interface GradeCount {
  grade: string
  count: number
}

export interface MatchQuery extends StatsFilter {
  modes?: TrackedMode[]
  rankedOnly?: boolean
  result?: "win" | "loss"
  minGradeScore?: number
  minDurationSecs?: number
  sortBy?: "played_at" | "kda" | "damage" | "grade" | "duration"
  sortDir?: "asc" | "desc"
  bookmarked?: boolean
  hasNotes?: boolean
  tagIds?: number[]
  experimentId?: number
}

export interface MatchPage {
  rows: MatchRow[]
  total: number
  page: number
  pageSize: number
}


const COLUMNS = [
  "game_id",
  "puuid",
  "queue_id",
  "game_mode",
  "mode",
  "is_matched",
  "played_at",
  "duration_secs",
  "game_version",
  "champion_id",
  "win",
  "kills",
  "deaths",
  "assists",
  "champ_level",
  "gold_earned",
  "damage_to_champions",
  "damage_taken",
  "damage_self_mitigated",
  "total_heal",
  "total_units_healed",
  "time_ccing_others",
  "largest_killing_spree",
  "largest_multi_kill",
  "double_kills",
  "triple_kills",
  "quadra_kills",
  "penta_kills",
  "total_minions_killed",
  "vision_score",
  "ended_in_surrender",
  "ended_in_early_surrender",
  "mode_family",
  "is_ranked",
  "lane",
  "role",
  "neutral_minions",
  "wards_placed",
  "wards_killed",
  "control_wards",
  "damage_objectives",
  "damage_turrets",
  "turret_kills",
  "inhibitor_kills",
  "first_blood",
  "cs_per_min",
  "gold_per_min",
  "queue_name",
  "riot_match_id",
] as const

const INSERT_SQL = `
  INSERT OR IGNORE INTO matches (${COLUMNS.join(", ")})
  VALUES (${COLUMNS.map(() => "?").join(", ")})
`

function toValues(row: MatchRow) {
  return [
    row.gameId,
    row.puuid,
    row.queueId,
    row.gameMode,
    row.mode,
    row.isMatched,
    row.playedAt,
    row.durationSecs,
    row.gameVersion,
    row.championId,
    row.win,
    row.kills,
    row.deaths,
    row.assists,
    row.champLevel,
    row.goldEarned,
    row.damageToChampions,
    row.damageTaken,
    row.damageSelfMitigated,
    row.totalHeal,
    row.totalUnitsHealed,
    row.timeCcingOthers,
    row.largestKillingSpree,
    row.largestMultiKill,
    row.doubleKills,
    row.tripleKills,
    row.quadraKills,
    row.pentaKills,
    row.totalMinionsKilled,
    row.visionScore,
    row.endedInSurrender,
    row.endedInEarlySurrender,
    row.modeFamily,
    row.isRanked,
    row.lane ?? null,
    row.role ?? null,
    row.neutralMinions,
    row.wardsPlaced,
    row.wardsKilled,
    row.controlWards,
    row.damageObjectives,
    row.damageTurrets,
    row.turretKills,
    row.inhibitorKills,
    row.firstBlood,
    row.csPerMin,
    row.goldPerMin,
    row.queueName ?? null,
    row.riotMatchId ?? null,
  ]
}

export class MatchesRepository {
  private readonly insertStatement: Statement

  constructor(private readonly db: Database) {
    this.insertStatement = db.prepare(INSERT_SQL)
  }

  /**
   * Stores matches, skipping any already recorded.
   *
   * Sync repeatedly re-reads the client's rolling 20-game window, so the same
   * games arrive many times. `INSERT OR IGNORE` against the
   * `(game_id, puuid)` primary key makes that free.
   *
   * @returns how many rows were newly stored.
   */
  insertMany(rows: MatchRow[]): number {
    if (rows.length === 0) return 0

    const insertAll = this.db.transaction((batch: MatchRow[]) => {
      let inserted = 0
      for (const row of batch) {
        inserted += this.insertStatement.run(toValues(row)).changes
      }
      return inserted
    })

    return insertAll(rows)
  }

  countMatches(puuid: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS total FROM matches WHERE puuid = ?")
      .get(puuid) as { total: number }

    return row.total
  }

  getMatch(gameId: number, puuid: string): MatchRow | undefined {
    const row = this.db
      .prepare("SELECT * FROM matches WHERE game_id = ? AND puuid = ?")
      .get(gameId, puuid) as Record<string, never> | undefined
    return row ? toMatchRow(row) : undefined
  }

  setRiotMatchId(gameId: number, puuid: string, riotMatchId: string) {
    this.db
      .prepare(
        "UPDATE matches SET riot_match_id = ? WHERE game_id = ? AND puuid = ?",
      )
      .run(riotMatchId, gameId, puuid)
  }

  needsLabelEvaluation(
    gameId: number,
    puuid: string,
    evaluatorVersion = LABEL_EVALUATOR_VERSION,
  ): boolean {
    const row = this.db.prepare(
      `SELECT evaluator_version AS evaluatorVersion, status
       FROM match_label_evaluations
       WHERE game_id = ? AND puuid = ?`,
    ).get(gameId, puuid) as
      | { evaluatorVersion: number; status: "ready" | "unavailable" }
      | undefined

    return !row || row.evaluatorVersion < evaluatorVersion
  }

  markLabelsUnavailable(
    gameId: number,
    puuid: string,
    evaluatorVersion = LABEL_EVALUATOR_VERSION,
    now = Date.now(),
  ) {
    const mark = this.db.transaction(() => {
      this.db.prepare(
        "DELETE FROM match_performance_labels WHERE game_id = ? AND puuid = ?",
      ).run(gameId, puuid)
      this.db.prepare(
        `INSERT INTO match_label_evaluations
         (game_id, puuid, evaluator_version, source, status, evaluated_at)
         VALUES (?, ?, ?, 'match_v5', 'unavailable', ?)
         ON CONFLICT(game_id, puuid) DO UPDATE SET
           evaluator_version = excluded.evaluator_version,
           source = excluded.source,
           status = excluded.status,
           evaluated_at = excluded.evaluated_at`,
      ).run(gameId, puuid, evaluatorVersion, now)
    })
    mark()
  }

  replacePerformanceLabels(
    gameId: number,
    puuid: string,
    labels: PerformanceLabel[],
    evaluatorVersion = LABEL_EVALUATOR_VERSION,
    now = Date.now(),
  ) {
    const replace = this.db.transaction(() => {
      this.db.prepare(
        "DELETE FROM match_performance_labels WHERE game_id = ? AND puuid = ?",
      ).run(gameId, puuid)

      const insert = this.db.prepare(
        `INSERT INTO match_performance_labels
         (game_id, puuid, label_id, name, category, polarity, tooltip,
          evidence_json, source, confidence, priority, evaluator_version,
          created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const label of labels) {
        insert.run(
          gameId,
          puuid,
          label.id,
          label.name,
          label.category,
          label.polarity,
          label.tooltip,
          JSON.stringify(label.evidence),
          label.source,
          label.confidence,
          label.priority,
          evaluatorVersion,
          now,
        )
      }

      this.db.prepare(
        `INSERT INTO match_label_evaluations
         (game_id, puuid, evaluator_version, source, status, evaluated_at)
         VALUES (?, ?, ?, ?, 'ready', ?)
         ON CONFLICT(game_id, puuid) DO UPDATE SET
           evaluator_version = excluded.evaluator_version,
           source = excluded.source,
           status = excluded.status,
           evaluated_at = excluded.evaluated_at`,
      ).run(
        gameId,
        puuid,
        evaluatorVersion,
        labels.some((label) => label.source === "timeline") ? "timeline" : "match_v5",
        now,
      )
    })
    replace()
  }

  getPerformanceLabels(gameId: number, puuid: string): PerformanceLabel[] {
    const rows = this.db.prepare(
      `SELECT label_id AS id, name, category, polarity, tooltip,
              evidence_json AS evidenceJson, source, confidence, priority
       FROM match_performance_labels
       WHERE game_id = ? AND puuid = ?
       ORDER BY priority DESC, label_id`,
    ).all(gameId, puuid) as Array<Omit<PerformanceLabel, "evidence"> & {
      evidenceJson: string
    }>

    return rows.map(({ evidenceJson, ...row }) => {
      try {
        return { ...row, evidence: JSON.parse(evidenceJson) }
      } catch {
        return { ...row, evidence: {} }
      }
    })
  }

  hasCompleteMatch(gameId: number, puuid: string): boolean {
    const row = this.db
      .prepare(
        `SELECT mode_family AS modeFamily, grade
         FROM matches WHERE game_id = ? AND puuid = ? LIMIT 1`,
      )
      .get(gameId, puuid) as
      | { modeFamily: ModeFamily; grade: string | null }
      | undefined

    return (
      row !== undefined &&
      (row.modeFamily === "other" || row.grade !== null)
    )
  }

  getOldestPlayedAt(puuid: string): number | undefined {
    const row = this.db
      .prepare("SELECT MIN(played_at) AS oldest FROM matches WHERE puuid = ?")
      .get(puuid) as { oldest: number | null }

    return row.oldest ?? undefined
  }

  /** Records a grade derived from the full lobby for one stored match. */
  setGrade(gameId: number, puuid: string, grade: string, score: number) {
    this.db
      .prepare(
        "UPDATE matches SET grade = ?, grade_score = ? WHERE game_id = ? AND puuid = ?",
      )
      .run(grade, score, gameId, puuid)
  }

  /**
   * Matches stored without a grade.
   *
   * Grading needs an extra request per game for the full lobby, so it is done
   * separately from recording the match itself. Newest games are graded first
   * because older ones fall out of the client's history and can never be
   * graded afterwards.
   */
  getUngradedMatches(
    puuid: string,
    limit: number,
  ): { gameId: number; modeFamily: ModeFamily }[] {
    return this.db
      .prepare(
        `SELECT game_id AS gameId, mode_family AS modeFamily FROM matches
         WHERE puuid = ? AND is_matched = 1 AND grade IS NULL
           AND mode_family IN ('sr', 'aram')
         ORDER BY played_at DESC
         LIMIT ?`,
      )
      .all(puuid, limit) as { gameId: number; modeFamily: ModeFamily }[]
  }

  /**
   * How often each grade was earned.
   *
   * Takes the same query as the match list so a page can describe exactly the
   * games it is showing, right down to a single champion.
   */
  getGradeDistribution(query: MatchQuery): GradeCount[] {
    const { clause, params } = buildQuery(query)

    return this.db
      .prepare(
        `SELECT grade, COUNT(*) AS count FROM matches ${clause}
           AND grade IS NOT NULL
         GROUP BY grade`,
      )
      .all(...params) as GradeCount[]
  }

  /**
   * Aggregate statistics for a set of matches.
   *
   * It accepts the same query the match list uses, so a page can show totals
   * that describe exactly the games it is displaying.
   */
  getSummary(query: MatchQuery): StatsSummary {
    const { clause, params } = buildQuery(query)

    const totals = this.db
      .prepare(
        `SELECT
           COUNT(*)                  AS games,
           COALESCE(SUM(win), 0)     AS wins,
           COALESCE(SUM(kills), 0)   AS kills,
           COALESCE(SUM(deaths), 0)  AS deaths,
           COALESCE(SUM(assists), 0) AS assists,
           COALESCE(AVG(kills), 0)   AS avgKills,
           COALESCE(AVG(deaths), 0)  AS avgDeaths,
           COALESCE(AVG(assists), 0) AS avgAssists,
           COALESCE(AVG(damage_to_champions), 0) AS avgDamageToChampions,
           COALESCE(AVG(damage_taken), 0)        AS avgDamageTaken,
           COALESCE(AVG(gold_earned), 0)         AS avgGold,
           COALESCE(AVG(duration_secs), 0)       AS avgDurationSecs,
           COALESCE(SUM(penta_kills), 0)         AS pentaKills,
           AVG(grade_score)                      AS avgGradeScore,
           COUNT(grade)                          AS gradedGames
         FROM matches ${clause}`,
      )
      .get(...params) as Record<string, number>

    const results = this.db
      .prepare(
        `SELECT win FROM matches ${clause} ORDER BY played_at DESC, game_id DESC`,
      )
      .all(...params) as { win: number }[]

    const games = totals.games

    return {
      games,
      wins: totals.wins,
      losses: games - totals.wins,
      winRate: games === 0 ? 0 : totals.wins / games,
      avgKills: totals.avgKills,
      avgDeaths: totals.avgDeaths,
      avgAssists: totals.avgAssists,
      kda: computeKda(totals.kills, totals.deaths, totals.assists),
      avgDamageToChampions: totals.avgDamageToChampions,
      avgDamageTaken: totals.avgDamageTaken,
      avgGold: totals.avgGold,
      avgDurationSecs: totals.avgDurationSecs,
      pentaKills: totals.pentaKills,
      avgGradeScore: totals.avgGradeScore ?? undefined,
      gradedGames: totals.gradedGames,
      currentStreak: computeCurrentStreak(results.map((row) => row.win === 1)),
      longestWinStreak: computeLongestWinStreak(
        results.map((row) => row.win === 1),
      ),
    }
  }

  getChampionStats(filter: StatsFilter): ChampionStatRow[] {
    const { clause, params } = buildFilter(filter)

    const rows = this.db
      .prepare(
        `SELECT
           champion_id               AS championId,
           COUNT(*)                  AS games,
           COALESCE(SUM(win), 0)     AS wins,
           COALESCE(SUM(kills), 0)   AS totalKills,
           COALESCE(SUM(deaths), 0)  AS totalDeaths,
           COALESCE(SUM(assists), 0) AS totalAssists,
           COALESCE(AVG(kills), 0)   AS avgKills,
           COALESCE(AVG(deaths), 0)  AS avgDeaths,
           COALESCE(AVG(assists), 0) AS avgAssists,
           COALESCE(AVG(damage_to_champions), 0) AS avgDamageToChampions,
           AVG(grade_score)                      AS avgGradeScore,
           COUNT(grade)                          AS gradedGames
         FROM matches ${clause}
         GROUP BY champion_id
         ORDER BY games DESC, wins DESC`,
      )
      .all(...params) as Record<string, number>[]

    return rows.map((row) => ({
      championId: row.championId,
      games: row.games,
      wins: row.wins,
      winRate: row.games === 0 ? 0 : row.wins / row.games,
      avgKills: row.avgKills,
      avgDeaths: row.avgDeaths,
      avgAssists: row.avgAssists,
      kda: computeKda(row.totalKills, row.totalDeaths, row.totalAssists),
      avgDamageToChampions: row.avgDamageToChampions,
      avgGradeScore: row.avgGradeScore ?? undefined,
      gradedGames: row.gradedGames,
    }))
  }

  /**
   * Per-game averages describing how the player plays.
   *
   * Every proportion is worked out for each game and only then averaged, so a
   * single very long game cannot outweigh the rest. The maths runs in SQL
   * because history is unbounded and there is no reason to carry thousands of
   * rows into memory to average them.
   *
   * `window` reads a slice counting back from the most recent game, which is
   * how the page compares recent form against everything before it.
   */
  getStyleAverages(
    query: MatchQuery,
    window: MatchWindow = {},
  ): StyleAverages | undefined {
    const { clause, params } = buildQuery(query)

    // A negative limit means no limit in SQLite, and an offset needs one.
    const limit = window.limit ?? -1
    const offset = window.offset ?? 0

    // Guards a zero divisor rather than returning null and poisoning the row.
    const ratio = (part: string, whole: string) =>
      `CASE WHEN (${whole}) > 0 THEN (${part}) * 1.0 / (${whole}) ELSE 0 END`

    const perMinute = (column: string) =>
      `${column} * 60.0 / MAX(1, duration_secs)`

    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS games,
           COALESCE(AVG(${ratio("kills", "kills + assists")}), 0) AS aggression,
           COALESCE(AVG(${ratio(
             "damage_to_champions",
             "damage_to_champions + damage_taken",
           )}), 0) AS damage,
           COALESCE(AVG(${ratio(
             "damage_self_mitigated",
             "damage_self_mitigated + damage_taken",
           )}), 0) AS durability,
           0 AS farming,
           COALESCE(AVG(${ratio(
             "damage_objectives",
             "damage_objectives + damage_to_champions",
           )}), 0) AS objectives,
           COALESCE(AVG(${ratio(
             "total_heal",
             "total_heal + damage_taken",
           )}), 0) AS sustain,
           COALESCE(AVG(${perMinute("vision_score")}), 0)        AS visionPerMin,
           COALESCE(AVG(${perMinute("time_ccing_others")}), 0)   AS ccPerMin,
           COALESCE(AVG(${perMinute("damage_to_champions")}), 0) AS damagePerMin,
           COALESCE(AVG(gold_per_min), 0)   AS goldPerMin,
           COALESCE(AVG(cs_per_min), 0)     AS csPerMin,
           COALESCE(AVG(deaths), 0)         AS avgDeaths,
           COALESCE(AVG(largest_killing_spree), 0) AS avgLargestSpree,
           COALESCE(SUM(double_kills), 0)   AS doubleKills,
           COALESCE(SUM(triple_kills), 0)   AS tripleKills,
           COALESCE(SUM(quadra_kills), 0)   AS quadraKills,
           COALESCE(SUM(penta_kills), 0)    AS pentaKills
         FROM (
           SELECT * FROM matches ${clause}
           ORDER BY played_at DESC, game_id DESC
           LIMIT ? OFFSET ?
         )`,
      )
      .get(...params, limit, offset) as StyleAverages

    return row.games === 0 ? undefined : row
  }

  getRecentMatches(filter: StatsFilter, limit: number): MatchRow[] {
    const { clause, params } = buildFilter(filter)

    const rows = this.db
      .prepare(
        `SELECT * FROM matches ${clause}
         ORDER BY played_at DESC, game_id DESC
         LIMIT ?`,
      )
      .all(...params, limit) as Record<string, never>[]

    return rows.map(toMatchRow)
  }

  /** Recent win/loss flags ordered oldest to newest, for the form strip. */
  getRecentForm(filter: StatsFilter, limit: number): boolean[] {
    const { clause, params } = buildFilter(filter)

    const rows = this.db
      .prepare(
        `SELECT win FROM matches ${clause}
         ORDER BY played_at DESC, game_id DESC
         LIMIT ?`,
      )
      .all(...params, limit) as { win: number }[]

    return rows.map((row) => row.win === 1).reverse()
  }

  getAllMatches(puuid: string): MatchRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM matches
         WHERE puuid = ? AND is_matched = 1
         ORDER BY played_at DESC`,
      )
      .all(puuid) as Record<string, never>[]

    return rows.map(toMatchRow)
  }

  /**
   * A page of match history.
   *
   * The database keeps every game ever played, so the renderer is never given
   * the whole table. Paging and counting both run in SQL against the same
   * filter, which keeps the reported total honest.
   */
  listMatches(
    query: MatchQuery,
    page: number,
    pageSize: number,
  ): MatchPage {
    const { clause, params } = buildQuery(query)

    const { total } = this.db
      .prepare(`SELECT COUNT(*) AS total FROM matches ${clause}`)
      .get(...params) as { total: number }

    const size = Math.max(1, pageSize)
    const lastPage = Math.max(1, Math.ceil(total / size))
    const current = Math.min(Math.max(1, page), lastPage)

    const rows = this.db
      .prepare(
        `SELECT matches.*,
                EXISTS (
                  SELECT 1 FROM match_annotations ma
                  WHERE ma.game_id = matches.game_id AND ma.puuid = matches.puuid
                    AND ma.bookmarked = 1
                ) AS bookmarked,
                EXISTS (
                  SELECT 1 FROM match_annotations ma
                  WHERE ma.game_id = matches.game_id AND ma.puuid = matches.puuid
                    AND LENGTH(TRIM(ma.note)) > 0
                ) AS has_note,
                COALESCE((
                  SELECT GROUP_CONCAT(t.name, ' · ')
                  FROM match_annotation_tags mat
                  JOIN annotation_tags t ON t.id = mat.tag_id
                  WHERE mat.game_id = matches.game_id AND mat.puuid = matches.puuid
                ), '') AS tag_names,
                COALESCE((
                  SELECT GROUP_CONCAT(name, ' · ')
                  FROM (
                    SELECT mpl.name
                    FROM match_performance_labels mpl
                    WHERE mpl.game_id = matches.game_id
                      AND mpl.puuid = matches.puuid
                    ORDER BY mpl.priority DESC, mpl.label_id
                    LIMIT 6
                  )
                ), '') AS label_names,
                (SELECT COUNT(*) FROM match_experiments me
                 WHERE me.game_id = matches.game_id AND me.puuid = matches.puuid)
                  AS experiment_count,
                (SELECT mp.assigned_position FROM match_participants mp
                 WHERE mp.game_id = matches.game_id AND mp.puuid = matches.puuid
                   AND mp.is_player = 1)
                  AS assigned_position,
                ${LOBBY_PLACE_SQL}
         FROM matches ${clause}
         ORDER BY ${orderBy(query)}
         LIMIT ? OFFSET ?`,
      )
      .all(...params, size, (current - 1) * size) as Record<string, never>[]

    return { rows: rows.map(toMatchRow), total, page: current, pageSize: size }
  }

  /**
   * The best single game for each record the Progress page shows.
   *
   * Each record is resolved in one query so the game behind it can be named,
   * rather than reporting a number with no story attached.
   */
  getRecords(filter: StatsFilter): PersonalRecord[] {
    const { clause, params } = buildFilter({
      ...filter,
      excludeLeagueClassic: true,
    })
    const eligibleModes = `(
      mode IN ('aram', 'mayhem')
      OR queue_id IN (${PERSONAL_RECORD_RIFT_QUEUE_IDS.join(", ")})
    )`

    return RECORDS.flatMap(({ key, label, expression }) => {
      const row = this.db
        .prepare(
          `SELECT game_id AS gameId, champion_id AS championId,
                  played_at AS playedAt, mode, ${expression} AS value
           FROM matches ${clause} AND ${eligibleModes}
           ORDER BY value DESC, game_id DESC
           LIMIT 1`,
        )
        .get(...params) as PersonalRecord | undefined

      return row ? [{ ...row, key, label }] : []
    })
  }

  /** How long one recorded game ran, for scoring that game on its own. */
  getMatchDuration(gameId: number, puuid: string): number {
    const row = this.db
      .prepare(
        "SELECT duration_secs AS durationSecs FROM matches WHERE game_id = ? AND puuid = ?",
      )
      .get(gameId, puuid) as { durationSecs: number } | undefined

    return row?.durationSecs ?? 0
  }

  /** Champions the player has actually played, for filter options. */
  getPlayedChampionIds(puuid: string): number[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT champion_id AS id FROM matches
         WHERE puuid = ? AND is_matched = 1`,
      )
      .all(puuid) as { id: number }[]

    return rows.map((row) => row.id)
  }

  deleteAll(puuid: string): number {
    return this.db.transaction(() => {
      // Live captures intentionally have no match foreign key because they
      // are written before the post-game match row exists.
      this.db.prepare("DELETE FROM live_game_events WHERE puuid = ?").run(puuid)
      this.db.prepare("DELETE FROM live_game_snapshots WHERE puuid = ?").run(puuid)
      return this.db.prepare("DELETE FROM matches WHERE puuid = ?").run(puuid)
        .changes
    })()
  }
}

/**
 * Sortable columns, resolved through a fixed map.
 *
 * A column name cannot be a bound parameter, so anything reaching the SQL text
 * must come from this table rather than from the caller.
 */
const SORT_COLUMNS: Record<string, string> = {
  played_at: "played_at",
  kda: "(kills + assists) * 1.0 / MAX(1, deaths)",
  damage: "damage_to_champions",
  grade: "grade_score",
  duration: "duration_secs",
}

/**
 * Where the player finished among the ten, ranked by Recall grade.
 *
 * Mirrors `lobbyStandings` in the renderer, including its refusal to place
 * anyone in a lobby that is not graded end to end: a partial order would
 * flatter whoever happens to have a grade. Zero means no placement.
 */
const LOBBY_PLACE_SQL = `
  COALESCE((
    SELECT CASE
      WHEN COUNT(*) < 2 OR SUM(lobby.grade_score IS NULL) > 0 THEN 0
      ELSE SUM(
        lobby.grade_score > me.grade_score
        OR (lobby.grade_score = me.grade_score
            AND lobby.participant_id < me.participant_id)
      ) + 1
    END
    FROM match_participants lobby
    JOIN match_participants me
      ON me.game_id = lobby.game_id AND me.puuid = lobby.puuid AND me.is_player = 1
    WHERE lobby.game_id = matches.game_id AND lobby.puuid = matches.puuid
  ), 0) AS lobby_place,
  COALESCE((
    SELECT COUNT(*) FROM match_participants mp
    WHERE mp.game_id = matches.game_id AND mp.puuid = matches.puuid
  ), 0) AS lobby_size`

function orderBy(query: MatchQuery): string {
  const column = SORT_COLUMNS[query.sortBy ?? "played_at"] ?? "played_at"
  const direction = query.sortDir === "asc" ? "ASC" : "DESC"

  // game_id breaks ties so paging cannot repeat or skip a row.
  return `${column} ${direction}, game_id ${direction}`
}

function buildQuery(query: MatchQuery) {
  const { clause, params } = buildFilter(query)
  const conditions = [clause.replace(/^WHERE /, "")]

  if (query.modes?.length) {
    conditions.push(`mode IN (${query.modes.map(() => "?").join(", ")})`)
    params.push(...query.modes)
  }

  if (query.rankedOnly) conditions.push("is_ranked = 1")

  if (query.result === "win") conditions.push("win = 1")
  if (query.result === "loss") conditions.push("win = 0")

  if (query.minGradeScore !== undefined) {
    conditions.push("grade_score >= ?")
    params.push(query.minGradeScore)
  }

  if (query.minDurationSecs !== undefined) {
    conditions.push("duration_secs >= ?")
    params.push(query.minDurationSecs)
  }

  if (query.bookmarked !== undefined) {
    conditions.push(
      `${query.bookmarked ? "" : "NOT "}EXISTS (
        SELECT 1 FROM match_annotations ma
        WHERE ma.game_id = matches.game_id AND ma.puuid = matches.puuid
          AND ma.bookmarked = 1
      )`,
    )
  }

  if (query.hasNotes !== undefined) {
    conditions.push(
      `${query.hasNotes ? "" : "NOT "}EXISTS (
        SELECT 1 FROM match_annotations ma
        WHERE ma.game_id = matches.game_id AND ma.puuid = matches.puuid
          AND LENGTH(TRIM(ma.note)) > 0
      )`,
    )
  }

  if (query.tagIds?.length) {
    conditions.push(
      `EXISTS (
        SELECT 1 FROM match_annotation_tags mat
        WHERE mat.game_id = matches.game_id AND mat.puuid = matches.puuid
          AND mat.tag_id IN (${query.tagIds.map(() => "?").join(", ")})
      )`,
    )
    params.push(...query.tagIds)
  }

  if (query.experimentId !== undefined) {
    conditions.push(
      `EXISTS (
        SELECT 1 FROM match_experiments me
        WHERE me.game_id = matches.game_id AND me.puuid = matches.puuid
          AND me.experiment_id = ?
      )`,
    )
    params.push(query.experimentId)
  }

  return { clause: `WHERE ${conditions.join(" AND ")}`, params }
}

function buildFilter(filter: StatsFilter) {
  const conditions = ["puuid = ?", "is_matched = 1"]
  const params: (string | number)[] = [filter.puuid]

  if (filter.mode) {
    conditions.push("mode = ?")
    params.push(filter.mode)
  } else if (filter.modes?.length) {
    conditions.push(`mode IN (${filter.modes.map(() => "?").join(", ")})`)
    params.push(...filter.modes)
  }

  if (filter.modeFamily) {
    conditions.push("mode_family = ?")
    params.push(filter.modeFamily)
  }

  if (filter.sinceMs !== undefined) {
    conditions.push("played_at >= ?")
    params.push(filter.sinceMs)
  }

  if (filter.untilMs !== undefined) {
    conditions.push("played_at <= ?")
    params.push(filter.untilMs)
  }

  if (filter.championIds?.length) {
    conditions.push(
      `champion_id IN (${filter.championIds.map(() => "?").join(", ")})`,
    )
    params.push(...filter.championIds)
  }

  if (filter.roles?.length) {
    conditions.push(
      `${normalizedRole()} IN (${filter.roles.map(() => "?").join(", ")})`,
    )
    params.push(...filter.roles)
  }

  if (filter.excludeQueueIds?.length) {
    conditions.push(
      `queue_id NOT IN (${filter.excludeQueueIds.map(() => "?").join(", ")})`,
    )
    params.push(...filter.excludeQueueIds)
  }

  if (filter.excludeLeagueClassic) {
    conditions.push(
      `NOT (
        queue_id IN (${LEAGUE_CLASSIC_QUEUE_IDS.join(", ")})
        OR (
          UPPER(COALESCE(game_mode, '')) = 'CLASSIC'
          AND LOWER(COALESCE(queue_name, '')) LIKE '%classic%'
        )
      )`,
    )
  }

  return { clause: `WHERE ${conditions.join(" AND ")}`, params }
}

/**
 * Normalizes Match-V5 positions and older LCU lane/role pairs. Twin of
 * `resolvePosition` in the renderer, and must be changed alongside it.
 */
function normalizedRole(alias = ""): string {
  const prefix = alias ? `${alias}.` : ""
  return `CASE
    WHEN UPPER(COALESCE(${prefix}role, '')) IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')
      THEN UPPER(${prefix}role)
    WHEN UPPER(COALESCE(${prefix}lane, '')) IN ('BOTTOM', 'BOT') THEN
      CASE WHEN UPPER(COALESCE(${prefix}role, '')) IN ('SUPPORT', 'DUO_SUPPORT')
        THEN 'UTILITY' ELSE 'BOTTOM' END
    WHEN UPPER(COALESCE(${prefix}lane, '')) IN ('TOP', 'JUNGLE', 'MIDDLE')
      THEN UPPER(${prefix}lane)
    ELSE NULL
  END`
}

/**
 * Kills plus assists per death. A record with no deaths has no meaningful
 * divisor, so the raw kill participation is used instead.
 */
function computeKda(kills: number, deaths: number, assists: number): number {
  if (kills + deaths + assists === 0) return 0
  if (deaths === 0) return kills + assists
  return (kills + assists) / deaths
}

/** Positive for a winning streak, negative for a losing one. */
function computeCurrentStreak(newestFirst: boolean[]): number {
  if (newestFirst.length === 0) return 0

  const streakIsWin = newestFirst[0]
  let length = 0

  for (const won of newestFirst) {
    if (won !== streakIsWin) break
    length += 1
  }

  return streakIsWin ? length : -length
}

function computeLongestWinStreak(results: boolean[]): number {
  let longest = 0
  let running = 0

  for (const won of results) {
    running = won ? running + 1 : 0
    longest = Math.max(longest, running)
  }

  return longest
}

function toMatchRow(row: Record<string, never>): MatchRow {
  return {
    gameId: row.game_id,
    puuid: row.puuid,
    queueId: row.queue_id,
    gameMode: row.game_mode,
    mode: row.mode,
    isMatched: row.is_matched,
    playedAt: row.played_at,
    durationSecs: row.duration_secs,
    gameVersion: row.game_version,
    championId: row.champion_id,
    win: row.win,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    champLevel: row.champ_level,
    goldEarned: row.gold_earned,
    damageToChampions: row.damage_to_champions,
    damageTaken: row.damage_taken,
    damageSelfMitigated: row.damage_self_mitigated,
    totalHeal: row.total_heal,
    totalUnitsHealed: row.total_units_healed,
    timeCcingOthers: row.time_ccing_others,
    largestKillingSpree: row.largest_killing_spree,
    largestMultiKill: row.largest_multi_kill,
    doubleKills: row.double_kills,
    tripleKills: row.triple_kills,
    quadraKills: row.quadra_kills,
    pentaKills: row.penta_kills,
    totalMinionsKilled: row.total_minions_killed,
    visionScore: row.vision_score,
    endedInSurrender: row.ended_in_surrender,
    endedInEarlySurrender: row.ended_in_early_surrender,
    grade: row.grade ?? undefined,
    gradeScore: row.grade_score ?? undefined,
    modeFamily: row.mode_family,
    isRanked: row.is_ranked,
    lane: row.lane ?? undefined,
    role: row.role ?? undefined,
    assignedPosition: row.assigned_position ?? undefined,
    neutralMinions: row.neutral_minions,
    wardsPlaced: row.wards_placed,
    wardsKilled: row.wards_killed,
    controlWards: row.control_wards,
    damageObjectives: row.damage_objectives,
    damageTurrets: row.damage_turrets,
    turretKills: row.turret_kills,
    inhibitorKills: row.inhibitor_kills,
    firstBlood: row.first_blood,
    csPerMin: row.cs_per_min,
    goldPerMin: row.gold_per_min,
    queueName: row.queue_name ?? undefined,
    riotMatchId: row.riot_match_id ?? undefined,
    bookmarked: row.bookmarked === undefined ? undefined : row.bookmarked === 1,
    hasNote: row.has_note === undefined ? undefined : row.has_note === 1,
    tagNames: typeof row.tag_names === "string" && row.tag_names
      ? (row.tag_names as unknown as string).split(" · ")
      : undefined,
    labelNames: typeof row.label_names === "string" && row.label_names
      ? (row.label_names as unknown as string).split(" · ")
      : undefined,
    experimentCount: row.experiment_count ?? undefined,
    lobbyPlace: row.lobby_place || undefined,
    lobbySize: row.lobby_size || undefined,
  }
}
