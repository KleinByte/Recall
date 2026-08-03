import type {
  LiveGameEvent,
  LiveGamePlayer,
  LiveGameSnapshot,
} from "./game-client.js"

export type LiveEstimateQuality = "building" | "fair" | "strong"
export type TempoDirection = "up" | "steady" | "down"
export type TempoSurgeTier = "gold" | "emerald" | "diamond" | "master"

export interface LiveResourceAnalysis {
  allyGold: number
  enemyGold: number
  difference: number
  quality: LiveEstimateQuality
  source: "estimated"
}

export interface LiveWinConfidence {
  percent: number
  label: "Strongly favored" | "Favored" | "Even" | "Under pressure" | "Long shot"
  factors: string[]
}

export interface LiveTempoAnalysis {
  score: number
  label: "Surging" | "Building" | "Stable" | "Slipping" | "Collapsing" |
    "Double Kill" | "Triple Kill" | "Quadra Kill" | "Pentakill"
  direction: TempoDirection
  leadDelta: number
  factors: string[]
  surgeTier?: TempoSurgeTier
}

export interface LiveGameAnalysis {
  resources: LiveResourceAnalysis
  winConfidence: LiveWinConfidence
  tempo: LiveTempoAnalysis
}

interface LiveAnalysisState {
  gameTime: number
  updatedAt: number
  goldDifference: number
  killDifference: number
  objectiveDifference: number
  alliedDeaths: number
  localDeaths: number
  tempo: number
  lastEventId: number
  surgeTier?: TempoSurgeTier
  surgeUntil?: number
}

interface LiveSignals {
  resources: LiveResourceAnalysis
  allyKills: number
  enemyKills: number
  allyObjectives: number
  enemyObjectives: number
  allyDeaths: number
  enemyDeaths: number
  allyDead: number
  enemyDead: number
  localDeaths: number
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value))

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

function inventoryValue(player: LiveGamePlayer) {
  return sum(player.items
    .filter((item) => !item.consumable)
    .map((item) => Math.max(0, item.price) * Math.max(1, item.count)))
}

/**
 * Live Client Data omits other players' unspent gold. This symmetric estimate
 * uses only fields available for both teams and visible inventory as a floor.
 */
export function estimatePlayerGold(
  player: LiveGamePlayer,
  gameTime: number,
  aram = false,
) {
  const startingGold = aram ? 1_400 : 500
  const passiveStartsAt = aram ? 45 : 110
  const passivePerSecond = aram ? 3.0 : 2.04
  const passive = Math.max(0, gameTime - passiveStartsAt) * passivePerSecond
  const activity =
    player.scores.creepScore * 19 +
    player.scores.kills * 300 +
    player.scores.assists * 100
  return Math.round(Math.max(
    inventoryValue(player),
    startingGold + passive + activity,
  ))
}

function teamGold(players: LiveGamePlayer[], gameTime: number, aram: boolean) {
  return sum(players.map((player) => estimatePlayerGold(player, gameTime, aram)))
}

function identityAliases(value?: string) {
  const normalized = value?.trim().toLocaleLowerCase()
  if (!normalized) return []
  const gameName = normalized.split("#")[0]
  return gameName === normalized ? [normalized] : [normalized, gameName]
}

function eventTeam(
  event: LiveGameEvent,
  allies: ReadonlySet<string>,
  enemies: ReadonlySet<string>,
) {
  const aliases = identityAliases(event.killerName)
  if (aliases.some((alias) => allies.has(alias))) return "ally"
  if (aliases.some((alias) => enemies.has(alias))) return "enemy"
  return undefined
}

function objectiveWeight(name: string) {
  switch (name) {
    case "BaronKill": return 2.5
    case "InhibKilled": return 1.5
    case "DragonKill": return 1.2
    case "TurretKilled": return 1
    case "HeraldKill": return .8
    default: return 0
  }
}

function objectiveScores(snapshot: LiveGameSnapshot) {
  const aliases = (player: LiveGamePlayer) => [
    ...identityAliases(player.riotId),
    ...identityAliases(player.championName),
  ]
  const allies = new Set(snapshot.allies.flatMap(aliases))
  const enemies = new Set(snapshot.enemies.flatMap(aliases))
  let ally = 0
  let enemy = 0
  for (const event of snapshot.events) {
    const weight = objectiveWeight(event.name)
    if (weight === 0) continue
    const team = eventTeam(event, allies, enemies)
    if (team === "ally") ally += weight
    if (team === "enemy") enemy += weight
  }
  return { ally, enemy }
}

interface TempoEventSwing {
  impact: number
  factors: string[]
  floor?: number
  ceiling?: number
  surgeTier?: TempoSurgeTier
}

function latestEventId(snapshot: LiveGameSnapshot) {
  return snapshot.events.reduce((latest, event) => Math.max(latest, event.id), -1)
}

function multikillCount(event: LiveGameEvent) {
  if (event.multiKill && event.multiKill >= 2) return clamp(Math.round(event.multiKill), 2, 5)
  const result = event.result?.toLocaleLowerCase() ?? ""
  if (result.includes("penta")) return 5
  if (result.includes("quadra")) return 4
  if (result.includes("triple")) return 3
  if (result.includes("double")) return 2
  return 0
}

function surgeTier(count: number): TempoSurgeTier | undefined {
  if (count >= 5) return "master"
  if (count === 4) return "diamond"
  if (count === 3) return "emerald"
  if (count === 2) return "gold"
  return undefined
}

function surgeName(tier?: TempoSurgeTier): LiveTempoAnalysis["label"] | undefined {
  if (tier === "master") return "Pentakill"
  if (tier === "diamond") return "Quadra Kill"
  if (tier === "emerald") return "Triple Kill"
  if (tier === "gold") return "Double Kill"
  return undefined
}

function surgeCount(tier?: TempoSurgeTier) {
  return tier === "master" ? 5 : tier === "diamond" ? 4 : tier === "emerald" ? 3 : tier === "gold" ? 2 : 0
}

function objectiveName(eventName: string) {
  if (eventName === "BaronKill") return "baron"
  if (eventName === "DragonKill") return "dragon"
  if (eventName === "HeraldKill") return "herald"
  if (eventName === "TurretKilled") return "turret"
  if (eventName === "InhibKilled") return "inhibitor"
  return "objective"
}

/**
 * Scores discrete events separately from standing resources. These moments are
 * intentionally stronger than a modest gold deficit because they create the
 * map windows players actually experience as tempo swings.
 */
function tempoEventSwing(snapshot: LiveGameSnapshot, afterEventId: number): TempoEventSwing {
  const aliases = (player: LiveGamePlayer) => [
    ...identityAliases(player.riotId),
    ...identityAliases(player.championName),
  ]
  const allies = new Set(snapshot.allies.flatMap(aliases))
  const enemies = new Set(snapshot.enemies.flatMap(aliases))
  const ordered = [...snapshot.events].sort((left, right) =>
    left.time - right.time || left.id - right.id)
  const fresh = ordered.filter((event) => event.id > afterEventId)
  if (fresh.length === 0) return { impact: 0, factors: [] }

  let impact = 0
  let floor: number | undefined
  let ceiling: number | undefined
  let strongestTier: TempoSurgeTier | undefined
  const factors: string[] = []
  const addFloor = (value: number) => { floor = Math.max(floor ?? 0, value) }
  const addCeiling = (value: number) => { ceiling = Math.min(ceiling ?? 100, value) }

  for (const event of fresh) {
    const weight = objectiveWeight(event.name)
    if (weight > 0) {
      const team = eventTeam(event, allies, enemies)
      if (team === "ally") {
        impact += weight * 10
        addFloor(60 + weight * 7)
        factors.push(`Secured ${objectiveName(event.name)} tempo`)
      } else if (team === "enemy") {
        impact -= weight * 10
        addCeiling(40 - weight * 7)
        factors.push("Conceded the latest objective window")
      }
    }

    if (event.name === "Multikill") {
      const count = multikillCount(event)
      const tier = surgeTier(count)
      const team = eventTeam(event, allies, enemies)
      if (!tier || !team) continue
      const name = surgeName(tier) ?? "Multikill"
      if (team === "ally") {
        impact += 42 + (count - 2) * 5
        strongestTier = !strongestTier || count > surgeCount(strongestTier)
          ? tier
          : strongestTier
        factors.unshift(`Allied ${name.toLocaleLowerCase()} seized maximum tempo`)
      } else {
        impact -= 42 + (count - 2) * 5
        addCeiling(0)
        factors.unshift(`Enemy ${name.toLocaleLowerCase()} broke team tempo`)
      }
    }
  }

  const streaks = new Map<string, number>()
  for (const event of ordered) {
    if (event.name !== "ChampionKill") continue
    const killer = identityAliases(event.killerName)[0]
    const victim = identityAliases(event.victimName)[0]
    const victimStreak = victim ? streaks.get(victim) ?? 0 : 0
    if (victim) streaks.set(victim, 0)
    const nextStreak = killer ? (streaks.get(killer) ?? 0) + 1 : 0
    if (killer) streaks.set(killer, nextStreak)
    if (event.id <= afterEventId) continue
    const team = eventTeam(event, allies, enemies)
    const sign = team === "ally" ? 1 : team === "enemy" ? -1 : 0
    if (sign === 0) continue
    if (nextStreak >= 3) {
      const spreeImpact = Math.min(18, 9 + nextStreak * 2)
      impact += spreeImpact * sign
      if (sign > 0) {
        addFloor(66)
        factors.push(`${event.killerName ?? "An ally"} is on a ${nextStreak}-kill spree`)
      } else {
        addCeiling(34)
        factors.push("Enemy killing spree is accelerating")
      }
    }
    if (victimStreak >= 3) {
      impact += 15 * sign
      if (sign > 0) {
        addFloor(70)
        factors.push(`Broke a ${victimStreak}-kill enemy spree`)
      } else {
        addCeiling(30)
        factors.push("An allied killing spree was shut down")
      }
    }
  }

  const freshKills = fresh.filter((event) => event.name === "ChampionKill")
  if (freshKills.length) {
    const latestKillTime = Math.max(...freshKills.map((event) => event.time))
    const fight = ordered.filter((event) =>
      event.name === "ChampionKill" &&
      event.time >= latestKillTime - 12 &&
      event.time <= latestKillTime + 1)
    const allyKills = fight.filter((event) => eventTeam(event, allies, enemies) === "ally").length
    const enemyKills = fight.filter((event) => eventTeam(event, allies, enemies) === "enemy").length
    if (allyKills >= 2 && allyKills - enemyKills >= 2) {
      impact += 28 + Math.min(10, (allyKills - 2) * 4)
      addFloor(78)
      factors.unshift(`Won the teamfight ${allyKills}–${enemyKills}`)
    } else if (enemyKills >= 2 && enemyKills - allyKills >= 2) {
      impact -= 28 + Math.min(10, (enemyKills - 2) * 4)
      addCeiling(22)
      factors.unshift(`Lost the teamfight ${allyKills}–${enemyKills}`)
    }
  }

  return {
    impact: clamp(impact, -65, 65),
    factors: [...new Set(factors)].slice(0, 3),
    floor,
    ceiling,
    surgeTier: strongestTier,
  }
}

function estimateQuality(snapshot: LiveGameSnapshot): LiveEstimateQuality {
  const completeRoster = snapshot.allies.length >= 5 && snapshot.enemies.length >= 5
  if (completeRoster && snapshot.gameTime >= 8 * 60) return "strong"
  if (snapshot.allies.length >= 3 && snapshot.enemies.length >= 3 && snapshot.gameTime >= 3 * 60) {
    return "fair"
  }
  return "building"
}

function signals(snapshot: LiveGameSnapshot): LiveSignals | undefined {
  if (
    snapshot.allies.length === 0 ||
    snapshot.enemies.length === 0 ||
    snapshot.allies.length !== snapshot.enemies.length
  ) return undefined
  const aram = snapshot.mapNumber === 12 || snapshot.gameMode?.toUpperCase().includes("ARAM") === true
  const allyGold = teamGold(snapshot.allies, snapshot.gameTime, aram)
  const enemyGold = teamGold(snapshot.enemies, snapshot.gameTime, aram)
  const objectives = objectiveScores(snapshot)
  return {
    resources: {
      allyGold,
      enemyGold,
      difference: allyGold - enemyGold,
      quality: estimateQuality(snapshot),
      source: "estimated",
    },
    allyKills: sum(snapshot.allies.map((player) => player.scores.kills)),
    enemyKills: sum(snapshot.enemies.map((player) => player.scores.kills)),
    allyObjectives: objectives.ally,
    enemyObjectives: objectives.enemy,
    allyDeaths: sum(snapshot.allies.map((player) => player.scores.deaths)),
    enemyDeaths: sum(snapshot.enemies.map((player) => player.scores.deaths)),
    allyDead: snapshot.allies.filter((player) => player.isDead).length,
    enemyDead: snapshot.enemies.filter((player) => player.isDead).length,
    localDeaths: snapshot.allies.find((player) => player.isLocal)?.scores.deaths ?? 0,
  }
}

function winLabel(percent: number): LiveWinConfidence["label"] {
  if (percent >= 68) return "Strongly favored"
  if (percent >= 56) return "Favored"
  if (percent >= 45) return "Even"
  if (percent >= 32) return "Under pressure"
  return "Long shot"
}

function signedGold(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : ""
  return `${sign}${Math.abs(Math.round(value)).toLocaleString()}g`
}

export function liveWinConfidence(
  snapshot: LiveGameSnapshot,
  current: LiveSignals,
): LiveWinConfidence {
  const killDifference = current.allyKills - current.enemyKills
  const objectiveDifference = current.allyObjectives - current.enemyObjectives
  const aliveDifference = current.enemyDead - current.allyDead
  const averageGold = (current.resources.allyGold + current.resources.enemyGold) / 2
  const goldScale = Math.max(2_200, averageGold * .14)
  const signal =
    current.resources.difference / goldScale +
    killDifference * .12 +
    objectiveDifference * .22 +
    aliveDifference * .07
  const raw = 1 / (1 + Math.exp(-signal))
  const maturity = .35 + .65 * clamp((snapshot.gameTime - 120) / 1_500, 0, 1)
  const percent = clamp(Math.round((.5 + (raw - .5) * maturity) * 100), 8, 92)
  const factors = [
    Math.abs(current.resources.difference) >= 400
      ? `${signedGold(current.resources.difference)} estimated resource edge`
      : "Resources remain close",
    killDifference !== 0
      ? `${Math.abs(killDifference)}-kill ${killDifference > 0 ? "advantage" : "deficit"}`
      : undefined,
    Math.abs(objectiveDifference) >= .8
      ? `${objectiveDifference > 0 ? "Ahead" : "Behind"} in major objectives`
      : undefined,
    aliveDifference !== 0
      ? `${Math.abs(aliveDifference)}-player live map advantage`
      : undefined,
  ].filter((entry): entry is string => Boolean(entry))
  return { percent, label: winLabel(percent), factors: factors.slice(0, 3) }
}

function tempoLabel(score: number): LiveTempoAnalysis["label"] {
  if (score >= 72) return "Surging"
  if (score >= 58) return "Building"
  if (score >= 43) return "Stable"
  if (score >= 28) return "Slipping"
  return "Collapsing"
}

function tempoStateScore(snapshot: LiveGameSnapshot, current: LiveSignals) {
  const killDifference = current.allyKills - current.enemyKills
  const objectiveDifference = current.allyObjectives - current.enemyObjectives
  const aliveDifference = current.enemyDead - current.allyDead
  const averageGold = (current.resources.allyGold + current.resources.enemyGold) / 2
  const goldScale = Math.max(1_500, averageGold * .075)
  const expectedLocalDeaths = Math.max(1, snapshot.gameTime / (5 * 60))
  const excessLocalDeaths = Math.max(0, current.localDeaths - expectedLocalDeaths)

  return clamp(
    50 +
      clamp(current.resources.difference / goldScale, -1, 1) * 14 +
      clamp(killDifference / 6, -1, 1) * 24 +
      clamp(objectiveDifference / 3, -1, 1) * 14 +
      clamp(aliveDifference / 3, -1, 1) * 8 -
      clamp(excessLocalDeaths / 4, 0, 1) * 8,
    0,
    100,
  )
}

function standingTempoFactors(current: LiveSignals) {
  const killDifference = current.allyKills - current.enemyKills
  const objectiveDifference = current.allyObjectives - current.enemyObjectives
  return [
    Math.abs(current.resources.difference) >= 400
      ? `${signedGold(current.resources.difference)} current resource ${current.resources.difference > 0 ? "lead" : "deficit"}`
      : "Resources remain close",
    killDifference !== 0
      ? `${Math.abs(killDifference)}-kill ${killDifference > 0 ? "advantage" : "deficit"}`
      : "Kills remain even",
    Math.abs(objectiveDifference) >= .8
      ? `${objectiveDifference > 0 ? "Ahead" : "Behind"} in major objectives`
      : undefined,
  ].filter((entry): entry is string => Boolean(entry))
}

/** Maintains a smoothed, per-game execution score across the two-second feed. */
export class LiveTempoTracker {
  private previous?: LiveAnalysisState

  reset() {
    this.previous = undefined
  }

  update(snapshot: LiveGameSnapshot): LiveGameAnalysis | undefined {
    const current = signals(snapshot)
    if (!current) return undefined
    const killDifference = current.allyKills - current.enemyKills
    const objectiveDifference = current.allyObjectives - current.enemyObjectives
    const winConfidence = liveWinConfidence(snapshot, current)
    const stateScore = tempoStateScore(snapshot, current)
    let tempo = Math.round(stateScore)
    let direction: TempoDirection = "steady"
    let leadDelta = 0
    let factors = standingTempoFactors(current).slice(0, 3)
    let activeSurgeTier: TempoSurgeTier | undefined
    let surgeUntil: number | undefined
    const currentLastEventId = latestEventId(snapshot)

    if (this.previous && snapshot.gameTime >= this.previous.gameTime) {
      const eventSwing = tempoEventSwing(snapshot, this.previous.lastEventId)
      const elapsed = clamp(snapshot.gameTime - this.previous.gameTime, 1, 30)
      leadDelta = current.resources.difference - this.previous.goldDifference
      const leadRate = clamp(leadDelta / elapsed * 60, -1_800, 1_800)
      const killSwing = killDifference - this.previous.killDifference
      const objectiveSwing = objectiveDifference - this.previous.objectiveDifference
      const alliedDeaths = current.allyDeaths - this.previous.alliedDeaths
      const personalDeaths = current.localDeaths - this.previous.localDeaths
      const throwPenalty = this.previous.goldDifference >= 1_500 && leadDelta <= -500
        ? this.previous.goldDifference >= 3_000 ? 18 : 12
        : 0
      const cleanWindow = stateScore >= 50 && alliedDeaths === 0 && leadDelta >= 0 ? 2 : 0
      const flowScore = clamp(
        50 +
          clamp(leadRate / 220, -8, 8) +
          clamp(killSwing * 5, -15, 15) +
          clamp(objectiveSwing * 5, -10, 10) +
          eventSwing.impact -
          Math.max(0, alliedDeaths) * 3 -
          Math.max(0, personalDeaths) * 7 +
          cleanWindow,
        0,
        100,
      )
      const instantaneous = clamp(stateScore * .45 + flowScore * .55 - throwPenalty, 0, 100)
      const alpha = clamp(elapsed / 10, .24, .55)
      tempo = Math.round(this.previous.tempo + (instantaneous - this.previous.tempo) * alpha)
      if (eventSwing.floor !== undefined) tempo = Math.max(tempo, Math.round(eventSwing.floor))
      if (eventSwing.ceiling !== undefined) tempo = Math.min(tempo, Math.round(eventSwing.ceiling))

      if (eventSwing.surgeTier) {
        activeSurgeTier = eventSwing.surgeTier
        surgeUntil = snapshot.gameTime + 6
        tempo = 100
      } else if (
        eventSwing.impact >= 0 &&
        this.previous.surgeTier &&
        (this.previous.surgeUntil ?? 0) >= snapshot.gameTime
      ) {
        activeSurgeTier = this.previous.surgeTier
        surgeUntil = this.previous.surgeUntil
        tempo = 100
      }
      direction = tempo >= this.previous.tempo + 2
        ? "up"
        : tempo <= this.previous.tempo - 2
          ? "down"
          : "steady"
      factors = [
        ...eventSwing.factors,
        activeSurgeTier
          ? `${surgeName(activeSurgeTier)} is holding maximum tempo`
          : undefined,
        leadDelta >= 150
          ? `${signedGold(leadDelta)} lead gained this window`
          : leadDelta <= -150
            ? `${signedGold(leadDelta)} lead swing this window`
            : standingTempoFactors(current)[0],
        personalDeaths > 0 ? "Your death reduced team tempo" : undefined,
        killSwing > 0
          ? "Won the latest takedown trade"
          : killSwing < 0
            ? "Lost the latest takedown trade"
            : standingTempoFactors(current)[1],
        objectiveSwing > 0
          ? "Secured the latest objective swing"
          : objectiveSwing < 0
            ? "Conceded the latest objective swing"
            : throwPenalty > 0
              ? "A previous lead is being returned"
              : standingTempoFactors(current)[2],
      ].filter((entry): entry is string => Boolean(entry)).filter((entry, index, entries) =>
        entries.indexOf(entry) === index).slice(0, 3)
    }

    this.previous = {
      gameTime: snapshot.gameTime,
      updatedAt: snapshot.updatedAt,
      goldDifference: current.resources.difference,
      killDifference,
      objectiveDifference,
      alliedDeaths: current.allyDeaths,
      localDeaths: current.localDeaths,
      tempo,
      lastEventId: currentLastEventId,
      surgeTier: activeSurgeTier,
      surgeUntil,
    }

    return {
      resources: current.resources,
      winConfidence,
      tempo: {
        score: tempo,
        label: surgeName(activeSurgeTier) ?? tempoLabel(tempo),
        direction,
        leadDelta,
        factors,
        surgeTier: activeSurgeTier,
      },
    }
  }
}
