import type { ParticipantRow, TeamRow } from "./types.js"
import { normalizePosition, POSITION_RESOLVER_VERSION } from "./position.js"
import { assessGradeCoreFacts } from "./grade-core-facts.js"

/**
 * The full-detail match payload, which unlike match history carries the whole
 * scoreboard.
 */
export interface GameDetail {
  gameId?: number
  gameDuration?: number
  participantIdentities?: {
    participantId: number
    player?: {
      puuid?: string
      gameName?: string
      tagLine?: string
      summonerName?: string
      profileIcon?: number
    }
  }[]
  participants?: {
    participantId: number
    teamId: number
    championId?: number
    spell1Id?: number
    spell2Id?: number
    stats?: Record<string, number | boolean | undefined>
    timeline?: { lane?: string; role?: string }
  }[]
  teams?: {
    teamId: number
    win?: string | boolean
    bans?: { championId: number }[]
    baronKills?: number
    dragonKills?: number
    riftHeraldKills?: number
    hordeKills?: number
    towerKills?: number
    inhibitorKills?: number
    firstBlood?: boolean
    firstTower?: boolean
    firstBaron?: boolean
    firstDargon?: boolean
    firstInhibitor?: boolean
  }[]
}

const int = (value: number | boolean | undefined) =>
  typeof value === "number" ? Math.trunc(value) : 0

const optionalInt = (value: number | boolean | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined

const bool = (value: number | boolean | string | undefined) => {
  // Teams report their result as the string "Win" rather than a boolean.
  if (typeof value === "string") return value.toLowerCase() === "win" ? 1 : 0
  return value ? 1 : 0
}

function augmentValues(stats: Record<string, number | boolean | undefined>) {
  const entries = new Map(
    Object.entries(stats).map(([key, value]) => [key.toLowerCase(), value]),
  )
  return Array.from({ length: 6 }, (_, index) =>
    entries.get(`playeraugment${index + 1}`),
  ).flatMap((value, index) =>
    typeof value === "number" && value > 0
      ? [{
        slot: index + 1,
        augmentId: Math.trunc(value),
        source: "league_client" as const,
      }]
      : [],
  )
}

function extendedMetrics(stats: Record<string, number | boolean | undefined>) {
  const kept = new Set([
    "totalDamageShieldedOnTeammates", "totalHealsOnTeammates",
    "totalTimeSpentDead", "totalTimeCCDealt", "turretTakedowns",
    "inhibitorTakedowns", "objectivesStolen", "objectivesStolenAssists",
    "damageDealtToBuildings",
    "summonerLevel", "championTransform", "placement", "subteamPlacement",
    "playerSubteamId",
  ])
  return Object.fromEntries(
    Object.entries(stats).filter(([key, value]) =>
      kept.has(key) && (typeof value === "number" || typeof value === "boolean"),
    ),
  ) as Record<string, number | boolean>
}

/** A Riot ID reads as `Name#TAG`; older payloads carry only a summoner name. */
function displayName(player?: {
  gameName?: string
  tagLine?: string
  summonerName?: string
}): string | undefined {
  if (!player) return undefined

  if (player.gameName && player.tagLine) {
    return `${player.gameName}#${player.tagLine}`
  }

  return player.gameName || player.summonerName || undefined
}

/**
 * Turns a game's full scoreboard into rows.
 *
 * Everything the client reports is kept. Once a game falls out of the client's
 * twenty-game window none of this can be fetched again, so there is no second
 * chance to decide a field was worth having.
 *
 * Returns an empty list when the local player is absent, since a lobby with no
 * anchor cannot be placed in their history.
 */
export function mapParticipants(
  detail: GameDetail,
  puuid: string,
): ParticipantRow[] {
  const gameId = detail.gameId
  if (!gameId || !detail.participants?.length) return []

  const identities = new Map(
    (detail.participantIdentities ?? []).map((entry) => [
      entry.participantId,
      entry.player,
    ]),
  )

  const mine = detail.participantIdentities?.find(
    (entry) => entry.player?.puuid === puuid,
  )
  if (!mine) return []

  return detail.participants.map((participant) => {
    const stats = participant.stats ?? {}
    const player = identities.get(participant.participantId)
    const gradeCoreFacts = assessGradeCoreFacts("league_client", {
      participant_id: participant.participantId,
      team_id: participant.teamId,
      champion_id: participant.championId,
      kills: stats.kills,
      deaths: stats.deaths,
      assists: stats.assists,
      gold_earned: stats.goldEarned,
      damage_to_champions: stats.totalDamageDealtToChampions,
      total_minions_killed: stats.totalMinionsKilled,
      neutral_minions: stats.neutralMinionsKilled,
      damage_objectives: stats.damageDealtToObjectives,
      damage_turrets: stats.damageDealtToTurrets,
      time_ccing_others: stats.timeCCingOthers,
      vision_score: stats.visionScore,
    })

    return {
      gameId,
      participantPuuid: player?.puuid,
      puuid,
      participantId: participant.participantId,
      teamId: participant.teamId,
      isPlayer: participant.participantId === mine.participantId ? 1 : 0,
      ...gradeCoreFacts,
      championId: int(participant.championId),
      win: bool(stats.win),
      summonerName: displayName(player),
      profileIcon: int(player?.profileIcon),
      spell1Id: int(participant.spell1Id),
      spell2Id: int(participant.spell2Id),
      items: [
        int(stats.item0),
        int(stats.item1),
        int(stats.item2),
        int(stats.item3),
        int(stats.item4),
        int(stats.item5),
        int(stats.item6),
      ],
      perkPrimaryStyle: int(stats.perkPrimaryStyle),
      perkSubStyle: int(stats.perkSubStyle),
      perks: [
        int(stats.perk0),
        int(stats.perk1),
        int(stats.perk2),
        int(stats.perk3),
        int(stats.perk4),
        int(stats.perk5),
      ],
      runeSelections: [
        ...Array.from({ length: 6 }, (_, slot) => ({
          runeId: int(stats[`perk${slot}`]),
          slot,
          var1: int(stats[`perk${slot}Var1`]),
          var2: int(stats[`perk${slot}Var2`]),
          var3: int(stats[`perk${slot}Var3`]),
          kind: "modern" as const,
        })),
        ...Array.from({ length: 3 }, (_, shard) => ({
          runeId: int(stats[`statPerk${shard}`]),
          slot: 6 + shard,
          var1: 0,
          var2: 0,
          var3: 0,
          kind: "modern" as const,
        })),
      ].filter((selection) => selection.runeId > 0),
      champLevel: int(stats.champLevel),
      kills: int(stats.kills),
      deaths: int(stats.deaths),
      assists: int(stats.assists),
      goldEarned: int(stats.goldEarned),
      goldSpent: int(stats.goldSpent),
      damageToChampions: int(stats.totalDamageDealtToChampions),
      totalDamageDealt: int(stats.totalDamageDealt),
      magicDamageToChampions: int(stats.magicDamageDealtToChampions),
      physicalDamageToChampions: int(stats.physicalDamageDealtToChampions),
      trueDamageToChampions: int(stats.trueDamageDealtToChampions),
      damageTaken: int(stats.totalDamageTaken),
      damageSelfMitigated: int(stats.damageSelfMitigated),
      totalHeal: int(stats.totalHeal),
      totalUnitsHealed: int(stats.totalUnitsHealed),
      timeCcingOthers: int(stats.timeCCingOthers),
      largestKillingSpree: int(stats.largestKillingSpree),
      largestMultiKill: int(stats.largestMultiKill),
      doubleKills: int(stats.doubleKills),
      tripleKills: int(stats.tripleKills),
      quadraKills: int(stats.quadraKills),
      pentaKills: int(stats.pentaKills),
      totalMinionsKilled: int(stats.totalMinionsKilled),
      neutralMinions: int(stats.neutralMinionsKilled),
      visionScore: int(stats.visionScore),
      wardsPlaced: int(stats.wardsPlaced),
      wardsKilled: int(stats.wardsKilled),
      controlWards: int(stats.visionWardsBoughtInGame),
      damageObjectives: int(stats.damageDealtToObjectives),
      damageTurrets: int(stats.damageDealtToTurrets),
      turretKills: int(stats.turretKills),
      inhibitorKills: int(stats.inhibitorKills),
      longestTimeLiving: int(stats.longestTimeSpentLiving),
      firstBlood: bool(stats.firstBloodKill),
      firstTower: bool(stats.firstTowerKill),
      lane: participant.timeline?.lane,
      role: participant.timeline?.role,
      controlWardsPurchased: optionalInt(stats.visionWardsBoughtInGame),
      totalHealsOnTeammates: optionalInt(stats.totalHealsOnTeammates),
      totalDamageShieldedOnTeammates: optionalInt(stats.totalDamageShieldedOnTeammates),
      damageDealtToBuildings: optionalInt(stats.damageDealtToBuildings),
      lcuLane: participant.timeline?.lane,
      lcuRole: participant.timeline?.role,
      resolvedPosition: normalizePosition({
        lcuLane: participant.timeline?.lane,
        lcuRole: participant.timeline?.role,
        spell1Id: int(participant.spell1Id),
        spell2Id: int(participant.spell2Id),
      }),
      positionResolverVersion: POSITION_RESOLVER_VERSION,
      augments: augmentValues(stats),
      extendedMetrics: extendedMetrics(stats),
    }
  })
}

/** Both sides of a recorded game, with their objectives and bans. */
export function mapTeams(detail: GameDetail, puuid: string): TeamRow[] {
  const gameId = detail.gameId
  if (!gameId || !detail.teams?.length) return []

  return detail.teams.map((team) => ({
    gameId,
    puuid,
    teamId: team.teamId,
    win: bool(team.win),
    bans: JSON.stringify((team.bans ?? []).map((ban) => ban.championId)),
    baronKills: int(team.baronKills),
    dragonKills: int(team.dragonKills),
    heraldKills: int(team.riftHeraldKills),
    hordeKills: int(team.hordeKills),
    towerKills: int(team.towerKills),
    inhibitorKills: int(team.inhibitorKills),
    firstBlood: bool(team.firstBlood),
    firstTower: bool(team.firstTower),
    firstBaron: bool(team.firstBaron),
    // The client really does spell this one "firstDargon".
    firstDragon: bool(team.firstDargon),
    firstInhibitor: bool(team.firstInhibitor),
  }))
}
