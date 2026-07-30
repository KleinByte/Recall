import type { GradeInput } from "../matches/grade.js"
import { mapMatchRow } from "../matches/map-match.js"
import type { QueueInfo } from "../matches/queues.js"
import type {
  LcuGame,
  LcuParticipantStats,
  MatchRow,
  ParticipantRow,
  TeamRow,
} from "../matches/types.js"

interface RiotPerks {
  styles?: {
    style?: number
    selections?: { perk?: number }[]
  }[]
}

export interface RiotMatchParticipant {
  [key: string]: unknown
  participantId?: number
  puuid?: string
  riotIdGameName?: string
  riotIdTagline?: string
  summonerName?: string
  profileIcon?: number
  championId?: number
  teamId?: number
  win?: boolean
  summoner1Id?: number
  summoner2Id?: number
  item0?: number
  item1?: number
  item2?: number
  item3?: number
  item4?: number
  item5?: number
  item6?: number
  perks?: RiotPerks
  champLevel?: number
  kills?: number
  deaths?: number
  assists?: number
  goldEarned?: number
  goldSpent?: number
  totalDamageDealtToChampions?: number
  totalDamageDealt?: number
  magicDamageDealtToChampions?: number
  physicalDamageDealtToChampions?: number
  trueDamageDealtToChampions?: number
  totalDamageTaken?: number
  damageSelfMitigated?: number
  totalHeal?: number
  totalUnitsHealed?: number
  timeCCingOthers?: number
  largestKillingSpree?: number
  largestMultiKill?: number
  doubleKills?: number
  tripleKills?: number
  quadraKills?: number
  pentaKills?: number
  totalMinionsKilled?: number
  neutralMinionsKilled?: number
  visionScore?: number
  wardsPlaced?: number
  wardsKilled?: number
  visionWardsBoughtInGame?: number
  damageDealtToObjectives?: number
  damageDealtToTurrets?: number
  turretKills?: number
  inhibitorKills?: number
  longestTimeSpentLiving?: number
  firstBloodKill?: boolean
  firstTowerKill?: boolean
  playerAugment1?: number
  playerAugment2?: number
  playerAugment3?: number
  playerAugment4?: number
  playerAugment5?: number
  playerAugment6?: number
  totalDamageShieldedOnTeammates?: number
  totalHealsOnTeammates?: number
  totalTimeSpentDead?: number
  totalTimeCCDealt?: number
  turretTakedowns?: number
  inhibitorTakedowns?: number
  objectivesStolen?: number
  objectivesStolenAssists?: number
  summonerLevel?: number
  championTransform?: number
  placement?: number
  subteamPlacement?: number
  playerSubteamId?: number
  challenges?: Record<string, number | boolean | undefined>
  gameEndedInSurrender?: boolean
  gameEndedInEarlySurrender?: boolean
  lane?: string
  role?: string
  teamPosition?: string
  individualPosition?: string
}

interface RiotObjective {
  first?: boolean
  kills?: number
}

export interface RiotMatchDto {
  metadata?: { matchId?: string }
  info?: {
    gameId?: number
    gameCreation?: number
    gameStartTimestamp?: number
    gameEndTimestamp?: number
    gameDuration?: number
    gameMode?: string
    gameType?: string
    gameVersion?: string
    queueId?: number
    mapId?: number
    participants?: RiotMatchParticipant[]
    teams?: {
      teamId?: number
      win?: boolean
      bans?: { championId?: number }[]
      objectives?: {
        baron?: RiotObjective
        champion?: RiotObjective
        dragon?: RiotObjective
        horde?: RiotObjective
        inhibitor?: RiotObjective
        riftHerald?: RiotObjective
        tower?: RiotObjective
      }
    }[]
  }
}

export interface MappedRiotMatch {
  match: MatchRow
  participants: ParticipantRow[]
  teams: TeamRow[]
  gradeInputs: GradeInput[]
  unknownParticipantFields: string[]
}

const int = (value: number | undefined) =>
  Number.isFinite(value) ? Math.trunc(value!) : 0
const bool = (value: boolean | undefined) => (value ? 1 : 0)

const KNOWN_PARTICIPANT_FIELDS = new Set([
  "participantId", "puuid", "riotIdGameName", "riotIdTagline", "summonerName",
  "profileIcon", "championId", "teamId", "win", "summoner1Id", "summoner2Id",
  "item0", "item1", "item2", "item3", "item4", "item5", "item6", "perks",
  "champLevel", "kills", "deaths", "assists", "goldEarned", "goldSpent",
  "totalDamageDealtToChampions", "totalDamageDealt", "magicDamageDealtToChampions",
  "physicalDamageDealtToChampions", "trueDamageDealtToChampions",
  "totalDamageTaken", "damageSelfMitigated", "totalHeal", "totalUnitsHealed",
  "timeCCingOthers", "largestKillingSpree", "largestMultiKill", "doubleKills",
  "tripleKills", "quadraKills", "pentaKills", "totalMinionsKilled",
  "neutralMinionsKilled", "visionScore", "wardsPlaced", "wardsKilled",
  "visionWardsBoughtInGame", "damageDealtToObjectives", "damageDealtToTurrets",
  "turretKills", "inhibitorKills", "longestTimeSpentLiving", "firstBloodKill",
  "firstTowerKill", "gameEndedInSurrender", "gameEndedInEarlySurrender", "lane",
  "role", "teamPosition", "individualPosition", "playerAugment1",
  "playerAugment2", "playerAugment3", "playerAugment4", "playerAugment5",
  "playerAugment6", "totalDamageShieldedOnTeammates", "totalHealsOnTeammates",
  "totalTimeSpentDead", "totalTimeCCDealt", "turretTakedowns",
  "inhibitorTakedowns", "objectivesStolen", "objectivesStolenAssists",
  "summonerLevel", "championTransform", "placement", "subteamPlacement",
  "playerSubteamId", "challenges",
])

function extendedMetrics(participant: RiotMatchParticipant) {
  const metrics: Record<string, number | boolean | string> = {}
  for (const key of [
    "totalDamageShieldedOnTeammates", "totalHealsOnTeammates",
    "totalTimeSpentDead", "totalTimeCCDealt", "turretTakedowns",
    "inhibitorTakedowns", "objectivesStolen", "objectivesStolenAssists",
    "summonerLevel", "championTransform", "placement", "subteamPlacement",
    "playerSubteamId",
  ]) {
    const value = participant[key]
    if (typeof value === "number" && Number.isFinite(value)) metrics[key] = value
  }
  for (const [key, value] of Object.entries(participant.challenges ?? {})) {
    if (typeof value === "number" || typeof value === "boolean") {
      metrics[`challenge.${key}`] = value
    }
  }
  return metrics
}

function durationSeconds(info: NonNullable<RiotMatchDto["info"]>) {
  const duration = int(info.gameDuration)
  // Riot documented older Match-V5 records in milliseconds.
  if (duration > 100_000) return Math.round(duration / 1_000)
  if (duration > 0) return duration

  const elapsed = int(info.gameEndTimestamp) - int(info.gameStartTimestamp)
  return elapsed > 0 ? Math.round(elapsed / 1_000) : 0
}

function laneFor(participant: RiotMatchParticipant) {
  return participant.lane || participant.teamPosition || undefined
}

function positionFor(participant: RiotMatchParticipant) {
  return (
    participant.individualPosition ||
    participant.teamPosition ||
    participant.lane ||
    participant.role ||
    undefined
  )
}

function displayName(participant: RiotMatchParticipant) {
  if (participant.riotIdGameName && participant.riotIdTagline) {
    return `${participant.riotIdGameName}#${participant.riotIdTagline}`
  }
  return participant.riotIdGameName || participant.summonerName || undefined
}

function lcuStats(participant: RiotMatchParticipant): LcuParticipantStats {
  return {
    win: participant.win ?? false,
    kills: int(participant.kills),
    deaths: int(participant.deaths),
    assists: int(participant.assists),
    champLevel: int(participant.champLevel),
    goldEarned: int(participant.goldEarned),
    totalDamageDealtToChampions: int(participant.totalDamageDealtToChampions),
    totalDamageTaken: int(participant.totalDamageTaken),
    damageSelfMitigated: int(participant.damageSelfMitigated),
    totalHeal: int(participant.totalHeal),
    totalUnitsHealed: int(participant.totalUnitsHealed),
    timeCCingOthers: int(participant.timeCCingOthers),
    largestKillingSpree: int(participant.largestKillingSpree),
    largestMultiKill: int(participant.largestMultiKill),
    doubleKills: int(participant.doubleKills),
    tripleKills: int(participant.tripleKills),
    quadraKills: int(participant.quadraKills),
    pentaKills: int(participant.pentaKills),
    totalMinionsKilled: int(participant.totalMinionsKilled),
    visionScore: int(participant.visionScore),
    gameEndedInSurrender: participant.gameEndedInSurrender ?? false,
    gameEndedInEarlySurrender:
      participant.gameEndedInEarlySurrender ?? false,
    neutralMinionsKilled: int(participant.neutralMinionsKilled),
    wardsPlaced: int(participant.wardsPlaced),
    wardsKilled: int(participant.wardsKilled),
    visionWardsBoughtInGame: int(participant.visionWardsBoughtInGame),
    damageDealtToObjectives: int(participant.damageDealtToObjectives),
    damageDealtToTurrets: int(participant.damageDealtToTurrets),
    turretKills: int(participant.turretKills),
    inhibitorKills: int(participant.inhibitorKills),
    firstBloodKill: participant.firstBloodKill ?? false,
  }
}

export function mapRiotMatch(
  dto: RiotMatchDto,
  ownerPuuid: string,
  queue?: QueueInfo,
  participantPuuid = ownerPuuid,
): MappedRiotMatch | undefined {
  const info = dto.info
  if (!info?.gameId || !info.participants?.length) return undefined

  const mine = info.participants.find(
    (participant) => participant.puuid === participantPuuid,
  )
  if (!mine) return undefined

  const duration = durationSeconds(info)
  const game: LcuGame = {
    gameId: info.gameId,
    gameCreation: int(info.gameStartTimestamp || info.gameCreation),
    gameDuration: duration,
    gameMode: info.gameMode ?? "",
    gameType: info.gameType ?? "MATCHED_GAME",
    gameVersion: info.gameVersion ?? "",
    queueId: int(info.queueId),
    mapId: int(info.mapId),
    participants: [
      {
        championId: int(mine.championId),
        stats: lcuStats(mine),
        timeline: { lane: laneFor(mine), role: positionFor(mine) },
      },
    ],
  }
  const match = mapMatchRow(game, ownerPuuid, queue)
  if (!match) return undefined
  match.riotMatchId =
    typeof dto.metadata?.matchId === "string" && dto.metadata.matchId.length > 0
      ? dto.metadata.matchId
      : undefined

  const participants = info.participants.map((participant, index) => {
    const styles = participant.perks?.styles ?? []
    const perks = styles.flatMap((style) =>
      (style.selections ?? []).map((selection) => int(selection.perk)),
    )

    return {
      gameId: info.gameId!,
      puuid: ownerPuuid,
      participantId: int(participant.participantId) || index + 1,
      teamId: int(participant.teamId),
      isPlayer: participant.puuid === participantPuuid ? 1 : 0,
      championId: int(participant.championId),
      win: bool(participant.win),
      summonerName: displayName(participant),
      profileIcon: int(participant.profileIcon),
      spell1Id: int(participant.summoner1Id),
      spell2Id: int(participant.summoner2Id),
      items: [
        int(participant.item0),
        int(participant.item1),
        int(participant.item2),
        int(participant.item3),
        int(participant.item4),
        int(participant.item5),
        int(participant.item6),
      ],
      perkPrimaryStyle: int(styles[0]?.style),
      perkSubStyle: int(styles[1]?.style),
      perks: Array.from({ length: 6 }, (_, perk) => perks[perk] ?? 0),
      champLevel: int(participant.champLevel),
      kills: int(participant.kills),
      deaths: int(participant.deaths),
      assists: int(participant.assists),
      goldEarned: int(participant.goldEarned),
      goldSpent: int(participant.goldSpent),
      damageToChampions: int(participant.totalDamageDealtToChampions),
      totalDamageDealt: int(participant.totalDamageDealt),
      magicDamageToChampions: int(participant.magicDamageDealtToChampions),
      physicalDamageToChampions: int(
        participant.physicalDamageDealtToChampions,
      ),
      trueDamageToChampions: int(participant.trueDamageDealtToChampions),
      damageTaken: int(participant.totalDamageTaken),
      damageSelfMitigated: int(participant.damageSelfMitigated),
      totalHeal: int(participant.totalHeal),
      totalUnitsHealed: int(participant.totalUnitsHealed),
      timeCcingOthers: int(participant.timeCCingOthers),
      largestKillingSpree: int(participant.largestKillingSpree),
      largestMultiKill: int(participant.largestMultiKill),
      doubleKills: int(participant.doubleKills),
      tripleKills: int(participant.tripleKills),
      quadraKills: int(participant.quadraKills),
      pentaKills: int(participant.pentaKills),
      totalMinionsKilled: int(participant.totalMinionsKilled),
      neutralMinions: int(participant.neutralMinionsKilled),
      visionScore: int(participant.visionScore),
      wardsPlaced: int(participant.wardsPlaced),
      wardsKilled: int(participant.wardsKilled),
      controlWards: int(participant.visionWardsBoughtInGame),
      damageObjectives: int(participant.damageDealtToObjectives),
      damageTurrets: int(participant.damageDealtToTurrets),
      turretKills: int(participant.turretKills),
      inhibitorKills: int(participant.inhibitorKills),
      longestTimeLiving: int(participant.longestTimeSpentLiving),
      firstBlood: bool(participant.firstBloodKill),
      firstTower: bool(participant.firstTowerKill),
      lane: laneFor(participant),
      role: positionFor(participant),
      augments: [
        participant.playerAugment1,
        participant.playerAugment2,
        participant.playerAugment3,
        participant.playerAugment4,
        participant.playerAugment5,
        participant.playerAugment6,
      ].flatMap((augmentId, index) =>
        typeof augmentId === "number" && augmentId > 0
          ? [{
            slot: index + 1,
            augmentId: int(augmentId),
            source: "match_v5" as const,
          }]
          : [],
      ),
      extendedMetrics: extendedMetrics(participant),
    } satisfies ParticipantRow
  })

  const teams = (info.teams ?? []).map((team) => ({
    gameId: info.gameId!,
    puuid: ownerPuuid,
    teamId: int(team.teamId),
    win: bool(team.win),
    bans: JSON.stringify(
      (team.bans ?? []).map((ban) => int(ban.championId)),
    ),
    baronKills: int(team.objectives?.baron?.kills),
    dragonKills: int(team.objectives?.dragon?.kills),
    heraldKills: int(team.objectives?.riftHerald?.kills),
    hordeKills: int(team.objectives?.horde?.kills),
    towerKills: int(team.objectives?.tower?.kills),
    inhibitorKills: int(team.objectives?.inhibitor?.kills),
    firstBlood: bool(team.objectives?.champion?.first),
    firstTower: bool(team.objectives?.tower?.first),
    firstBaron: bool(team.objectives?.baron?.first),
    firstDragon: bool(team.objectives?.dragon?.first),
    firstInhibitor: bool(team.objectives?.inhibitor?.first),
  } satisfies TeamRow))

  const minutes = Math.max(1, duration / 60)
  const gradeInputs = participants.map((participant) => ({
    participantId: participant.participantId,
    teamId: participant.teamId,
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    damageToChampions: participant.damageToChampions,
    damageTaken: participant.damageTaken,
    goldEarned: participant.goldEarned,
    csPerMin:
      (participant.totalMinionsKilled + participant.neutralMinions) / minutes,
    visionScore: participant.visionScore,
    damageObjectives: participant.damageObjectives,
    role: participant.role,
  }))

  const unknownParticipantFields = [...new Set(
    info.participants.flatMap((participant) =>
      Object.keys(participant).filter((key) => !KNOWN_PARTICIPANT_FIELDS.has(key)),
    ),
  )]
  return { match, participants, teams, gradeInputs, unknownParticipantFields }
}
