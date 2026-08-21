export interface GameClientRequest {
  request<T>(path: string): Promise<T>
}

export interface JungleEvidenceSample {
  capturedMonotonicMs: number
  gameTimeMs: number
  currentGold: number
  creepScore?: number
  level?: number
  localPlayerDead?: boolean
}

interface LiveClientIdentity {
  riotId?: string
  riotIdGameName?: string
  riotIdTagLine?: string
  summonerName?: string
}

interface LiveClientPlayer extends LiveClientIdentity {
  isDead?: boolean
  scores?: { creepScore?: number }
}

interface LiveClientActivePlayer extends LiveClientIdentity {
  currentGold?: number
  level?: number
}

interface LiveClientAllGameData {
  gameData?: { gameTime?: number }
  activePlayer?: LiveClientActivePlayer
  allPlayers?: LiveClientPlayer[]
}

function normalizedIdentity(value?: string) {
  return value?.trim().toLocaleLowerCase().replace(/\s+/g, " ")
}

function identityCandidates(value?: LiveClientIdentity | string) {
  if (typeof value === "string") {
    const normalized = normalizedIdentity(value)
    return normalized ? [normalized] : []
  }
  if (!value) return []
  const gameName = value.riotIdGameName?.trim()
  const tagLine = value.riotIdTagLine?.trim()
  return [...new Set([
    value.riotId,
    gameName && tagLine ? `${gameName}#${tagLine}` : undefined,
    gameName,
    value.summonerName,
  ].map(normalizedIdentity).filter((entry): entry is string => Boolean(entry)))]
}

function preferredRiotId(value?: LiveClientIdentity) {
  if (!value) return undefined
  const gameName = value.riotIdGameName?.trim()
  const tagLine = value.riotIdTagLine?.trim()
  return value.riotId?.trim() ||
    (gameName && tagLine ? `${gameName}#${tagLine}` : undefined) ||
    value.summonerName?.trim()
}

/** Uses exact Riot identifiers first and only falls back to a unique game name. */
function matchingPlayer(
  players: LiveClientPlayer[],
  requested?: string,
  active?: LiveClientIdentity,
) {
  const identities = new Set([
    ...identityCandidates(requested),
    ...identityCandidates(active),
  ])
  const candidates = players.map(identityCandidates)
  const exactMatches = candidates.flatMap((entries, index) =>
    entries.some((candidate) => identities.has(candidate)) ? [index] : [])
  if (exactMatches.length === 1) return players[exactMatches[0]]
  if (exactMatches.length > 1) return undefined

  const bases = new Set([...identities].map((entry) => entry.split("#", 1)[0]))
  const baseMatches = candidates.flatMap((entries, index) =>
    entries.some((candidate) => bases.has(candidate.split("#", 1)[0])) ? [index] : [])
  return baseMatches.length === 1 ? players[baseMatches[0]] : undefined
}

function parsedSample(input: {
  capturedMonotonicMs: number
  gameTime: unknown
  currentGold: unknown
  creepScore?: unknown
  level?: unknown
  localPlayerDead?: unknown
}): JungleEvidenceSample {
  const gameTime = Number(input.gameTime)
  const currentGold = Number(input.currentGold)
  if (!Number.isFinite(gameTime) || !Number.isFinite(currentGold)) {
    throw new Error("invalid_live_jungle_evidence")
  }
  return {
    capturedMonotonicMs: input.capturedMonotonicMs,
    gameTimeMs: Math.max(0, gameTime * 1_000),
    currentGold,
    creepScore: Number.isFinite(Number(input.creepScore))
      ? Number(input.creepScore)
      : undefined,
    level: Number.isFinite(Number(input.level)) ? Number(input.level) : undefined,
    localPlayerDead: typeof input.localPlayerDead === "boolean"
      ? input.localPlayerDead
      : undefined,
  }
}

export async function readJungleEvidenceSample(
  client: GameClientRequest,
  capturedMonotonicMs: number,
  riotId?: string,
): Promise<JungleEvidenceSample> {
  try {
    const all = await client.request<LiveClientAllGameData>("/liveclientdata/allgamedata")
    const player = matchingPlayer(
      Array.isArray(all.allPlayers) ? all.allPlayers : [],
      riotId,
      all.activePlayer,
    )
    return parsedSample({
      capturedMonotonicMs,
      gameTime: all.gameData?.gameTime,
      currentGold: all.activePlayer?.currentGold,
      creepScore: player?.scores?.creepScore,
      level: all.activePlayer?.level,
      localPlayerDead: player?.isDead,
    })
  } catch {
    // Older/temporarily incomplete Live Client implementations can omit the
    // aggregate document. Keep the documented subset endpoints as a fallback.
  }
  const [game, active] = await Promise.all([
    client.request<{ gameTime?: number }>("/liveclientdata/gamestats"),
    client.request<LiveClientActivePlayer>("/liveclientdata/activeplayer"),
  ])
  const scoreIdentity = riotId ?? preferredRiotId(active)
  const scores = scoreIdentity
    ? await client.request<{ creepScore?: number }>(
      `/liveclientdata/playerscores?riotId=${encodeURIComponent(scoreIdentity)}`,
    ).catch(() => undefined)
    : undefined
  return parsedSample({
    capturedMonotonicMs,
    gameTime: game.gameTime,
    currentGold: active.currentGold,
    creepScore: scores?.creepScore,
    level: active.level,
  })
}

export interface JungleEvidenceDelta {
  elapsedMs: number
  goldDelta: number
  estimatedPassiveGold: number
  goldResidual: number
  creepScoreDelta?: number
  levelDelta?: number
}

function median(values: number[]) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Learns the passive-gold baseline instead of hard-coding patch-sensitive rates. */
export class JungleEvidenceAccumulator {
  private previous?: JungleEvidenceSample
  private readonly passiveRateSamples: number[] = []

  update(sample: JungleEvidenceSample): JungleEvidenceDelta | undefined {
    const previous = this.previous
    this.previous = sample
    if (!previous) return undefined
    const elapsedMs = sample.gameTimeMs - previous.gameTimeMs
    if (elapsedMs <= 0 || elapsedMs > 5_000) return undefined
    const goldDelta = sample.currentGold - previous.currentGold
    const rate = goldDelta / (elapsedMs / 1_000)
    // Quiet positive changes are likely passive income; large bursts are kept
    // out of the baseline so camp, kill and objective gold remains residual.
    if (rate >= 0 && rate <= 4.5 && goldDelta <= 8) {
      this.passiveRateSamples.push(rate)
      if (this.passiveRateSamples.length > 40) this.passiveRateSamples.shift()
    }
    const passiveRate = median(this.passiveRateSamples)
    const estimatedPassiveGold = passiveRate * elapsedMs / 1_000
    return {
      elapsedMs,
      goldDelta,
      estimatedPassiveGold,
      goldResidual: goldDelta - estimatedPassiveGold,
      creepScoreDelta:
        sample.creepScore !== undefined && previous.creepScore !== undefined
          ? sample.creepScore - previous.creepScore
          : undefined,
      levelDelta:
        sample.level !== undefined && previous.level !== undefined
          ? sample.level - previous.level
          : undefined,
    }
  }

  reset() {
    this.previous = undefined
    this.passiveRateSamples.length = 0
  }
}
