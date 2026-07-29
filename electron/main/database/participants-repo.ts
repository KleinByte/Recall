import type { Database, Statement } from "better-sqlite3"
import type {
  ModeFamily,
  ParticipantRow,
  TeamRow,
  TrackedMode,
} from "../matches/types.js"
import type { GradeResult } from "../matches/grade.js"

export interface LobbyFilter {
  puuid: string
  mode?: TrackedMode
  modeFamily?: ModeFamily
}

/** The whole scoreboard for one recorded game. */
export interface MatchDetail {
  participants: ParticipantRow[]
  teams: TeamRow[]
}

export interface LobbyMetric {
  key: string
  label: string
  /** Average placing out of the lobby, where 1 is best. */
  averageRank: number
  /** 1 means top of every lobby, 0 means bottom of every lobby. */
  percentile: number
}

export interface LobbyComparison {
  games: number
  metrics: LobbyMetric[]
}

const COLUMNS = [
  "game_id",
  "puuid",
  "participant_id",
  "team_id",
  "is_player",
  "champion_id",
  "win",
  "summoner_name",
  "profile_icon",
  "spell1_id",
  "spell2_id",
  "item0",
  "item1",
  "item2",
  "item3",
  "item4",
  "item5",
  "item6",
  "perk_primary_style",
  "perk_sub_style",
  "perk0",
  "perk1",
  "perk2",
  "perk3",
  "perk4",
  "perk5",
  "champ_level",
  "kills",
  "deaths",
  "assists",
  "gold_earned",
  "gold_spent",
  "damage_to_champions",
  "total_damage_dealt",
  "magic_damage_to_champions",
  "physical_damage_to_champions",
  "true_damage_to_champions",
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
  "neutral_minions",
  "vision_score",
  "wards_placed",
  "wards_killed",
  "control_wards",
  "damage_objectives",
  "damage_turrets",
  "turret_kills",
  "inhibitor_kills",
  "longest_time_living",
  "first_blood",
  "first_tower",
  "lane",
  "role",
  "detail_version",
] as const

const TEAM_COLUMNS = [
  "game_id",
  "puuid",
  "team_id",
  "win",
  "bans",
  "baron_kills",
  "dragon_kills",
  "herald_kills",
  "horde_kills",
  "tower_kills",
  "inhibitor_kills",
  "first_blood",
  "first_tower",
  "first_baron",
  "first_dragon",
  "first_inhibitor",
] as const

/**
 * How much of a lobby the current mapper stores.
 *
 * Raise this whenever the scoreboard gains fields worth going back for, and
 * games still inside the client's window will be read again to fill them in.
 */
export const LOBBY_DETAIL_VERSION = 2

/**
 * Replaces rather than ignores, so a lobby captured under an earlier, narrower
 * schema is filled in properly the next time the game is read.
 */
const INSERT_SQL = `
  INSERT OR REPLACE INTO match_participants (${COLUMNS.join(", ")})
  VALUES (${COLUMNS.map(() => "?").join(", ")})
`

const INSERT_TEAM_SQL = `
  INSERT OR IGNORE INTO match_teams (${TEAM_COLUMNS.join(", ")})
  VALUES (${TEAM_COLUMNS.map(() => "?").join(", ")})
`

/**
 * What the player is ranked on within their own lobbies.
 *
 * These are raw totals rather than rates because every player in a game played
 * the same number of minutes, so the comparison is already fair.
 */
const METRICS: { key: string; label: string; expression: string }[] = [
  { key: "damage", label: "Damage dealt", expression: "damage_to_champions" },
  { key: "damageTaken", label: "Damage taken", expression: "damage_taken" },
  { key: "gold", label: "Gold earned", expression: "gold_earned" },
  {
    key: "kda",
    label: "KDA",
    expression: "(kills + assists) * 1.0 / MAX(1, deaths)",
  },
  {
    key: "killInvolvement",
    label: "Kill involvement",
    expression: "kills + assists",
  },
  {
    key: "cs",
    label: "Creep score",
    expression: "total_minions_killed + neutral_minions",
  },
  { key: "vision", label: "Vision score", expression: "vision_score" },
  { key: "objectives", label: "Objective damage", expression: "damage_objectives" },
]

function toValues(row: ParticipantRow) {
  return [
    row.gameId,
    row.puuid,
    row.participantId,
    row.teamId,
    row.isPlayer,
    row.championId,
    row.win,
    row.summonerName ?? null,
    row.profileIcon,
    row.spell1Id,
    row.spell2Id,
    ...row.items,
    row.perkPrimaryStyle,
    row.perkSubStyle,
    ...row.perks,
    row.champLevel,
    row.kills,
    row.deaths,
    row.assists,
    row.goldEarned,
    row.goldSpent,
    row.damageToChampions,
    row.totalDamageDealt,
    row.magicDamageToChampions,
    row.physicalDamageToChampions,
    row.trueDamageToChampions,
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
    row.neutralMinions,
    row.visionScore,
    row.wardsPlaced,
    row.wardsKilled,
    row.controlWards,
    row.damageObjectives,
    row.damageTurrets,
    row.turretKills,
    row.inhibitorKills,
    row.longestTimeLiving,
    row.firstBlood,
    row.firstTower,
    row.lane ?? null,
    row.role ?? null,
    LOBBY_DETAIL_VERSION,
  ]
}

function toTeamValues(row: TeamRow) {
  return [
    row.gameId,
    row.puuid,
    row.teamId,
    row.win,
    row.bans,
    row.baronKills,
    row.dragonKills,
    row.heraldKills,
    row.hordeKills,
    row.towerKills,
    row.inhibitorKills,
    row.firstBlood,
    row.firstTower,
    row.firstBaron,
    row.firstDragon,
    row.firstInhibitor,
  ]
}

function toParticipantRow(row: Record<string, never>): ParticipantRow {
  return {
    gameId: row.game_id,
    puuid: row.puuid,
    participantId: row.participant_id,
    teamId: row.team_id,
    isPlayer: row.is_player,
    championId: row.champion_id,
    win: row.win,
    summonerName: row.summoner_name ?? undefined,
    profileIcon: row.profile_icon,
    spell1Id: row.spell1_id,
    spell2Id: row.spell2_id,
    items: [
      row.item0,
      row.item1,
      row.item2,
      row.item3,
      row.item4,
      row.item5,
      row.item6,
    ],
    perkPrimaryStyle: row.perk_primary_style,
    perkSubStyle: row.perk_sub_style,
    perks: [row.perk0, row.perk1, row.perk2, row.perk3, row.perk4, row.perk5],
    champLevel: row.champ_level,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    goldEarned: row.gold_earned,
    goldSpent: row.gold_spent,
    damageToChampions: row.damage_to_champions,
    totalDamageDealt: row.total_damage_dealt,
    magicDamageToChampions: row.magic_damage_to_champions,
    physicalDamageToChampions: row.physical_damage_to_champions,
    trueDamageToChampions: row.true_damage_to_champions,
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
    neutralMinions: row.neutral_minions,
    visionScore: row.vision_score,
    wardsPlaced: row.wards_placed,
    wardsKilled: row.wards_killed,
    controlWards: row.control_wards,
    damageObjectives: row.damage_objectives,
    damageTurrets: row.damage_turrets,
    turretKills: row.turret_kills,
    inhibitorKills: row.inhibitor_kills,
    longestTimeLiving: row.longest_time_living,
    firstBlood: row.first_blood,
    firstTower: row.first_tower,
    grade: row.grade ?? undefined,
    gradeScore: row.grade_score ?? undefined,
    lane: row.lane ?? undefined,
    role: row.role ?? undefined,
  }
}

export class ParticipantsRepository {
  private readonly insertStatement: Statement
  private readonly insertTeamStatement: Statement

  constructor(private readonly db: Database) {
    this.insertStatement = db.prepare(INSERT_SQL)
    this.insertTeamStatement = db.prepare(INSERT_TEAM_SQL)
  }

  insertMany(rows: ParticipantRow[]): number {
    if (rows.length === 0) return 0

    const insertAll = this.db.transaction((batch: ParticipantRow[]) => {
      let inserted = 0
      for (const row of batch) {
        inserted += this.insertStatement.run(toValues(row)).changes
      }
      return inserted
    })

    return insertAll(rows)
  }

  insertTeams(rows: TeamRow[]): number {
    if (rows.length === 0) return 0

    const insertAll = this.db.transaction((batch: TeamRow[]) => {
      let inserted = 0
      for (const row of batch) {
        inserted += this.insertTeamStatement.run(toTeamValues(row)).changes
      }
      return inserted
    })

    return insertAll(rows)
  }

  setGrades(gameId: number, puuid: string, grades: Map<number, GradeResult>) {
    if (grades.size === 0) return
    const update = this.db.prepare(
      "UPDATE match_participants SET grade = ?, grade_score = ? WHERE game_id = ? AND puuid = ? AND participant_id = ?",
    )
    const save = this.db.transaction(() => {
      for (const [participantId, result] of grades) {
        update.run(result.grade, result.score, gameId, puuid, participantId)
      }
    })
    save()
  }

  /** The full scoreboard for one game, ordered as it appears in the client. */
  getMatchDetail(gameId: number, puuid: string): MatchDetail {
    const participants = this.db
      .prepare(
        `SELECT * FROM match_participants
         WHERE game_id = ? AND puuid = ?
         ORDER BY team_id, participant_id`,
      )
      .all(gameId, puuid) as Record<string, never>[]

    const teams = this.db
      .prepare(
        `SELECT game_id AS gameId, puuid, team_id AS teamId, win, bans,
                baron_kills AS baronKills, dragon_kills AS dragonKills,
                herald_kills AS heraldKills, horde_kills AS hordeKills,
                tower_kills AS towerKills, inhibitor_kills AS inhibitorKills,
                first_blood AS firstBlood, first_tower AS firstTower,
                first_baron AS firstBaron, first_dragon AS firstDragon,
                first_inhibitor AS firstInhibitor
         FROM match_teams
         WHERE game_id = ? AND puuid = ?
         ORDER BY team_id`,
      )
      .all(gameId, puuid) as TeamRow[]

    return { participants: participants.map(toParticipantRow), teams }
  }

  countGamesWithLobby(puuid: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(DISTINCT game_id) AS total FROM match_participants WHERE puuid = ?",
      )
      .get(puuid) as { total: number }

    return row.total
  }

  /** Column names, so a test can assert no identifying data is stored. */
  columnNames(): string[] {
    return (
      this.db.pragma("table_info(match_participants)") as { name: string }[]
    ).map((column) => column.name)
  }

  /**
   * Which of the given games have no usable lobby recorded.
   *
   * A game counts as missing when nothing was stored for it, and also when
   * what was stored predates the full scoreboard — those rows carry the
   * statistics but no names or builds. Marking each row with the version that
   * wrote it means such a game is read again exactly once, rather than every
   * sync forever when a payload genuinely has nothing more to give.
   */
  getGamesMissingLobby(
    puuid: string,
    gameIds: number[],
    limit: number,
  ): number[] {
    if (gameIds.length === 0) return []

    const placeholders = gameIds.map(() => "?").join(", ")
    const rows = this.db
      .prepare(
        `SELECT game_id AS gameId FROM match_participants
         WHERE puuid = ? AND game_id IN (${placeholders})
         GROUP BY game_id
         HAVING MIN(detail_version) >= ?`,
      )
      .all(puuid, ...gameIds, LOBBY_DETAIL_VERSION) as { gameId: number }[]

    const complete = new Set(rows.map((row) => row.gameId))

    return gameIds.filter((id) => !complete.has(id)).slice(0, limit)
  }

  /**
   * How the player placed among the ten people in each of their games.
   *
   * Ranking happens per game and is only then averaged, because a lobby is the
   * only fair yardstick — a losing stomp and a 45 minute grind produce wildly
   * different raw numbers.
   *
   * Players on equal footing share the average of the places they span, so a
   * lobby where everyone did the same lands everybody in the middle rather
   * than handing them all first place.
   */
  getLobbyComparison(filter: LobbyFilter): LobbyComparison | undefined {
    const conditions = ["me.puuid = ?", "me.is_player = 1"]
    const params: (string | number)[] = [filter.puuid]

    if (filter.mode) {
      conditions.push("m.mode = ?")
      params.push(filter.mode)
    }

    if (filter.modeFamily) {
      conditions.push("m.mode_family = ?")
      params.push(filter.modeFamily)
    }

    // The match row is only needed to filter by mode, so it is joined only
    // then. Without it the comparison stands on the lobby data alone.
    const join =
      filter.mode || filter.modeFamily
        ? `JOIN matches m
             ON m.game_id = me.game_id AND m.puuid = me.puuid`
        : ""

    const where = conditions.join(" AND ")

    const metrics = METRICS.map((metric) => {
      const mine = qualify(metric.expression, "me")
      const theirs = qualify(metric.expression, "other")

      const row = this.db
        .prepare(
          `SELECT
             AVG(placing) AS averageRank,
             AVG(CASE WHEN players > 1
                      THEN (players - placing) / (players - 1.0)
                      ELSE 0.5 END) AS percentile,
             COUNT(*) AS games
           FROM (
             SELECT
               COUNT(*) AS players,
               1
                 + SUM(CASE WHEN ${theirs} > ${mine} THEN 1 ELSE 0 END)
                 + (SUM(CASE WHEN ${theirs} = ${mine} THEN 1 ELSE 0 END) - 1) / 2.0
                 AS placing
             FROM match_participants me
             JOIN match_participants other
               ON other.game_id = me.game_id AND other.puuid = me.puuid
             ${join}
             WHERE ${where}
             GROUP BY me.game_id
           )`,
        )
        .get(...params) as {
        averageRank: number | null
        percentile: number | null
        games: number
      }

      return {
        key: metric.key,
        label: metric.label,
        averageRank: row.averageRank ?? 0,
        percentile: row.percentile ?? 0,
        games: row.games,
      }
    })

    if (metrics[0].games === 0) return undefined

    return {
      games: metrics[0].games,
      metrics: metrics.map(({ key, label, averageRank, percentile }) => ({
        key,
        label,
        averageRank,
        percentile,
      })),
    }
  }
}

/**
 * Prefixes bare column names with a table alias.
 *
 * Every name in a metric expression is a column of `match_participants`; SQL
 * keywords and numbers are left alone.
 */
function qualify(expression: string, alias: string): string {
  return expression.replace(/\b([a-z_][a-z0-9_]*)\b/gi, (name) =>
    /^(MAX|AND|OR|CASE|WHEN|THEN|ELSE|END)$/i.test(name)
      ? name
      : `${alias}.${name}`,
  )
}
