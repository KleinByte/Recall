import type {
  LiveGameEvent,
  LiveGamePlayer,
  LiveGameSnapshot,
} from "./game-client.js"

export type LiveEstimateQuality = "building" | "fair" | "strong"
export type TempoDirection = "up" | "steady" | "down"

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
  label: "Surging" | "Building" | "Stable" | "Slipping" | "Collapsing"
  direction: TempoDirection
  leadDelta: number
  factors: string[]
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
    let tempo = 50
    let direction: TempoDirection = "steady"
    let leadDelta = 0
    let factors = ["Building a live baseline"]

    if (this.previous && snapshot.gameTime >= this.previous.gameTime) {
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
      const cleanWindow = alliedDeaths === 0 && leadDelta >= 0 ? 3 : 0
      const instantaneous = clamp(
        50 +
          clamp(leadRate / 82, -22, 22) +
          clamp(killSwing * 8, -18, 18) +
          clamp(objectiveSwing * 6, -15, 15) -
          Math.max(0, personalDeaths) * 8 -
          throwPenalty +
          cleanWindow,
        0,
        100,
      )
      const alpha = clamp(elapsed / 12, .18, .45)
      tempo = Math.round(this.previous.tempo + (instantaneous - this.previous.tempo) * alpha)
      direction = tempo >= this.previous.tempo + 2
        ? "up"
        : tempo <= this.previous.tempo - 2
          ? "down"
          : "steady"
      factors = [
        leadDelta >= 150
          ? `${signedGold(leadDelta)} lead gained this window`
          : leadDelta <= -150
            ? `${signedGold(leadDelta)} lead swing this window`
            : "Resource pace is steady",
        killSwing > 0
          ? "Won the latest takedown trade"
          : killSwing < 0
            ? "Lost the latest takedown trade"
            : alliedDeaths === 0
              ? "No new allied deaths"
              : undefined,
        objectiveSwing > 0
          ? "Secured the latest objective swing"
          : objectiveSwing < 0
            ? "Conceded the latest objective swing"
            : throwPenalty > 0
              ? "A previous lead is being returned"
              : undefined,
        personalDeaths > 0 ? "Your death reduced team tempo" : undefined,
      ].filter((entry): entry is string => Boolean(entry)).slice(0, 3)
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
    }

    return {
      resources: current.resources,
      winConfidence,
      tempo: {
        score: tempo,
        label: tempoLabel(tempo),
        direction,
        leadDelta,
        factors,
      },
    }
  }
}
