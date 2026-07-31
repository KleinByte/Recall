import type {
  CompactTimeline,
  CompactTimelineEvent,
  CompactTimelineFrame,
  CompactTimelineParticipantFrame,
} from "../riot/timeline-mapper.js"
import type { MatchRow, ParticipantRow } from "./types.js"
import type { PrioritizablePerformanceLabel } from "./labels.js"

interface TimelineLabelContext {
  match: MatchRow
  player: ParticipantRow
  participants: ParticipantRow[]
  timeline: CompactTimeline
}

type Point = { x: number; y: number }
type Lane = "TOP" | "MID" | "BOTTOM"

const role = (row: ParticipantRow) => (row.role ?? row.lane ?? "").toUpperCase()
const participates = (event: CompactTimelineEvent, participantId: number) =>
  event.participantId === participantId ||
  event.assistingParticipantIds?.includes(participantId) === true
const distance = (left: Point, right: Point) =>
  Math.hypot(left.x - right.x, left.y - right.y)
const clock = (timestamp: number) => {
  const seconds = Math.max(0, Math.floor(timestamp / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}
const compact = (value: number) => Math.round(value).toLocaleString("en-US")

// Summoner's Rift is roughly a 0..15,000 square. These intentionally broad
// zones avoid pretending the one-minute frame data is pixel-perfect.
function laneAt(point?: Point): Lane | undefined {
  if (!point) return undefined
  const { x, y } = point
  if ((x <= 3_000 && y >= 4_000) || (y >= 12_000 && x <= 11_000)) return "TOP"
  if ((y <= 3_000 && x >= 4_000) || (x >= 12_000 && y <= 11_000)) return "BOTTOM"
  if (x >= 2_000 && x <= 13_000 && y >= 2_000 && y <= 13_000 && Math.abs(x - y) <= 1_600) {
    return "MID"
  }
  return undefined
}

function isInTeamJungle(point: Point | undefined, teamId: number) {
  if (!point || laneAt(point)) return false
  const { x, y } = point
  if (x < 1_200 || y < 1_200 || x > 13_800 || y > 13_800) return false
  const diagonal = x + y
  // Exclude the river band around the anti-diagonal.
  if (Math.abs(diagonal - 15_000) < 1_200) return false
  return teamId === 100 ? diagonal < 15_000 : diagonal > 15_000
}

function isOnTeamSide(point: Point | undefined, teamId: number) {
  if (!point) return false
  return teamId === 100 ? point.x + point.y < 13_800 : point.x + point.y > 16_200
}

function nearestFrame(frames: CompactTimelineFrame[], timestamp: number) {
  return frames.reduce<CompactTimelineFrame | undefined>((best, frame) =>
    !best || Math.abs(frame.timestamp - timestamp) < Math.abs(best.timestamp - timestamp)
      ? frame
      : best, undefined)
}

function frameNear(frames: CompactTimelineFrame[], timestamp: number) {
  const frame = nearestFrame(frames, timestamp)
  return frame && Math.abs(frame.timestamp - timestamp) <= 90_000 ? frame : undefined
}

function frameAtOrBefore(frames: CompactTimelineFrame[], timestamp: number) {
  const frame = frames
    .filter((entry) => entry.timestamp <= timestamp)
    .sort((left, right) => right.timestamp - left.timestamp)[0]
  return frame && timestamp - frame.timestamp <= 90_000 ? frame : undefined
}

function participantAt(
  frame: CompactTimelineFrame | undefined,
  participantId: number,
): CompactTimelineParticipantFrame | undefined {
  return frame?.participants.find((entry) => entry.participantId === participantId)
}

function laneOpponent(player: ParticipantRow, participants: ParticipantRow[]) {
  const myRole = role(player)
  return participants.find((entry) =>
    entry.teamId !== player.teamId && role(entry) === myRole,
  )
}

/**
 * Timeline-only labels. Exact event labels use event coordinates/timestamps;
 * labels involving participant frames disclose that they use nearest-minute
 * snapshots and are marked inferred.
 */
export function evaluateTimelineLabels(
  context: TimelineLabelContext,
): PrioritizablePerformanceLabel[] {
  const { match, player, participants, timeline } = context
  if (match.modeFamily !== "sr" || match.isMatched !== 1 || timeline.frames.length === 0) return []

  const labels: PrioritizablePerformanceLabel[] = []
  const add = (label: Omit<PrioritizablePerformanceLabel, "source">) =>
    labels.push({ ...label, source: "timeline" })
  const ownerId = player.participantId
  const enemyTeamId = player.teamId === 100 ? 200 : 100
  const kills = timeline.events.filter((event) => event.type === "CHAMPION_KILL")
  const myKillContributions = kills.filter((event) => participates(event, ownerId))
  const myKills = kills.filter((event) => event.participantId === ownerId)
  const myDeaths = kills.filter((event) => event.targetId === ownerId)
  const objectives = timeline.events.filter((event) => event.type === "ELITE_MONSTER_KILL")
  const myObjectives = objectives.filter((event) =>
    event.teamId === player.teamId && participates(event, ownerId),
  )

  const firstKill = kills[0]
  if (firstKill?.participantId !== ownerId && firstKill?.assistingParticipantIds?.includes(ownerId)) {
    add({
      id: "first_blood_assist", name: "First Blood Assist", category: "Kills",
      polarity: "positive", confidence: "exact", priority: 78,
      tooltip: `You assisted the game's first champion kill at ${clock(firstKill.timestamp)}.`,
      evidence: { timestamp: firstKill.timestamp, victimParticipantId: firstKill.targetId ?? 0 },
    })
  }

  const invades = myKills.filter((event) => {
    if (event.timestamp >= 10 * 60_000 || !isInTeamJungle(event.position, enemyTeamId)) return false
    const victim = participants.find((entry) => entry.participantId === event.targetId)
    return victim?.teamId === enemyTeamId && role(victim) === "JUNGLE"
  })
  if (invades.length > 0) {
    const first = invades[0]
    add({
      id: "invader", name: "Invader", category: "Jungle", polarity: "positive",
      confidence: "strong", priority: 91, group: "early_map_play",
      tooltip: `You killed the enemy jungler in their own jungle at ${clock(first.timestamp)}, before 10 minutes.`,
      evidence: {
        kills: invades.length,
        firstTimestamp: first.timestamp,
        x: first.position?.x ?? 0,
        y: first.position?.y ?? 0,
      },
    })
  }

  const earlyKills = myKills.filter((event) => event.timestamp < 10 * 60_000)
  if (earlyKills.length >= 3) add({
    id: "early_predator", name: "Early Predator", category: "Kills", polarity: "positive",
    confidence: "exact", priority: 82, group: "early_map_play",
    tooltip: `You secured ${earlyKills.length} kills before 10 minutes.`,
    evidence: { killsBefore10: earlyKills.length },
  })

  const shutdowns = myKills.filter((event) => (event.shutdownBounty ?? 0) > 0)
  const shutdownGold = shutdowns.reduce((sum, event) => sum + (event.shutdownBounty ?? 0), 0)
  if (shutdownGold >= 800) add({
    id: "shutdown_collector", name: "Shutdown Collector", category: "Kills", polarity: "positive",
    confidence: "exact", priority: 83, group: "shutdowns",
    tooltip: `You collected ${compact(shutdownGold)} gold in shutdown bounties across ${shutdowns.length} kills.`,
    evidence: { shutdownGold, shutdowns: shutdowns.length },
  })
  const shutdownTargets = new Set(shutdowns.map((event) => event.targetId).filter(Boolean))
  if (shutdownTargets.size >= 3) add({
    id: "bounty_hunter", name: "Bounty Hunter", category: "Kills", polarity: "positive",
    confidence: "exact", priority: 80, group: "shutdowns",
    tooltip: `You claimed shutdowns from ${shutdownTargets.size} different enemies.`,
    evidence: { uniqueShutdownTargets: shutdownTargets.size },
  })

  const killsByTarget = new Map<number, number>()
  for (const event of myKills) if (event.targetId) {
    killsByTarget.set(event.targetId, (killsByTarget.get(event.targetId) ?? 0) + 1)
  }
  const mostKilled = Math.max(0, ...killsByTarget.values())
  if (mostKilled >= 4) add({
    id: "merciless", name: "Merciless", category: "Kills", polarity: "positive",
    confidence: "exact", priority: 76,
    tooltip: `You eliminated the same opponent ${mostKilled} times.`,
    evidence: { killsOnSameEnemy: mostKilled },
  })
  const deathsByKiller = new Map<number, number>()
  for (const event of myDeaths) if (event.participantId) {
    deathsByKiller.set(event.participantId, (deathsByKiller.get(event.participantId) ?? 0) + 1)
  }
  const mostDeaths = Math.max(0, ...deathsByKiller.values())
  if (mostDeaths >= 4) add({
    id: "marked_target", name: "Marked Target", category: "Survivability", polarity: "negative",
    confidence: "exact", priority: 75,
    tooltip: `The same opponent eliminated you ${mostDeaths} times.`,
    evidence: { deathsToSameEnemy: mostDeaths },
  })

  const earlyContributions = myKillContributions.filter((event) => event.timestamp < 15 * 60_000)
  const lateKills = myKills.filter((event) => event.timestamp >= 20 * 60_000)
  if (earlyContributions.length === 0 && lateKills.length >= 5) add({
    id: "late_bloomer", name: "Late Bloomer", category: "Kills", polarity: "mixed",
    confidence: "exact", priority: 72,
    tooltip: `You had no kill contributions before 15 minutes, then secured ${lateKills.length} kills after 20 minutes.`,
    evidence: { earlyContributions: 0, killsAfter20: lateKills.length },
  })

  const laneContributions = earlyContributions
    .map((event) => ({ event, lane: laneAt(event.position) }))
    .filter((entry): entry is { event: CompactTimelineEvent; lane: Lane } => Boolean(entry.lane))
  if (role(player) === "JUNGLE") {
    if (laneContributions.length >= 5) add({
      id: "gank_machine", name: "Gank Machine", category: "Jungle", polarity: "positive",
      confidence: "strong", priority: 80, group: "ganking",
      tooltip: `You contributed to ${laneContributions.length} lane kills before 15 minutes.`,
      evidence: { earlyLaneKillContributions: laneContributions.length },
    })
    const lanes = new Set(laneContributions.map((entry) => entry.lane))
    if (lanes.size === 3) add({
      id: "every_lane_wins", name: "Every Lane Wins", category: "Jungle", polarity: "positive",
      confidence: "strong", priority: 84, group: "ganking",
      tooltip: "You contributed to an early champion kill in top, middle, and bottom lane.",
      evidence: { lanes: "TOP,MID,BOTTOM", contributions: laneContributions.length },
    })
    const laneCounts = laneContributions.reduce<Record<string, number>>((counts, entry) => {
      counts[entry.lane] = (counts[entry.lane] ?? 0) + 1
      return counts
    }, {})
    const camped = Object.entries(laneCounts).sort((a, b) => b[1] - a[1])[0]
    if (camped && camped[1] >= 4) add({
      id: "camping_permit", name: "Camping Permit", category: "Jungle", polarity: "mixed",
      confidence: "strong", priority: 70, group: "ganking",
      tooltip: `You contributed to ${camped[1]} early kills in ${camped[0].toLowerCase()} lane.`,
      evidence: { lane: camped[0], contributions: camped[1] },
    })
  } else {
    const assignedLane = role(player) === "UTILITY" ? "BOTTOM" : role(player) as Lane
    const roams = laneContributions.filter((entry) => entry.lane !== assignedLane)
    if (roams.length >= 3) add({
      id: "roam_reward", name: "Roam Reward", category: "Laning & Economy", polarity: "positive",
      confidence: "strong", priority: 78, group: "early_map_play",
      tooltip: `You contributed to ${roams.length} early kills outside your assigned lane.`,
      evidence: { roamKillContributions: roams.length, assignedLane },
    })
  }

  const opposing = laneOpponent(player, participants)
  const goldDifferenceAt = (timestamp: number) => {
    if (!opposing) return undefined
    const frame = frameNear(timeline.frames, timestamp)
    const mine = participantAt(frame, ownerId)
    const theirs = participantAt(frame, opposing.participantId)
    return mine && theirs ? mine.totalGold - theirs.totalGold : undefined
  }
  const levelDifferenceAt = (timestamp: number) => {
    if (!opposing) return undefined
    const frame = frameNear(timeline.frames, timestamp)
    const mine = participantAt(frame, ownerId)
    const theirs = participantAt(frame, opposing.participantId)
    return mine && theirs ? mine.level - theirs.level : undefined
  }
  const gold10 = goldDifferenceAt(10 * 60_000)
  const gold15 = goldDifferenceAt(15 * 60_000)
  const gold20 = goldDifferenceAt(20 * 60_000)
  const level10 = levelDifferenceAt(10 * 60_000)
  const level15 = levelDifferenceAt(15 * 60_000)
  if (gold15 !== undefined && gold15 >= (role(player) === "JUNGLE" ? 1_000 : 1_200)) add({
    id: role(player) === "JUNGLE" ? "jungle_gap" : "lane_kingdom",
    name: role(player) === "JUNGLE" ? "Jungle Gap" : "Lane Kingdom",
    category: role(player) === "JUNGLE" ? "Jungle" : "Laning & Economy",
    polarity: "positive", confidence: "strong", priority: 81, group: "lane_lead",
    tooltip: `At the nearest 15-minute snapshot, you led your role opponent by ${compact(gold15)} gold.`,
    evidence: { goldDiff15: gold15, opponentParticipantId: opposing?.participantId ?? 0 },
  })
  if (gold10 !== undefined && gold10 >= 500) add({
    id: "early_lead", name: "Early Lead", category: "Laning & Economy", polarity: "positive",
    confidence: "strong", priority: 69, group: "lane_lead",
    tooltip: `At the nearest 10-minute snapshot, you led your role opponent by ${compact(gold10)} gold.`,
    evidence: { goldDiff10: gold10 },
  })
  if (gold10 !== undefined && gold20 !== undefined && gold10 <= -500 && gold20 >= 0) add({
    id: "comeback_lane", name: "Comeback Lane", category: "Laning & Economy", polarity: "positive",
    confidence: "strong", priority: 77, group: "lane_lead",
    tooltip: `You recovered from a ${compact(Math.abs(gold10))}-gold role deficit at 10 minutes to pull even by 20.`,
    evidence: { goldDiff10: gold10, goldDiff20: gold20 },
  })
  const finalFrame = timeline.frames.at(-1)
  const finalMine = participantAt(finalFrame, ownerId)
  const finalOpponent = opposing ? participantAt(finalFrame, opposing.participantId) : undefined
  const finalGoldDifference = finalMine && finalOpponent
    ? finalMine.totalGold - finalOpponent.totalGold
    : undefined
  if (gold15 !== undefined && gold15 >= 800 && finalGoldDifference !== undefined && finalGoldDifference < 0) add({
    id: "lead_lost", name: "Lead Lost", category: "Laning & Economy", polarity: "negative",
    confidence: "strong", priority: 76, group: "lane_lead",
    tooltip: `You led your role opponent by ${compact(gold15)} gold near 15 minutes but finished ${compact(Math.abs(finalGoldDifference))} gold behind.`,
    evidence: { goldDiff15: gold15, finalGoldDiff: finalGoldDifference },
  })
  if (level15 !== undefined && level15 <= -2) add({
    id: "xp_gap", name: "XP Gap", category: "Laning & Economy", polarity: "negative",
    confidence: "strong", priority: 73,
    tooltip: `At the nearest 15-minute snapshot, you were ${Math.abs(level15)} levels behind your role opponent.`,
    evidence: { levelDiff15: level15 },
  })
  if (role(player) === "JUNGLE" && level10 !== undefined && Math.abs(level10) >= 1) add({
    id: level10 > 0 ? "level_lead" : "level_down",
    name: level10 > 0 ? "Level Lead" : "Level Down", category: "Jungle",
    polarity: level10 > 0 ? "positive" : "negative", confidence: "strong", priority: 68,
    tooltip: `At the nearest 10-minute snapshot, you were ${Math.abs(level10)} ${Math.abs(level10) === 1 ? "level" : "levels"} ${level10 > 0 ? "ahead of" : "behind"} the enemy jungler.`,
    evidence: { levelDiff10: level10 },
  })

  let enemyJungleMonsters = 0
  for (let index = 1; index < timeline.frames.length; index += 1) {
    const previous = participantAt(timeline.frames[index - 1], ownerId)
    const current = participantAt(timeline.frames[index], ownerId)
    if (!previous || !current || !isInTeamJungle(current.position, enemyTeamId)) continue
    enemyJungleMonsters += Math.max(0, current.jungleMinionsKilled - previous.jungleMinionsKilled)
  }
  if (enemyJungleMonsters >= 12) add({
    id: "counter_jungler", name: "Counter Jungler", category: "Jungle", polarity: "positive",
    confidence: "inferred", priority: 75,
    tooltip: `Timeline snapshots attribute at least ${enemyJungleMonsters} jungle CS gains to you while you were in enemy-jungle territory.`,
    evidence: { inferredEnemyJungleCs: enemyJungleMonsters },
  })
  if (role(player) === "JUNGLE" && opposing) {
    let ownJungleMonstersLost = 0
    for (let index = 1; index < timeline.frames.length; index += 1) {
      const previous = participantAt(timeline.frames[index - 1], opposing.participantId)
      const current = participantAt(timeline.frames[index], opposing.participantId)
      if (!previous || !current || !isInTeamJungle(current.position, player.teamId)) continue
      ownJungleMonstersLost += Math.max(0, current.jungleMinionsKilled - previous.jungleMinionsKilled)
    }
    if (ownJungleMonstersLost >= 12) add({
      id: "jungle_invaded", name: "Jungle Invaded", category: "Jungle", polarity: "negative",
      confidence: "inferred", priority: 74,
      tooltip: `Timeline snapshots attribute at least ${ownJungleMonstersLost} enemy-jungler CS gains to your jungle territory.`,
      evidence: { inferredOwnJungleCsLost: ownJungleMonstersLost },
    })
  }

  const deepWards = timeline.events.filter((event) => {
    if (event.type !== "WARD_PLACED" || event.participantId !== ownerId) return false
    const observedPosition = event.position ??
      participantAt(frameNear(timeline.frames, event.timestamp), ownerId)?.position
    return isOnTeamSide(observedPosition, enemyTeamId)
  })
  if (deepWards.length >= 4) add({
    id: "deep_vision", name: "Deep Vision", category: "Vision", polarity: "positive",
    confidence: deepWards.every((event) => event.position) ? "strong" : "inferred",
    priority: 72, group: "vision",
    tooltip: deepWards.every((event) => event.position)
      ? `You placed ${deepWards.length} wards deep on the enemy side of the map.`
      : `You placed ${deepWards.length} wards while the nearest timeline snapshots put you on the enemy side.`,
    evidence: {
      deepWards: deepWards.length,
      exactEventPositions: deepWards.filter((event) => event.position).length,
    },
  })

  if (myObjectives.length >= 3) add({
    id: "objective_master", name: "Objective Master", category: "Objectives", polarity: "positive",
    confidence: "exact", priority: 77, group: "objectives",
    tooltip: `You directly participated in ${myObjectives.length} epic monster takedowns.`,
    evidence: { epicMonsterContributions: myObjectives.length },
  })
  const dragons = myObjectives.filter((event) => event.objective?.includes("DRAGON"))
  if (dragons.length >= 4) add({
    id: "dragon_slayer", name: "Dragon Slayer", category: "Objectives", polarity: "positive",
    confidence: "exact", priority: 82, group: "objectives",
    tooltip: `You directly participated in ${dragons.length} dragon takedowns.`,
    evidence: { dragonContributions: dragons.length },
  })
  const nearbyObjectives = objectives.filter((event) => {
    if (event.teamId !== player.teamId || !event.position) return false
    const mine = participantAt(frameNear(timeline.frames, event.timestamp), ownerId)
    return mine?.position && distance(mine.position, event.position) <= 3_000
  })
  if (nearbyObjectives.length >= 3) add({
    id: "objective_presence", name: "Objective Presence", category: "Objectives", polarity: "positive",
    confidence: "inferred", priority: 71, group: "objectives",
    tooltip: `At the nearest timeline snapshots, you were near ${nearbyObjectives.length} epic monsters your team secured.`,
    evidence: { nearbyObjectiveTakedowns: nearbyObjectives.length, radius: 3_000 },
  })

  const plateEvents = timeline.events.filter((event) =>
    event.type === "TURRET_PLATE_DESTROYED" && event.participantId === ownerId,
  )
  if (plateEvents.length >= 3) add({
    id: "plate_collector", name: "Plate Collector", category: "Objectives", polarity: "positive",
    confidence: "exact", priority: 73,
    tooltip: `You destroyed ${plateEvents.length} turret plates.`,
    evidence: { turretPlatesTaken: plateEvents.length },
  })
  const buildingEvents = timeline.events.filter((event) => event.type === "BUILDING_KILL")
  const myBuildings = buildingEvents.filter((event) => participates(event, ownerId))
  if (myBuildings.length >= 5) add({
    id: "tower_taker", name: "Tower Taker", category: "Objectives", polarity: "positive",
    confidence: "exact", priority: 76, group: "structures",
    tooltip: `You directly contributed to ${myBuildings.length} structure takedowns.`,
    evidence: { structureContributions: myBuildings.length },
  })
  const firstBuilding = buildingEvents[0]
  if (firstBuilding && participates(firstBuilding, ownerId)) add({
    id: "first_tower_pressure", name: "First Tower Pressure", category: "Objectives",
    polarity: "positive", confidence: "exact", priority: 71, group: "structures",
    tooltip: `You directly contributed to the first structure takedown at ${clock(firstBuilding.timestamp)}.`,
    evidence: { timestamp: firstBuilding.timestamp },
  })
  const inhibitorContributions = myBuildings.filter((event) =>
    event.objective?.includes("INHIBITOR"),
  )
  if (inhibitorContributions.length >= 2) add({
    id: "inhibitor_breaker", name: "Inhibitor Breaker", category: "Objectives",
    polarity: "positive", confidence: "exact", priority: 75, group: "structures",
    tooltip: `You directly contributed to destroying ${inhibitorContributions.length} inhibitors.`,
    evidence: { inhibitorContributions: inhibitorContributions.length },
  })
  const sideLaneStructures = myBuildings.filter((event) => {
    const lane = laneAt(event.position)
    return lane === "TOP" || lane === "BOTTOM"
  })
  if (sideLaneStructures.length >= 2) add({
    id: "splitpush_threat", name: "Splitpush Threat", category: "Macro", polarity: "positive",
    confidence: "strong", priority: 73, group: "structures",
    tooltip: `You directly contributed to ${sideLaneStructures.length} structure takedowns in side lanes.`,
    evidence: { sideLaneStructureContributions: sideLaneStructures.length },
  })

  const maxDeficit = Math.max(0, ...timeline.frames.map((frame) => {
    const difference = frame.blueGold - frame.redGold
    return player.teamId === 100 ? -difference : difference
  }))
  const maxLead = Math.max(0, ...timeline.frames.map((frame) => {
    const difference = frame.blueGold - frame.redGold
    return player.teamId === 100 ? difference : -difference
  }))
  if (player.win === 1 && maxDeficit >= 3_000) add({
    id: "comeback_king", name: "Comeback King", category: "Clutch & Comeback", polarity: "positive",
    confidence: "exact", priority: 88, group: "game_swing",
    tooltip: `Your team won after falling ${compact(maxDeficit)} gold behind.`,
    evidence: { maxGoldDeficit: maxDeficit },
  })
  if (player.win === 0 && maxLead >= 5_000) add({
    id: "lead_thrower", name: "Lead Thrower", category: "Clutch & Comeback", polarity: "negative",
    confidence: "exact", priority: 89, group: "game_swing",
    tooltip: `Your team lost after leading by ${compact(maxLead)} gold.`,
    evidence: { maxGoldLead: maxLead },
  })

  const isolatedDeaths = myDeaths.filter((event) => {
    if (!event.position) return false
    const frame = frameNear(timeline.frames, event.timestamp)
    return frame?.participants
      .filter((entry) => entry.teamId === player.teamId && entry.participantId !== ownerId && entry.position)
      .every((ally) => distance(event.position!, ally.position!) > 3_500) === true
  })
  if (isolatedDeaths.length >= 2) add({
    id: "caught_out", name: "Caught Out", category: "Survivability", polarity: "negative",
    confidence: "inferred", priority: 79, group: "position_deaths",
    tooltip: `On ${isolatedDeaths.length} deaths, no teammate was nearby in the nearest timeline snapshot.`,
    evidence: { inferredIsolatedDeaths: isolatedDeaths.length, allyRadius: 3_500 },
  })
  const overextended = isolatedDeaths.filter((event) => isOnTeamSide(event.position, enemyTeamId))
  if (overextended.length >= 3) add({
    id: "overextended", name: "Overextended", category: "Survivability", polarity: "negative",
    confidence: "inferred", priority: 81, group: "position_deaths",
    tooltip: `You died ${overextended.length} times on the enemy side while the nearest snapshot showed no teammate nearby.`,
    evidence: { inferredOverextendedDeaths: overextended.length, allyRadius: 3_500 },
  })
  const richDeaths = myDeaths.map((event) => ({
    event,
    currentGold: participantAt(frameAtOrBefore(timeline.frames, event.timestamp), ownerId)?.currentGold ?? 0,
  })).filter((entry) => entry.currentGold >= 1_500)
  if (richDeaths.length >= 1) {
    const richest = Math.max(...richDeaths.map((entry) => entry.currentGold))
    add({
      id: "shopping_with_a_fortune", name: "Shopping With a Fortune",
      category: "Survivability", polarity: "negative", confidence: "inferred", priority: 74,
      tooltip: `At the nearest timeline snapshot before a death, you were holding ${compact(richest)} unspent gold.`,
      evidence: { deathsWithAtLeast1500Gold: richDeaths.length, maxObservedCurrentGold: richest },
    })
  }

  return labels
}
