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
  modes?: TrackedMode[]
  modeFamily?: ModeFamily
  sinceMs?: number
  untilMs?: number
  championIds?: number[]
  roles?: string[]
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
  scope: "role" | "lobby"
  games: number
}

export interface LobbyComparison {
  games: number
  metrics: LobbyMetric[]
}

export interface OwnerAugmentSummary {
  augmentId: number
  games: number
  firstPlayedAt: number
  lastPlayedAt: number
  averageGrade?: number
  kda: number
  damagePerMinute: number
  champions: { championId: number; games: number }[]
}

export interface AugmentCatalogEntry {
  augmentId: number
  name: string
  rarity?: string
  iconPath?: string
}

const COLUMNS = [
  "game_id",
  "participant_puuid",
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
  "assigned_position",
  "detail_version",
  "extended_metrics_json",
  "rune_selections_json",
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
export const LOBBY_DETAIL_VERSION = 6
export const PARTICIPANT_CAPTURE_VERSION = 6

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
const METRICS: { key: string; label: string; expression: string; roleScoped?: boolean }[] = [
  { key: "damage", label: "Damage dealt", expression: "damage_to_champions" },
  { key: "damageTaken", label: "Damage taken", expression: "damage_taken" },
  { key: "gold", label: "Gold earned", expression: "gold_earned", roleScoped: true },
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
    roleScoped: true,
  },
  { key: "vision", label: "Vision score", expression: "vision_score", roleScoped: true },
  { key: "objectives", label: "Objective damage", expression: "damage_objectives" },
]

function toValues(row: ParticipantRow) {
  return [
    row.gameId,
    row.participantPuuid ?? null,
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
    row.assignedPosition ?? null,
    LOBBY_DETAIL_VERSION,
    JSON.stringify(row.extendedMetrics ?? {}),
    JSON.stringify(row.runeSelections ?? []),
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
  let extendedMetrics: Record<string, number | boolean | string> = {}
  try {
    extendedMetrics = JSON.parse(row.extended_metrics_json ?? "{}")
  } catch {
    extendedMetrics = {}
  }
  let runeSelections = [] as ParticipantRow["runeSelections"]
  try {
    runeSelections = JSON.parse(row.rune_selections_json ?? "[]")
  } catch {
    runeSelections = []
  }
  return {
    gameId: row.game_id,
    participantPuuid: row.participant_puuid ?? (row.is_player === 1 ? row.puuid : undefined),
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
    runeSelections,
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
    assignedPosition: row.assigned_position ?? undefined,
    extendedMetrics,
  }
}

export class ParticipantsRepository {
  private readonly insertStatement: Statement
  private readonly insertTeamStatement: Statement

  constructor(private readonly db: Database) {
    this.insertStatement = db.prepare(INSERT_SQL)
    this.insertTeamStatement = db.prepare(INSERT_TEAM_SQL)
  }

  hasCurrentLobby(gameId: number, puuid: string): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS participants,
                MIN(detail_version) AS oldestVersion,
                (SELECT COUNT(*) FROM match_teams
                 WHERE game_id = ? AND puuid = ?) AS teams
         FROM match_participants
         WHERE game_id = ? AND puuid = ?`,
      )
      .get(gameId, puuid, gameId, puuid) as {
      participants: number
      oldestVersion: number | null
      teams: number
    }

    return (
      row.participants > 0 &&
      row.teams > 0 &&
      (row.oldestVersion ?? 0) >= LOBBY_DETAIL_VERSION
    )
  }

  insertMany(rows: ParticipantRow[]): number {
    if (rows.length === 0) return 0

    const insertAll = this.db.transaction((batch: ParticipantRow[]) => {
      let inserted = 0
      for (const row of batch) {
        inserted += this.insertStatement.run(toValues(row)).changes
        this.saveAugments(row)
      }
      return inserted
    })

    return insertAll(rows)
  }

  private saveAugments(row: ParticipantRow) {
    if (!row.augments?.length) return
    const statement = this.db.prepare(
      `INSERT INTO participant_augments
       (game_id, puuid, participant_id, slot, augment_id, selected_at_ms,
        source, name_snapshot, rarity_snapshot, icon_path_snapshot,
        capture_version, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id, puuid, participant_id, slot) DO UPDATE SET
         augment_id = excluded.augment_id,
         selected_at_ms = COALESCE(excluded.selected_at_ms, participant_augments.selected_at_ms),
         source = excluded.source,
         name_snapshot = COALESCE(excluded.name_snapshot, participant_augments.name_snapshot),
         rarity_snapshot = COALESCE(excluded.rarity_snapshot, participant_augments.rarity_snapshot),
         icon_path_snapshot = COALESCE(excluded.icon_path_snapshot, participant_augments.icon_path_snapshot),
         capture_version = excluded.capture_version,
         captured_at = excluded.captured_at`,
    )
    for (const augment of row.augments) {
      if (!Number.isInteger(augment.augmentId) || augment.augmentId <= 0) continue
      statement.run(
        row.gameId,
        row.puuid,
        row.participantId,
        augment.slot,
        augment.augmentId,
        augment.selectedAtMs ?? null,
        augment.source,
        augment.name ?? null,
        augment.rarity ?? null,
        augment.iconPath ?? null,
        PARTICIPANT_CAPTURE_VERSION,
        Date.now(),
      )
    }
  }

  recordCapture(
    gameId: number,
    puuid: string,
    source: "league_client" | "match_v5",
    rows: ParticipantRow[],
    teamCount: number,
    unknownFieldNames: string[] = [],
  ) {
    const augmentParticipants = rows.filter((row) => row.augments?.length).length
    const captured = [
      "scoreboard", "items", "spells", "runes", "extended_metrics",
      ...(augmentParticipants ? ["augments"] : []),
    ]
    const missing = [
      ...(rows.length < 10 ? ["complete_scoreboard"] : []),
      ...(augmentParticipants === 0 ? ["augments"] : []),
    ]
    this.db.prepare(
      `INSERT INTO match_capture_manifests
       (game_id, puuid, source, match_mapper_version,
        participant_mapper_version, participant_count, team_count,
        augment_participant_count, captured_categories_json,
        missing_categories_json, unknown_field_names_json, captured_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id, puuid) DO UPDATE SET
         source = excluded.source,
         participant_mapper_version = excluded.participant_mapper_version,
         participant_count = excluded.participant_count,
         team_count = excluded.team_count,
         augment_participant_count = excluded.augment_participant_count,
         captured_categories_json = excluded.captured_categories_json,
         missing_categories_json = excluded.missing_categories_json,
         unknown_field_names_json = excluded.unknown_field_names_json,
         captured_at = excluded.captured_at`,
    ).run(
      gameId,
      puuid,
      source,
      PARTICIPANT_CAPTURE_VERSION,
      rows.length,
      teamCount,
      augmentParticipants,
      JSON.stringify(captured),
      JSON.stringify(missing),
      JSON.stringify([...new Set(unknownFieldNames)].sort()),
      Date.now(),
    )
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
    const saveBreakdown = this.db.prepare(
      `INSERT OR REPLACE INTO match_grade_breakdowns
       (game_id, puuid, participant_id, algorithm_version,
        composite_percentile, components_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    const save = this.db.transaction(() => {
      for (const [participantId, result] of grades) {
        update.run(result.grade, result.score, gameId, puuid, participantId)
        saveBreakdown.run(
          gameId,
          puuid,
          participantId,
          result.breakdown.algorithmVersion,
          result.breakdown.compositePercentile,
          JSON.stringify(result.breakdown.components),
          Date.now(),
        )
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

    const mapped = participants.map(toParticipantRow)
    const augments = this.db.prepare(
      `SELECT participant_id AS participantId, slot,
              augment_id AS augmentId, selected_at_ms AS selectedAtMs,
              source, name_snapshot AS name, rarity_snapshot AS rarity,
              icon_path_snapshot AS iconPath
       FROM participant_augments
       WHERE game_id = ? AND puuid = ?
       ORDER BY participant_id, slot`,
    ).all(gameId, puuid) as Array<{
      participantId: number
      slot: number
      augmentId: number
      selectedAtMs: number | null
      source: "league_client" | "match_v5" | "timeline"
      name: string | null
      rarity: string | null
      iconPath: string | null
    }>
    for (const participant of mapped) {
      participant.augments = augments
        .filter((augment) => augment.participantId === participant.participantId)
        .map((augment) => ({
          slot: augment.slot,
          augmentId: augment.augmentId,
          selectedAtMs: augment.selectedAtMs ?? undefined,
          source: augment.source,
          name: augment.name ?? undefined,
          rarity: augment.rarity ?? undefined,
          iconPath: augment.iconPath ?? undefined,
        }))
    }
    return { participants: mapped, teams }
  }

  countGamesWithLobby(puuid: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(DISTINCT game_id) AS total FROM match_participants WHERE puuid = ?",
      )
      .get(puuid) as { total: number }

    return row.total
  }

  /**
   * Owner-only, post-game augment context. Deliberately excludes wins and
   * losses: Riot policy prohibits displaying augment win rates.
   */
  getOwnerAugmentSummaries(
    puuid: string,
    augmentId?: number,
  ): OwnerAugmentSummary[] {
    const filter = augmentId === undefined ? "" : "AND a.augment_id = ?"
    const params = augmentId === undefined ? [puuid] : [puuid, augmentId]
    const rows = this.db.prepare(
      `SELECT a.augment_id AS augmentId, COUNT(DISTINCT a.game_id) AS games,
              MIN(m.played_at) AS firstPlayedAt,
              MAX(m.played_at) AS lastPlayedAt,
              AVG(p.grade_score) AS averageGrade,
              SUM(p.kills + p.assists) * 1.0 / MAX(1, SUM(p.deaths)) AS kda,
              AVG(p.damage_to_champions * 60.0 / MAX(1, m.duration_secs))
                AS damagePerMinute
       FROM participant_augments a
       JOIN match_participants p
         ON p.game_id = a.game_id AND p.puuid = a.puuid
        AND p.participant_id = a.participant_id AND p.is_player = 1
       JOIN matches m ON m.game_id = a.game_id AND m.puuid = a.puuid
       WHERE a.puuid = ? AND m.is_matched = 1 ${filter}
       GROUP BY a.augment_id
       ORDER BY games DESC, a.augment_id`,
    ).all(...params) as Array<Omit<OwnerAugmentSummary, "champions"> & {
      averageGrade: number | null
    }>
    const championRows = this.db.prepare(
      `SELECT a.augment_id AS augmentId, p.champion_id AS championId,
              COUNT(DISTINCT a.game_id) AS games
       FROM participant_augments a
       JOIN match_participants p
         ON p.game_id = a.game_id AND p.puuid = a.puuid
        AND p.participant_id = a.participant_id AND p.is_player = 1
       JOIN matches m ON m.game_id = a.game_id AND m.puuid = a.puuid
       WHERE a.puuid = ? AND m.is_matched = 1 ${filter}
       GROUP BY a.augment_id, p.champion_id
       ORDER BY games DESC, p.champion_id`,
    ).all(...params) as Array<{
      augmentId: number
      championId: number
      games: number
    }>
    return rows.map((row) => ({
      ...row,
      averageGrade: row.averageGrade ?? undefined,
      champions: championRows
        .filter((entry) => entry.augmentId === row.augmentId)
        .map(({ championId, games }) => ({ championId, games })),
    }))
  }

  cacheAugmentCatalog(dataVersion: string, entries: AugmentCatalogEntry[]) {
    const save = this.db.transaction(() => {
      const catalog = this.db.prepare(
        `INSERT INTO augment_catalog
         (augment_id, data_version, name, rarity, icon_path, source, fetched_at)
         VALUES (?, ?, ?, ?, ?, 'communitydragon', ?)
         ON CONFLICT(augment_id, data_version) DO UPDATE SET
           name = excluded.name,
           rarity = excluded.rarity,
           icon_path = excluded.icon_path,
           fetched_at = excluded.fetched_at`,
      )
      const snapshots = this.db.prepare(
        `UPDATE participant_augments SET
           name_snapshot = ?,
           rarity_snapshot = COALESCE(?, rarity_snapshot),
           icon_path_snapshot = COALESCE(?, icon_path_snapshot)
         WHERE augment_id = ?`,
      )
      const now = Date.now()
      for (const entry of entries) {
        catalog.run(
          entry.augmentId,
          dataVersion,
          entry.name,
          entry.rarity ?? null,
          entry.iconPath ?? null,
          now,
        )
        snapshots.run(
          entry.name,
          entry.rarity ?? null,
          entry.iconPath ?? null,
          entry.augmentId,
        )
      }
    })
    save()
    return entries.length
  }

  deleteAll(puuid: string): number {
    const remove = this.db.transaction(() => {
      const participants = this.db
        .prepare("DELETE FROM match_participants WHERE puuid = ?")
        .run(puuid).changes
      this.db.prepare("DELETE FROM match_teams WHERE puuid = ?").run(puuid)
      return participants
    })
    return remove()
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
    const conditions = [
      "me.puuid = ?",
      "me.is_player = 1",
      "COALESCE(m.is_matched, 1) = 1",
    ]
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

    if (filter.untilMs !== undefined) {
      conditions.push("m.played_at <= ?")
      params.push(filter.untilMs)
    }

    if (filter.championIds?.length) {
      conditions.push(`m.champion_id IN (${filter.championIds.map(() => "?").join(", ")})`)
      params.push(...filter.championIds)
    }

    if (filter.roles?.length) {
      conditions.push(`${normalizedRole("me")} IN (${filter.roles.map(() => "?").join(", ")})`)
      params.push(...filter.roles)
    }

    const join = `LEFT JOIN matches m
                    ON m.game_id = me.game_id AND m.puuid = me.puuid`

    const where = conditions.join(" AND ")

    const isLaneFamily =
      filter.modeFamily === "sr" ||
      filter.modeFamily === "classic" ||
      (filter.modes?.length && filter.modes.every((mode) => mode.startsWith("sr_"))) ||
      (filter.modes?.length && filter.modes.every((mode) => mode === "league_classic")) ||
      (filter.mode?.startsWith("sr_") ?? false) ||
      filter.mode === "league_classic"

    const metrics = METRICS.map((metric) => {
      const mine = qualify(metric.expression, "me")
      const theirs = qualify(metric.expression, "other")

      const useRole = metric.roleScoped && isLaneFamily

      const roleJoinCondition = useRole
        ? `AND ${normalizedRole("other")} = ${normalizedRole("me")}
           AND other.team_id != me.team_id`
        : ""

      const roleCountCheck = useRole
        ? `HAVING COUNT(*) = 1`
        : ""

      // When role-scoped with exactly one opponent, compare only against them.
      // Otherwise fall back to the full lobby.
      const sql = useRole
        ? `SELECT
             AVG(placing) AS averageRank,
             AVG(CASE WHEN players > 1
                      THEN (players - placing) / (players - 1.0)
                      ELSE 0.5 END) AS percentile,
             COUNT(*) AS games,
             1 AS roleScoped
           FROM (
             SELECT
               COUNT(*) + 1 AS players,
               1
                 + SUM(CASE WHEN ${theirs} > ${mine} THEN 1 ELSE 0 END)
                 + SUM(CASE WHEN ${theirs} = ${mine} THEN 1 ELSE 0 END) / 2.0
                 AS placing
             FROM match_participants me
             JOIN match_participants other
               ON other.game_id = me.game_id AND other.puuid = me.puuid
               ${roleJoinCondition}
             ${join}
             WHERE ${where}
             GROUP BY me.game_id
             ${roleCountCheck}
           )`
        : `SELECT
             AVG(placing) AS averageRank,
             AVG(CASE WHEN players > 1
                      THEN (players - placing) / (players - 1.0)
                      ELSE 0.5 END) AS percentile,
             COUNT(*) AS games,
             0 AS roleScoped
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
           )`

      const roleRow = this.db.prepare(sql).get(...params) as {
        averageRank: number | null
        percentile: number | null
        games: number
        roleScoped: number
      }

      // If role query returned results, use them; otherwise fall back to lobby.
      if (useRole && roleRow.games > 0) {
        return {
          key: metric.key,
          label: metric.label,
          averageRank: roleRow.averageRank ?? 0,
          percentile: roleRow.percentile ?? 0,
          games: roleRow.games,
          scope: "role" as const,
        }
      }

      // Full-lobby fallback for role-scoped metrics that had no opponent peer.
      if (useRole) {
        const lobbyRow = this.db
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
          averageRank: lobbyRow.averageRank ?? 0,
          percentile: lobbyRow.percentile ?? 0,
          games: lobbyRow.games,
          scope: "lobby" as const,
        }
      }

      return {
        key: metric.key,
        label: metric.label,
        averageRank: roleRow.averageRank ?? 0,
        percentile: roleRow.percentile ?? 0,
        games: roleRow.games,
        scope: "lobby" as const,
      }
    })

    if (metrics[0].games === 0) return undefined

    return {
      games: metrics[0].games,
      metrics: metrics.map(({ key, label, averageRank, percentile, scope, games }) => ({
        key,
        label,
        averageRank,
        percentile,
        scope,
        games,
      })),
    }
  }
}

/**
 * Resolves a participant's normalized role from extended_metrics_json,
 * falling back to the stored role column.
 */
function resolvedRole(alias: string): string {
  return `COALESCE(
    CASE WHEN json_valid(${alias}.extended_metrics_json) THEN
      json_extract(${alias}.extended_metrics_json, '$.teamPosition')
    ELSE NULL END,
    CASE WHEN typeof(${alias}.role) = 'text' AND LENGTH(${alias}.role) > 0
         THEN ${alias}.role ELSE NULL END
  )`
}

function normalizedRole(alias: string): string {
  const role = resolvedRole(alias)
  const assigned = `UPPER(COALESCE(${alias}.assigned_position, ''))`
  return `CASE
    WHEN UPPER(COALESCE(${role}, '')) IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')
      THEN UPPER(${role})
    WHEN ${assigned} IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')
      THEN ${assigned}
    WHEN UPPER(COALESCE(${alias}.lane, '')) IN ('BOTTOM', 'BOT') THEN
      CASE WHEN UPPER(COALESCE(${role}, '')) IN ('SUPPORT', 'DUO_SUPPORT')
        THEN 'UTILITY' ELSE 'BOTTOM' END
    WHEN UPPER(COALESCE(${alias}.lane, '')) IN ('TOP', 'JUNGLE', 'MIDDLE')
      THEN UPPER(${alias}.lane)
    ELSE NULL
  END`
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
