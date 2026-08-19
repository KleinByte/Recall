export interface GameClientRequest {
  request<T>(path: string): Promise<T>
}

export interface JungleEvidenceSample {
  capturedMonotonicMs: number
  gameTimeMs: number
  currentGold: number
  creepScore?: number
  level?: number
}

export async function readJungleEvidenceSample(
  client: GameClientRequest,
  capturedMonotonicMs: number,
  riotId?: string,
): Promise<JungleEvidenceSample> {
  const [game, active, scores] = await Promise.all([
    client.request<{ gameTime?: number }>("/liveclientdata/gamestats"),
    client.request<{ currentGold?: number; level?: number }>("/liveclientdata/activeplayer"),
    riotId
      ? client.request<{ creepScore?: number }>(
        `/liveclientdata/playerscores?riotId=${encodeURIComponent(riotId)}`,
      ).catch(() => undefined)
      : Promise.resolve(undefined),
  ])
  const gameTime = Number(game.gameTime)
  const currentGold = Number(active.currentGold)
  if (!Number.isFinite(gameTime) || !Number.isFinite(currentGold)) {
    throw new Error("invalid_live_jungle_evidence")
  }
  return {
    capturedMonotonicMs,
    gameTimeMs: Math.max(0, gameTime * 1_000),
    currentGold,
    creepScore: Number.isFinite(Number(scores?.creepScore))
      ? Number(scores?.creepScore)
      : undefined,
    level: Number.isFinite(Number(active.level)) ? Number(active.level) : undefined,
  }
}

export interface JungleEvidenceDelta {
  elapsedMs: number
  goldDelta: number
  estimatedPassiveGold: number
  goldResidual: number
  creepScoreDelta?: number
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
    }
  }

  reset() {
    this.previous = undefined
    this.passiveRateSamples.length = 0
  }
}
