import type { CompactTimeline, CompactTimelineEvent, CompactTimelineFrame } from "../riot/timeline-mapper.js"
import type { MatchRow, TrackedMode } from "./types.js"

export type RecordCategory =
  | "Performance"
  | "Combat"
  | "Economy"
  | "Objectives"
  | "Vision"
  | "Timeline"
  | "Special modes"

export type RecordFormat =
  | "compact"
  | "decimal"
  | "percent"
  | "duration"
  | "per-minute"

export interface PersonalRecord {
  key: string
  label: string
  category: RecordCategory
  format: RecordFormat
  value: number
  gameId: number
  championId: number
  playedAt: number
  mode: TrackedMode
  source: "match" | "scoreboard" | "timeline"
}

export interface RecordParticipant {
  participantId: number
  teamId: number
  isPlayer: number
  kills: number
  deaths: number
  assists: number
  goldEarned: number
  damageToChampions: number
  damageObjectives: number
  role?: string
  lane?: string
  assignedPosition?: string
  longestTimeLiving: number
  totalHealOnTeammates: number
  totalDamageShieldedOnTeammates: number
  objectivesStolen: number
  turretPlatesTaken: number
  extendedMetrics: Record<string, number | boolean | string>
}

export interface RecordContext {
  match: MatchRow
  player?: RecordParticipant
  participants: RecordParticipant[]
  timeline?: CompactTimeline
  augmentCount: number
  firstAugmentAtMs?: number
}

export function recordScopeForMatch(match: MatchRow): {
  mode?: TrackedMode
  modes?: TrackedMode[]
} {
  if (match.mode === "aram" || match.mode === "mayhem" ||
      match.mode === "league_classic" || match.mode === "sr_ranked_solo") {
    return { mode: match.mode }
  }
  if (match.modeFamily === "sr") {
    return {
      modes: [
        "sr_ranked_solo",
        "sr_ranked_flex",
        "sr_normal",
        "sr_quickplay",
        "sr_swiftplay",
      ],
    }
  }
  return { mode: match.mode }
}

interface RecordDefinition {
  key: string
  label: string
  category: RecordCategory
  format?: RecordFormat
  source?: PersonalRecord["source"]
  direction?: "highest" | "lowest"
  value: (context: RecordContext) => number | undefined
}

const minutes = (match: MatchRow) => Math.max(1, match.durationSecs / 60)
const owner = (context: RecordContext) => context.player
const team = (context: RecordContext) => context.participants.filter((entry) =>
  entry.teamId === context.player?.teamId,
)
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const positive = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
const finite = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) ? value : undefined

function teamShare(context: RecordContext, field: "damageToChampions" | "goldEarned" | "damageObjectives") {
  const player = owner(context)
  if (!player) return undefined
  const total = sum(team(context).map((entry) => entry[field]))
  return total > 0 ? player[field] / total * 100 : undefined
}

function killParticipation(context: RecordContext) {
  const player = owner(context)
  if (!player) return undefined
  const teamKills = sum(team(context).map((entry) => entry.kills))
  return teamKills > 0 ? (player.kills + player.assists) / teamKills * 100 : undefined
}

function damagePerGold(context: RecordContext) {
  return context.match.goldEarned > 0
    ? context.match.damageToChampions / context.match.goldEarned * 1_000
    : undefined
}

function combatConversion(context: RecordContext) {
  const takedowns = context.match.kills + context.match.assists
  if (takedowns === 0 || context.match.goldEarned <= 0) return undefined
  return takedowns / Math.max(1, context.match.deaths + 1) /
    Math.max(1, context.match.goldEarned / 1_000)
}

function carryScore(context: RecordContext) {
  const participation = killParticipation(context)
  const damage = teamShare(context, "damageToChampions")
  const efficiency = damagePerGold(context)
  if (participation === undefined || damage === undefined || efficiency === undefined) return undefined
  return damage * .45 + participation * .35 + Math.min(100, efficiency / 30) * .20
}

function teamDamageGap(context: RecordContext) {
  const player = owner(context)
  if (!player) return undefined
  const next = Math.max(0, ...team(context)
    .filter((entry) => entry.participantId !== player.participantId)
    .map((entry) => entry.damageToChampions))
  return positive(player.damageToChampions - next)
}

function normalizedPosition(participant: RecordParticipant) {
  for (const value of [participant.assignedPosition, participant.role, participant.lane]) {
    const normalized = value?.toUpperCase()
    if (normalized === "MID") return "MIDDLE"
    if (normalized === "BOT" || normalized === "CARRY" || normalized === "DUO_CARRY") return "BOTTOM"
    if (normalized === "SUPPORT" || normalized === "DUO_SUPPORT") return "UTILITY"
    if (["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"].includes(normalized ?? "")) return normalized
  }
  return undefined
}

function opponent(context: RecordContext) {
  const player = owner(context)
  const position = player ? normalizedPosition(player) : undefined
  if (!player || !position) return undefined
  return context.participants.find((entry) =>
    entry.teamId !== player.teamId && normalizedPosition(entry) === position,
  )
}

function frameParticipant(frame: CompactTimelineFrame, participantId: number) {
  return frame.participants.find((entry) => entry.participantId === participantId)
}

function closestFrame(context: RecordContext, timestamp: number) {
  const frames = context.timeline?.frames ?? []
  return frames.reduce<CompactTimelineFrame | undefined>((closest, frame) =>
    !closest || Math.abs(frame.timestamp - timestamp) < Math.abs(closest.timestamp - timestamp)
      ? frame
      : closest, undefined)
}

function goldLeadAt(context: RecordContext, timestamp: number) {
  const player = owner(context)
  const rival = opponent(context)
  const frame = closestFrame(context, timestamp)
  if (!player || !rival || !frame) return undefined
  const mine = frameParticipant(frame, player.participantId)?.totalGold
  const theirs = frameParticipant(frame, rival.participantId)?.totalGold
  return mine !== undefined && theirs !== undefined ? mine - theirs : undefined
}

function csLeadAt(context: RecordContext, timestamp: number) {
  const player = owner(context)
  const rival = opponent(context)
  const frame = closestFrame(context, timestamp)
  if (!player || !rival || !frame) return undefined
  const mine = frameParticipant(frame, player.participantId)
  const theirs = frameParticipant(frame, rival.participantId)
  return mine && theirs
    ? mine.minionsKilled + mine.jungleMinionsKilled - theirs.minionsKilled - theirs.jungleMinionsKilled
    : undefined
}

function teamDifference(context: RecordContext, frame: CompactTimelineFrame) {
  const player = owner(context)
  if (!player) return 0
  return player.teamId === 100
    ? frame.blueGold - frame.redGold
    : frame.redGold - frame.blueGold
}

function largestTeamLead(context: RecordContext) {
  return positive(Math.max(...(context.timeline?.frames ?? []).map((frame) => teamDifference(context, frame))))
}

function biggestComeback(context: RecordContext) {
  if (!context.match.win) return undefined
  return positive(Math.max(...(context.timeline?.frames ?? []).map((frame) => -teamDifference(context, frame))))
}

function biggestPersonalLead(context: RecordContext) {
  const player = owner(context)
  const rival = opponent(context)
  if (!player || !rival) return undefined
  return positive(Math.max(...(context.timeline?.frames ?? []).map((frame) => {
    const mine = frameParticipant(frame, player.participantId)?.totalGold ?? 0
    const theirs = frameParticipant(frame, rival.participantId)?.totalGold ?? 0
    return mine - theirs
  })))
}

function tempoSwing(context: RecordContext) {
  const player = owner(context)
  if (!player) return undefined
  return positive(Math.max(...(context.timeline?.turningPoints ?? []).map((point) =>
    player.teamId === 100 ? point.swing : -point.swing,
  )))
}

function postAugmentTempoSwing(context: RecordContext) {
  if (context.firstAugmentAtMs === undefined) return undefined
  const player = owner(context)
  if (!player) return undefined
  return positive(Math.max(...(context.timeline?.turningPoints ?? [])
    .filter((point) => point.timestamp >= context.firstAugmentAtMs!)
    .map((point) => player.teamId === 100 ? point.swing : -point.swing)))
}

function ownerKills(context: RecordContext) {
  const participantId = owner(context)?.participantId
  if (!participantId) return []
  return (context.timeline?.events ?? [])
    .filter((event) => event.type === "CHAMPION_KILL" && event.participantId === participantId)
    .sort((left, right) => left.timestamp - right.timestamp)
}

function fastestKills(context: RecordContext, count: number) {
  const kills = ownerKills(context)
  if (kills.length < count) return undefined
  let fastest = Number.POSITIVE_INFINITY
  for (let index = count - 1; index < kills.length; index += 1) {
    fastest = Math.min(fastest, kills[index].timestamp - kills[index - count + 1].timestamp)
  }
  const seconds = fastest / 1_000
  return seconds <= 15 ? finite(seconds) : undefined
}

function mostKillsInWindow(context: RecordContext, windowMs: number) {
  const kills = ownerKills(context)
  let best = 0
  let start = 0
  for (let end = 0; end < kills.length; end += 1) {
    while (kills[end].timestamp - kills[start].timestamp > windowMs) start += 1
    best = Math.max(best, end - start + 1)
  }
  return positive(best)
}

function longestDeathless(context: RecordContext) {
  const participantId = owner(context)?.participantId
  if (!participantId || !context.timeline) return undefined
  const deaths = context.timeline.events
    .filter((event) => event.type === "CHAMPION_KILL" && event.targetId === participantId)
    .map((event) => event.timestamp / 1_000)
    .sort((left, right) => left - right)
  const points = [0, ...deaths, context.match.durationSecs]
  let longest = 0
  for (let index = 1; index < points.length; index += 1) {
    longest = Math.max(longest, points[index] - points[index - 1])
  }
  return positive(longest)
}

function involved(event: CompactTimelineEvent, participantId: number) {
  return event.participantId === participantId ||
    event.assistingParticipantIds?.includes(participantId) === true
}

function earliestFirstBlood(context: RecordContext) {
  const participantId = owner(context)?.participantId
  const first = (context.timeline?.events ?? [])
    .filter((event) => event.type === "CHAMPION_KILL")
    .sort((left, right) => left.timestamp - right.timestamp)[0]
  return participantId && first && involved(first, participantId)
    ? first.timestamp / 1_000
    : undefined
}

function earliestTurret(context: RecordContext) {
  const participantId = owner(context)?.participantId
  if (!participantId) return undefined
  const event = (context.timeline?.events ?? [])
    .filter((entry) => entry.type === "BUILDING_KILL" && /TOWER|TURRET/i.test(entry.objective ?? ""))
    .sort((left, right) => left.timestamp - right.timestamp)[0]
  return event && involved(event, participantId) ? event.timestamp / 1_000 : undefined
}

function objectiveEvents(context: RecordContext) {
  return (context.timeline?.events ?? []).filter((event) => event.type === "ELITE_MONSTER_KILL")
}

function objectivesSecured(context: RecordContext) {
  const participantId = owner(context)?.participantId
  if (!participantId) return undefined
  return positive(objectiveEvents(context).filter((event) => involved(event, participantId)).length)
}

function objectiveParticipation(context: RecordContext) {
  const player = owner(context)
  if (!player) return undefined
  const teamEvents = objectiveEvents(context).filter((event) => event.teamId === player.teamId)
  return teamEvents.length
    ? teamEvents.filter((event) => involved(event, player.participantId)).length / teamEvents.length * 100
    : undefined
}

function teamfightParticipation(context: RecordContext) {
  const player = owner(context)
  if (!player || !context.timeline) return undefined
  const kills = context.timeline.events
    .filter((event) => event.type === "CHAMPION_KILL")
    .sort((left, right) => left.timestamp - right.timestamp)
  const teamfightKills: CompactTimelineEvent[] = []
  for (const event of kills) {
    const nearby = kills.filter((candidate) => Math.abs(candidate.timestamp - event.timestamp) <= 12_000)
    if (nearby.length >= 3 && event.teamId === player.teamId) teamfightKills.push(event)
  }
  if (!teamfightKills.length) return undefined
  return teamfightKills.filter((event) => involved(event, player.participantId)).length /
    teamfightKills.length * 100
}

function closingSequence(context: RecordContext) {
  if (!context.match.win || !context.timeline?.frames.length) return undefined
  const finalTimestamp = context.match.durationSecs * 1_000
  const frame = context.timeline.frames.find((entry, index, frames) =>
    teamDifference(context, entry) >= 2_500 &&
    frames.slice(index).every((later) => teamDifference(context, later) > 0),
  )
  return frame ? Math.max(0, finalTimestamp - frame.timestamp) / 1_000 : undefined
}

function augmentDamage(context: RecordContext) {
  const metrics = owner(context)?.extendedMetrics ?? {}
  const values = Object.entries(metrics).flatMap(([key, value]) =>
    /augment/i.test(key) && /damage/i.test(key) && typeof value === "number" ? [value] : [],
  )
  return positive(sum(values))
}

const DEFINITIONS: RecordDefinition[] = [
  { key: "grade", label: "Highest Recall grade", category: "Performance", format: "decimal", value: ({ match }) => match.gradeScore },
  { key: "kills", label: "Most kills", category: "Combat", value: ({ match }) => positive(match.kills) },
  { key: "assists", label: "Most assists", category: "Combat", value: ({ match }) => positive(match.assists) },
  { key: "damage", label: "Most champion damage", category: "Combat", value: ({ match }) => positive(match.damageToChampions) },
  { key: "damage_taken", label: "Most damage taken", category: "Combat", value: ({ match }) => positive(match.damageTaken) },
  { key: "damage_mitigated", label: "Most damage mitigated", category: "Combat", value: ({ match }) => positive(match.damageSelfMitigated) },
  { key: "healing", label: "Most healing", category: "Combat", value: ({ match }) => positive(match.totalHeal) },
  { key: "crowd_control", label: "Most crowd-control time", category: "Combat", format: "duration", value: ({ match }) => positive(match.timeCcingOthers) },
  { key: "spree", label: "Longest killing spree", category: "Combat", value: ({ match }) => positive(match.largestKillingSpree) },
  { key: "kda", label: "Best KDA", category: "Combat", format: "decimal", value: ({ match }) => positive((match.kills + match.assists) / Math.max(1, match.deaths)) },
  { key: "double_kills", label: "Most double kills", category: "Combat", value: ({ match }) => positive(match.doubleKills) },
  { key: "triple_kills", label: "Most triple kills", category: "Combat", value: ({ match }) => positive(match.tripleKills) },
  { key: "quadra_kills", label: "Most quadra kills", category: "Combat", value: ({ match }) => positive(match.quadraKills) },
  { key: "penta_kills", label: "Most pentakills", category: "Combat", value: ({ match }) => positive(match.pentaKills) },
  { key: "longest_life", label: "Longest time alive", category: "Combat", format: "duration", source: "scoreboard", value: (context) => positive(owner(context)?.longestTimeLiving) },
  { key: "gold", label: "Most gold earned", category: "Economy", value: ({ match }) => positive(match.goldEarned) },
  { key: "cs", label: "Most creep score", category: "Economy", value: ({ match }) => positive(match.totalMinionsKilled + match.neutralMinions) },
  { key: "damage_per_minute", label: "Highest damage per minute", category: "Economy", format: "per-minute", value: ({ match }) => positive(match.damageToChampions / minutes(match)) },
  { key: "gold_per_minute", label: "Highest gold per minute", category: "Economy", format: "per-minute", value: ({ match }) => positive(match.goldPerMin ?? match.goldEarned / minutes(match)) },
  { key: "cs_per_minute", label: "Highest CS per minute", category: "Economy", format: "per-minute", value: ({ match }) => positive(match.csPerMin ?? (match.totalMinionsKilled + match.neutralMinions) / minutes(match)) },
  { key: "damage_per_gold", label: "Most efficient damage", category: "Economy", format: "decimal", source: "scoreboard", value: damagePerGold },
  { key: "combat_conversion", label: "Best combat conversion", category: "Economy", format: "decimal", source: "scoreboard", value: combatConversion },
  { key: "kill_participation", label: "Highest kill participation", category: "Performance", format: "percent", source: "scoreboard", value: killParticipation },
  { key: "damage_share", label: "Highest damage share", category: "Performance", format: "percent", source: "scoreboard", value: (context) => teamShare(context, "damageToChampions") },
  { key: "gold_share", label: "Highest gold share", category: "Performance", format: "percent", source: "scoreboard", value: (context) => teamShare(context, "goldEarned") },
  { key: "objective_share", label: "Highest objective contribution", category: "Performance", format: "percent", source: "scoreboard", value: (context) => teamShare(context, "damageObjectives") },
  { key: "carry_score", label: "Biggest carry performance", category: "Performance", format: "decimal", source: "scoreboard", value: carryScore },
  { key: "team_damage_gap", label: "Largest team damage gap", category: "Performance", source: "scoreboard", value: teamDamageGap },
  { key: "teamfight_participation", label: "Most teamfight participation", category: "Performance", format: "percent", source: "timeline", value: teamfightParticipation },
  { key: "objective_damage", label: "Most objective damage", category: "Objectives", value: ({ match }) => positive(match.damageObjectives) },
  { key: "turret_damage", label: "Most turret damage", category: "Objectives", value: ({ match }) => positive(match.damageTurrets) },
  { key: "turrets", label: "Most turrets destroyed", category: "Objectives", value: ({ match }) => positive(match.turretKills) },
  { key: "inhibitors", label: "Most inhibitors destroyed", category: "Objectives", value: ({ match }) => positive(match.inhibitorKills) },
  { key: "objectives_secured", label: "Most objectives secured", category: "Objectives", source: "timeline", value: objectivesSecured },
  { key: "objective_participation", label: "Highest objective participation", category: "Objectives", format: "percent", source: "timeline", value: objectiveParticipation },
  { key: "objective_steals", label: "Most objective steals", category: "Objectives", source: "scoreboard", value: (context) => positive(owner(context)?.objectivesStolen) },
  { key: "vision", label: "Highest vision score", category: "Vision", value: ({ match }) => positive(match.visionScore) },
  { key: "wards_placed", label: "Most wards placed", category: "Vision", value: ({ match }) => positive(match.wardsPlaced) },
  { key: "wards_destroyed", label: "Most wards destroyed", category: "Vision", value: ({ match }) => positive(match.wardsKilled) },
  { key: "control_wards", label: "Most control wards", category: "Vision", value: ({ match }) => positive(match.controlWards) },
  { key: "vision_per_minute", label: "Highest vision per minute", category: "Vision", format: "per-minute", value: ({ match }) => positive(match.visionScore / minutes(match)) },
  { key: "fastest_win", label: "Fastest victory", category: "Performance", format: "duration", direction: "lowest", value: ({ match }) => match.win && !match.endedInEarlySurrender && match.durationSecs >= 300 ? match.durationSecs : undefined },
  { key: "longest_game", label: "Longest game", category: "Performance", format: "duration", value: ({ match }) => positive(match.durationSecs) },
  { key: "biggest_comeback", label: "Biggest comeback victory", category: "Timeline", source: "timeline", value: biggestComeback },
  { key: "largest_team_lead", label: "Largest lead established", category: "Timeline", source: "timeline", value: largestTeamLead },
  { key: "largest_personal_lead", label: "Largest personal gold lead", category: "Timeline", source: "timeline", value: biggestPersonalLead },
  { key: "largest_tempo_swing", label: "Largest Tempo swing", category: "Timeline", source: "timeline", value: tempoSwing },
  { key: "fastest_double", label: "Fastest double kill", category: "Timeline", format: "duration", source: "timeline", direction: "lowest", value: (context) => fastestKills(context, 2) },
  { key: "fastest_triple", label: "Fastest triple kill", category: "Timeline", format: "duration", source: "timeline", direction: "lowest", value: (context) => fastestKills(context, 3) },
  { key: "fastest_quadra", label: "Fastest quadra kill", category: "Timeline", format: "duration", source: "timeline", direction: "lowest", value: (context) => fastestKills(context, 4) },
  { key: "fastest_penta", label: "Fastest pentakill", category: "Timeline", format: "duration", source: "timeline", direction: "lowest", value: (context) => fastestKills(context, 5) },
  { key: "kills_in_minute", label: "Most kills in 60 seconds", category: "Timeline", source: "timeline", value: (context) => mostKillsInWindow(context, 60_000) },
  { key: "longest_deathless", label: "Longest deathless stretch", category: "Timeline", format: "duration", source: "timeline", value: longestDeathless },
  { key: "earliest_first_blood", label: "Earliest first blood", category: "Timeline", format: "duration", source: "timeline", direction: "lowest", value: earliestFirstBlood },
  { key: "fastest_first_turret", label: "Fastest first turret", category: "Timeline", format: "duration", source: "timeline", direction: "lowest", value: earliestTurret },
  { key: "best_closing_sequence", label: "Best closing sequence", category: "Timeline", format: "duration", source: "timeline", direction: "lowest", value: closingSequence },
  { key: "lane_gold_10", label: "Largest lane gold lead at 10", category: "Timeline", source: "timeline", value: (context) => positive(goldLeadAt(context, 600_000)) },
  { key: "lane_gold_15", label: "Largest lane gold lead at 15", category: "Timeline", source: "timeline", value: (context) => positive(goldLeadAt(context, 900_000)) },
  { key: "lane_cs_10", label: "Largest CS lead at 10", category: "Timeline", source: "timeline", value: (context) => positive(csLeadAt(context, 600_000)) },
  { key: "lane_cs_15", label: "Largest CS lead at 15", category: "Timeline", source: "timeline", value: (context) => positive(csLeadAt(context, 900_000)) },
  { key: "turret_plates", label: "Most turret plates", category: "Objectives", source: "scoreboard", value: (context) => positive(owner(context)?.turretPlatesTaken) },
  { key: "ally_healing", label: "Most ally healing", category: "Special modes", source: "scoreboard", value: (context) => positive(owner(context)?.totalHealOnTeammates) },
  { key: "ally_shielding", label: "Most ally shielding", category: "Special modes", source: "scoreboard", value: (context) => positive(owner(context)?.totalDamageShieldedOnTeammates) },
  { key: "jungle_cs", label: "Most neutral monster CS", category: "Special modes", value: ({ match }) => positive(match.neutralMinions) },
  { key: "augment_damage", label: "Most augment-derived damage", category: "Special modes", source: "scoreboard", value: (context) => context.match.mode === "mayhem" ? augmentDamage(context) : undefined },
  { key: "augment_game", label: "Strongest augment game", category: "Special modes", format: "decimal", source: "scoreboard", value: (context) => context.match.mode === "mayhem" && context.augmentCount > 0 ? context.match.gradeScore : undefined },
  { key: "mayhem_tempo", label: "Highest post-augment Tempo swing", category: "Special modes", source: "timeline", value: (context) => context.match.mode === "mayhem" && context.augmentCount > 0 ? postAugmentTempoSwing(context) : undefined },
]

export function evaluateRecords(contexts: RecordContext[]): PersonalRecord[] {
  return DEFINITIONS.flatMap((definition) => {
    let best: { context: RecordContext; value: number } | undefined
    for (const context of contexts) {
      const value = finite(definition.value(context))
      if (value === undefined) continue
      const earlierTie = best && value === best.value && (
        context.match.playedAt < best.context.match.playedAt ||
        context.match.playedAt === best.context.match.playedAt &&
          context.match.gameId < best.context.match.gameId
      )
      const wins = !best || earlierTie || (definition.direction === "lowest"
        ? value < best.value
        : value > best.value)
      if (wins) best = { context, value }
    }
    if (!best) return []
    const { match } = best.context
    return [{
      key: definition.key,
      label: definition.label,
      category: definition.category,
      format: definition.format ?? "compact",
      value: best.value,
      gameId: match.gameId,
      championId: match.championId,
      playedAt: match.playedAt,
      mode: match.mode,
      source: definition.source ?? "match",
    }]
  })
}
