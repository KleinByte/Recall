import type { Database } from "better-sqlite3"
import type { StatsFilter } from "./matches-repo.js"
import { durationBucketsFor } from "../matches/insights.js"
import { computePerGameAxes } from "../matches/style.js"
import type { ModeFamily, TrackedMode } from "../matches/types.js"
import type { GradeComponent } from "../review/types.js"

export interface BucketRow {
  label: string
  games: number
  wins: number
  winRate: number
  avgGradeScore?: number
}

export interface TimeBucketRow {
  label: string
  games: number
  wins: number
  winRate: number
}

export interface StreakBehaviour {
  afterWin: TimeBucketRow
  afterLoss: TimeBucketRow
}

export interface ContributionShare {
  games: number
  damageShare: number
  goldShare: number
  killShare: number
}

export interface ChampionPool {
  champions: number
  games: number
  coreShare: number
  coreWinRate: number
  restWinRate: number
  top: Array<{ championId: number; games: number; wins: number }>
}

export interface BuiltItem {
  itemId: number
  games: number
  wins: number
  winRate: number
}

export interface InsightMetrics {
  kda: number
  deaths: number
  damagePerMinute: number
  damageTakenPerMinute: number
  goldPerMinute: number
  csPerMinute: number
  visionPerMinute?: number
  objectiveDamagePerMinute?: number
  ccPerMinute: number
  killParticipation?: number
  teamDamageShare?: number
  allyHealShieldPerMinute?: number
}

export interface InsightObservation {
  gameId: number
  playedAt: number
  endedAt?: number
  mode: TrackedMode
  family: ModeFamily
  queueId: number
  win: boolean
  grade?: string
  gradeScore?: number
  championId: number
  role?: string
  durationSecs: number
  completeLobby: boolean
  metrics: InsightMetrics
  styleAxes: Record<string, number>
}

export interface GradeComponentObservation {
  gameId: number
  playedAt: number
  grade?: string
  gradeScore?: number
  compositePercentile: number
  components: GradeComponent[]
}

export interface FinalItemObservation {
  gameId: number
  championId: number
  role?: string
  gradeScore?: number
  itemIds: number[]
}

/** Three-hour blocks, which stay readable with a small history. */
const HOUR_BLOCKS = [
  "00–03",
  "03–06",
  "06–09",
  "09–12",
  "12–15",
  "15–18",
  "18–21",
  "21–24",
]

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** How many champions count as the player's core pool. */
const CORE_POOL_SIZE = 5

/** Slots 0–5 are the build; slot 6 is the trinket, which is not a purchase. */
const BUILD_SLOTS = ["item0", "item1", "item2", "item3", "item4", "item5"]

function scope(filter: StatsFilter) {
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

  return { where: `WHERE ${conditions.join(" AND ")}`, params }
}

/** Conditions against the participant table, optionally narrowed by mode. */
function lobbyScope(filter: StatsFilter) {
  const conditions = ["p.puuid = ?", "COALESCE(m.is_matched, 1) = 1"]
  const params: (string | number)[] = [filter.puuid]

  if (filter.mode) {
    conditions.push("m.mode = ?")
    params.push(filter.mode)
  } else if (filter.modes?.length) {
    conditions.push(`m.mode IN (${filter.modes.map(() => "?").join(", ")})`)
    params.push(...filter.modes)
  }

  if (filter.modeFamily) {
    conditions.push("m.mode_family = ?")
    params.push(filter.modeFamily)
  }

  return { conditions, params }
}

const rate = (wins: number, games: number) => (games === 0 ? 0 : wins / games)

/**
 * Questions about a player's record that need more than a running total.
 *
 * Each answer states how many games it rests on, because with a few dozen
 * games most of these are suggestive rather than conclusive, and the caller
 * needs to be able to say so.
 */
export class InsightsRepository {
  constructor(readonly db: Database) {}

  /**
   * Results by how long the game ran.
   *
   * Empty bands are kept, so the shape of the answer never depends on the
   * data and a chart does not reshuffle itself as history accumulates.
   */
  getDurationBuckets(filter: StatsFilter, family: ModeFamily): BucketRow[] {
    const { where, params } = scope(filter)

    const total = this.db
      .prepare(`SELECT COUNT(*) AS games FROM matches ${where}`)
      .get(...params) as { games: number }

    if (total.games === 0) return []

    let floor = 0

    return durationBucketsFor(family).map((bucket) => {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) AS games, COALESCE(SUM(win), 0) AS wins,
                  AVG(grade_score) AS avgGradeScore
           FROM matches ${where}
             AND duration_secs >= ? AND duration_secs < ?`,
        )
        .get(...params, floor, bucket.maxSecs) as {
        games: number
        wins: number
        avgGradeScore: number | null
      }

      floor = bucket.maxSecs

      return {
        label: bucket.label,
        games: row.games,
        wins: row.wins,
        winRate: rate(row.wins, row.games),
        avgGradeScore: row.avgGradeScore ?? undefined,
      }
    })
  }

  /**
   * Results by when the game was played, in the player's own timezone.
   *
   * Hours and weekdays are reported separately rather than as a grid: a 7 × 24
   * heatmap needs hundreds of games before it says anything at all.
   */
  getTimeOfDay(filter: StatsFilter): {
    hours: TimeBucketRow[]
    weekdays: TimeBucketRow[]
  } {
    const { where, params } = scope(filter)

    const rows = this.db
      .prepare(
        `SELECT
           CAST(strftime('%H', played_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
           CAST(strftime('%w', played_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS weekday,
           COUNT(*) AS games,
           COALESCE(SUM(win), 0) AS wins
         FROM matches ${where}
         GROUP BY hour, weekday`,
      )
      .all(...params) as {
      hour: number
      weekday: number
      games: number
      wins: number
    }[]

    if (rows.length === 0) return { hours: [], weekdays: [] }

    const hours = HOUR_BLOCKS.map((label) => ({
      label,
      games: 0,
      wins: 0,
      winRate: 0,
    }))
    const weekdays = WEEKDAYS.map((label) => ({
      label,
      games: 0,
      wins: 0,
      winRate: 0,
    }))

    for (const row of rows) {
      const block = hours[Math.floor(row.hour / 3)]
      block.games += row.games
      block.wins += row.wins

      const day = weekdays[row.weekday]
      day.games += row.games
      day.wins += row.wins
    }

    for (const entry of [...hours, ...weekdays]) {
      entry.winRate = rate(entry.wins, entry.games)
    }

    return { hours, weekdays }
  }

  /**
   * How the player does after a win compared with after a loss.
   *
   * `LAG` reads the previous game in play order, which answers the question
   * without pulling the whole history into memory to walk it.
   */
  getStreakBehaviour(filter: StatsFilter): StreakBehaviour | undefined {
    const { where, params } = scope(filter)

    const rows = this.db
      .prepare(
        `SELECT previous, COUNT(*) AS games, COALESCE(SUM(win), 0) AS wins
         FROM (
           SELECT win,
                  LAG(win) OVER (ORDER BY played_at, game_id) AS previous
           FROM matches ${where}
         )
         WHERE previous IS NOT NULL
         GROUP BY previous`,
      )
      .all(...params) as { previous: number; games: number; wins: number }[]

    if (rows.length === 0) return undefined

    const of = (previous: number): TimeBucketRow => {
      const row = rows.find((entry) => entry.previous === previous)
      const games = row?.games ?? 0
      const wins = row?.wins ?? 0

      return {
        label: previous === 1 ? "After a win" : "After a loss",
        games,
        wins,
        winRate: rate(wins, games),
      }
    }

    return { afterWin: of(1), afterLoss: of(0) }
  }

  /**
   * The player's share of what their own side produced.
   *
   * Grouping by game and team and keeping only the side containing the player
   * means a share is always out of four teammates plus themselves, never out
   * of the whole lobby. Shares are averaged per game so one enormous game
   * cannot speak for the rest.
   */
  getTeamContribution(filter: StatsFilter): ContributionShare | undefined {
    const { conditions, params } = lobbyScope(filter)

    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS games,
                AVG(damageShare) AS damageShare,
                AVG(goldShare)   AS goldShare,
                AVG(killShare)   AS killShare
         FROM (
           SELECT
             SUM(CASE WHEN p.is_player = 1 THEN p.damage_to_champions ELSE 0 END) * 1.0
               / NULLIF(SUM(p.damage_to_champions), 0) AS damageShare,
             SUM(CASE WHEN p.is_player = 1 THEN p.gold_earned ELSE 0 END) * 1.0
               / NULLIF(SUM(p.gold_earned), 0) AS goldShare,
             SUM(CASE WHEN p.is_player = 1 THEN p.kills ELSE 0 END) * 1.0
               / NULLIF(SUM(p.kills), 0) AS killShare
           FROM match_participants p
           LEFT JOIN matches m
             ON m.game_id = p.game_id AND m.puuid = p.puuid
           WHERE ${conditions.join(" AND ")}
           GROUP BY p.game_id, p.team_id
           HAVING SUM(p.is_player) = 1
         )`,
      )
      .get(...params) as {
      games: number
      damageShare: number | null
      goldShare: number | null
      killShare: number | null
    }

    if (row.games === 0) return undefined

    return {
      games: row.games,
      damageShare: row.damageShare ?? 0,
      goldShare: row.goldShare ?? 0,
      killShare: row.killShare ?? 0,
    }
  }

  /** How wide the champion pool is, and whether spreading out costs anything. */
  getChampionPool(filter: StatsFilter): ChampionPool | undefined {
    const { where, params } = scope(filter)

    const rows = this.db
      .prepare(
        `SELECT champion_id AS championId, COUNT(*) AS games,
                COALESCE(SUM(win), 0) AS wins
         FROM matches ${where}
         GROUP BY champion_id
         ORDER BY games DESC, wins DESC`,
      )
      .all(...params) as { championId: number; games: number; wins: number }[]

    if (rows.length === 0) return undefined

    const core = rows.slice(0, CORE_POOL_SIZE)
    const rest = rows.slice(CORE_POOL_SIZE)

    const sum = (entries: typeof rows, key: "games" | "wins") =>
      entries.reduce((total, entry) => total + entry[key], 0)

    const games = sum(rows, "games")

    return {
      champions: rows.length,
      games,
      coreShare: games === 0 ? 0 : sum(core, "games") / games,
      coreWinRate: rate(sum(core, "wins"), sum(core, "games")),
      restWinRate: rate(sum(rest, "wins"), sum(rest, "games")),
      top: core,
    }
  }

  /**
   * The items the player finishes games holding.
   *
   * The client exposes no purchase events, so this is the final inventory and
   * never the order things were bought in.
   */
  getBuildPatterns(filter: StatsFilter, limit: number): BuiltItem[] {
    const { conditions, params } = lobbyScope(filter)
    const all = [...conditions, "p.is_player = 1"].join(" AND ")

    const slots = BUILD_SLOTS.map(
      (slot) =>
        `SELECT p.${slot} AS itemId, p.win AS win
         FROM match_participants p
         LEFT JOIN matches m
           ON m.game_id = p.game_id AND m.puuid = p.puuid
         WHERE ${all}`,
    ).join(" UNION ALL ")

    // The clause is repeated once per slot, so its parameters must be too.
    const slotParams = BUILD_SLOTS.flatMap(() => params)

    return this.db
      .prepare(
        `SELECT itemId, COUNT(*) AS games, COALESCE(SUM(win), 0) AS wins,
                COALESCE(SUM(win), 0) * 1.0 / COUNT(*) AS winRate
         FROM (${slots})
         WHERE itemId > 0
         GROUP BY itemId
         ORDER BY games DESC, wins DESC
         LIMIT ?`,
      )
      .all(...slotParams, limit) as BuiltItem[]
  }

  /**
   * Bounded observation set for all scoped matches.
   *
   * Returns local metrics from matches plus complete-lobby metrics from
   * participants when available, using a constant number of SQL statements.
   */
  getObservations(filter: StatsFilter): InsightObservation[] {
    const { where, params } = scope(filter)

    // One query for all local metrics ordered by played_at, game_id
    const matchRows = this.db
      .prepare(
        `SELECT game_id, played_at, mode, mode_family, queue_id, win,
                grade, grade_score, champion_id, role, duration_secs,
                kills, deaths, assists,
                damage_to_champions, damage_taken, damage_self_mitigated,
                total_heal, gold_earned,
                total_minions_killed, neutral_minions,
                vision_score, damage_objectives, time_ccing_others
         FROM matches ${where}
         ORDER BY played_at ASC, game_id ASC`,
      )
      .all(...params) as {
      game_id: number
      played_at: number
      mode: TrackedMode
      mode_family: ModeFamily
      queue_id: number
      win: number
      grade: string | null
      grade_score: number | null
      champion_id: number
      role: string | null
      duration_secs: number
      kills: number
      deaths: number
      assists: number
      damage_to_champions: number
      damage_taken: number
      damage_self_mitigated: number
      total_heal: number
      gold_earned: number
      total_minions_killed: number
      neutral_minions: number
      vision_score: number
      damage_objectives: number
      time_ccing_others: number
    }[]

    if (matchRows.length === 0) return []

    // One grouped query for complete-lobby totals (team kills, team damage, heal/shield)
    // Uses a CTE to compute game-wide stats (total participants, team count) for completeLobby detection
    const { conditions, params: lobbyParams } = lobbyScope(filter)
    const lobbyRows = this.db
      .prepare(
        `WITH game_stats AS (
           SELECT p.game_id,
                  COUNT(*) AS total_participants,
                  COUNT(DISTINCT p.team_id) AS team_count
           FROM match_participants p
           LEFT JOIN matches m
             ON m.game_id = p.game_id AND m.puuid = p.puuid
           WHERE ${conditions.join(" AND ")}
           GROUP BY p.game_id
         )
         SELECT p.game_id,
                SUM(CASE WHEN p.is_player = 1 THEN p.kills ELSE 0 END) AS player_kills,
                SUM(CASE WHEN p.is_player = 1 THEN p.assists ELSE 0 END) AS player_assists,
                SUM(CASE WHEN p.is_player = 1 THEN p.damage_to_champions ELSE 0 END) AS player_damage,
                SUM(p.kills) AS team_kills,
                SUM(p.damage_to_champions) AS team_damage,
                COUNT(*) AS participant_count,
                MAX(CASE WHEN p.is_player = 1 THEN p.extended_metrics_json ELSE NULL END) AS player_extended_json,
                gs.total_participants,
                gs.team_count
         FROM match_participants p
         LEFT JOIN matches m
           ON m.game_id = p.game_id AND m.puuid = p.puuid
         JOIN game_stats gs
           ON gs.game_id = p.game_id
         WHERE ${conditions.join(" AND ")}
         GROUP BY p.game_id, p.team_id
         HAVING SUM(p.is_player) = 1`,
      )
      .all(...lobbyParams, ...lobbyParams) as {
      game_id: number
      player_kills: number
      player_assists: number
      player_damage: number
      team_kills: number
      team_damage: number
      participant_count: number
      player_extended_json: string | null
      total_participants: number
      team_count: number
    }[]

    const lobbyMap = new Map(lobbyRows.map((row) => [row.game_id, row]))

    return matchRows.map((m) => {
      const lobby = lobbyMap.get(m.game_id)
      const completeLobby = !!lobby && lobby.total_participants >= 10 && lobby.team_count >= 2
      const durationMins = Math.max(1, m.duration_secs) / 60

      let extendedMetrics: Record<string, number | boolean | string> = {}
      if (lobby?.player_extended_json) {
        try {
          extendedMetrics = JSON.parse(lobby.player_extended_json)
        } catch {
          // Defensive: leave empty if parse fails
        }
      }

      const healValue =
        typeof extendedMetrics.totalHealsOnTeammates === "number"
          ? extendedMetrics.totalHealsOnTeammates
          : undefined
      const shieldValue =
        typeof extendedMetrics.totalDamageShieldedOnTeammates === "number"
          ? extendedMetrics.totalDamageShieldedOnTeammates
          : undefined

      const allyHealShieldPerMinute =
        healValue !== undefined || shieldValue !== undefined
          ? ((healValue ?? 0) + (shieldValue ?? 0)) / durationMins
          : undefined

      const csPerMin = (m.total_minions_killed + m.neutral_minions) / durationMins

      return {
        gameId: m.game_id,
        playedAt: m.played_at,
        endedAt: m.duration_secs > 0 ? m.played_at + m.duration_secs * 1000 : undefined,
        mode: m.mode,
        family: m.mode_family,
        queueId: m.queue_id,
        win: m.win === 1,
        grade: m.grade ?? undefined,
        gradeScore: m.grade_score ?? undefined,
        championId: m.champion_id,
        role: m.role ?? undefined,
        durationSecs: m.duration_secs,
        completeLobby,
        metrics: {
          kda: m.deaths === 0 ? m.kills + m.assists : (m.kills + m.assists) / m.deaths,
          deaths: m.deaths,
          damagePerMinute: m.damage_to_champions / durationMins,
          damageTakenPerMinute: m.damage_taken / durationMins,
          goldPerMinute: m.gold_earned / durationMins,
          csPerMinute: csPerMin,
          visionPerMinute: m.vision_score > 0 ? m.vision_score / durationMins : undefined,
          objectiveDamagePerMinute:
            m.damage_objectives > 0 ? m.damage_objectives / durationMins : undefined,
          ccPerMinute: m.time_ccing_others / durationMins,
          killParticipation:
            completeLobby && lobby.team_kills > 0
              ? (lobby.player_kills + lobby.player_assists) / lobby.team_kills
              : undefined,
          teamDamageShare:
            completeLobby && lobby.team_damage > 0 ? lobby.player_damage / lobby.team_damage : undefined,
          allyHealShieldPerMinute:
            completeLobby ? allyHealShieldPerMinute : undefined,
        },
        styleAxes: computePerGameAxes({
          kills: m.kills,
          assists: m.assists,
          damageToChampions: m.damage_to_champions,
          damageTaken: m.damage_taken,
          damageSelfMitigated: m.damage_self_mitigated,
          damageObjectives: m.damage_objectives,
          totalHeal: m.total_heal,
          csPerMin,
          visionPerMin: m.vision_score / durationMins,
          ccPerMin: m.time_ccing_others / durationMins,
        }, m.mode_family as ModeFamily),
      }
    })
  }

  /** Latest grade algorithm breakdown for the player's most recent graded games. */
  getGradeComponentHistory(filter: StatsFilter, limit = 60): GradeComponentObservation[] {
    const conditions = ["m.puuid = ?", "m.is_matched = 1", "p.is_player = 1"]
    const params: (string | number)[] = [filter.puuid]

    if (filter.mode) {
      conditions.push("m.mode = ?")
      params.push(filter.mode)
    } else if (filter.modes?.length) {
      conditions.push(`m.mode IN (${filter.modes.map(() => "?").join(", ")})`)
      params.push(...filter.modes)
    }

    if (filter.modeFamily) {
      conditions.push("m.mode_family = ?")
      params.push(filter.modeFamily)
    }

    if (filter.sinceMs !== undefined) {
      conditions.push("m.played_at >= ?")
      params.push(filter.sinceMs)
    }

    const rows = this.db.prepare(
      `SELECT game_id, played_at, grade, grade_score, composite_percentile, components_json
       FROM (
         SELECT m.game_id, m.played_at, m.grade, m.grade_score,
                g.composite_percentile, g.components_json,
                ROW_NUMBER() OVER (
                  PARTITION BY m.game_id
                  ORDER BY g.algorithm_version DESC
                ) AS version_rank
         FROM matches m
         JOIN match_participants p
           ON p.game_id = m.game_id AND p.puuid = m.puuid
         JOIN match_grade_breakdowns g
           ON g.game_id = p.game_id
          AND g.puuid = p.puuid
          AND g.participant_id = p.participant_id
         WHERE ${conditions.join(" AND ")}
       )
       WHERE version_rank = 1
       ORDER BY played_at DESC, game_id DESC
       LIMIT ?`,
    ).all(...params, Math.max(1, limit)) as Array<{
      game_id: number
      played_at: number
      grade: string | null
      grade_score: number | null
      composite_percentile: number
      components_json: string
    }>

    return rows.reverse().flatMap((row) => {
      try {
        const components = JSON.parse(row.components_json)
        if (!Array.isArray(components)) return []
        return [{
          gameId: row.game_id,
          playedAt: row.played_at,
          grade: row.grade ?? undefined,
          gradeScore: row.grade_score ?? undefined,
          compositePercentile: row.composite_percentile,
          components: components as GradeComponent[],
        }]
      } catch {
        return []
      }
    })
  }

  /**
   * Final item sets from scoped matches.
   *
   * Returns slots 0-5 only, omitting slot 6 (trinket), with zero IDs and
   * duplicates removed.
   */
  getFinalItemObservations(filter: StatsFilter): FinalItemObservation[] {
    const { conditions, params } = lobbyScope(filter)
    const all = [...conditions, "p.is_player = 1"].join(" AND ")

    const rows = this.db
      .prepare(
        `SELECT m.game_id, m.champion_id, m.role, m.grade_score,
                p.item0, p.item1, p.item2, p.item3, p.item4, p.item5
         FROM match_participants p
         LEFT JOIN matches m
           ON m.game_id = p.game_id AND m.puuid = p.puuid
         WHERE ${all}`,
      )
      .all(...params) as {
      game_id: number
      champion_id: number
      role: string | null
      grade_score: number | null
      item0: number
      item1: number
      item2: number
      item3: number
      item4: number
      item5: number
    }[]

    return rows.map((row) => {
      const slots = [row.item0, row.item1, row.item2, row.item3, row.item4, row.item5]
      const itemIds = [...new Set(slots.filter((id) => id > 0))]

      return {
        gameId: row.game_id,
        championId: row.champion_id,
        role: row.role ?? undefined,
        gradeScore: row.grade_score ?? undefined,
        itemIds,
      }
    })
  }
}
