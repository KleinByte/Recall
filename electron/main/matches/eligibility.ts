import type { LcuGame } from "./types.js"
import type { QueueInfo } from "./queues.js"
import { MAX_ANALYTIC_MATCH_DURATION_SECS } from "../../../src/helpers/time-contract-core.js"

export type MatchEligibilityReason =
  | "eligible"
  | "unmatched"
  | "bot_or_tutorial"
  | "unsupported_mode"
  | "short_game"
  | "invalid_duration"
  | "incomplete_lobby"
  | "missing_core_metric"
  | "missing_source_fact"
  | "terminated"
  | "ineligible_for_progression"
  | "legacy_unknown"

export interface MatchEligibilityResult {
  stored: true
  analyticsEligible: boolean
  gradeEligible: boolean
  timelineEligible: boolean
  reason: MatchEligibilityReason
  normalizedDurationSeconds: number | null
  durationQuality: "verified" | "source_reported" | "legacy" | "inconsistent" | "invalid"
  sourceFactsComplete: boolean
}

export interface EligibilityLobbyParticipant {
  participantId: number | string | null | undefined
  teamId: number | string | null | undefined
  owner?: boolean
}

export interface MatchEligibilityInput {
  provenance: "current_source" | "legacy"
  normalizedDurationSeconds: number | null
  durationQuality: MatchEligibilityResult["durationQuality"]
  knownBotTutorial: boolean
  matched: boolean
  family: "sr" | "aram" | "classic" | "other" | "unknown"
  contextComplete: boolean
  registeredCapability: boolean
  terminated?: boolean | null
  eligibleForProgression?: boolean | null
  requiredSourceFactsComplete: boolean
  /** True when only the newer end/progression facts are unavailable. */
  missingOnlyLegacyCompatibleFacts?: boolean
  lobby?: readonly EligibilityLobbyParticipant[]
  coreMetricsComplete: boolean
}

export function isCompleteGradeLobby(
  participants: readonly EligibilityLobbyParticipant[] | undefined,
): boolean {
  if (!participants || participants.length !== 10) return false
  const participantIds = new Set(participants.map((row) => row.participantId))
  if (participantIds.size !== 10 || participantIds.has(null) || participantIds.has(undefined)) {
    return false
  }
  const teams = new Map<number | string, number>()
  for (const participant of participants) {
    if (participant.teamId === null || participant.teamId === undefined) return false
    teams.set(participant.teamId, (teams.get(participant.teamId) ?? 0) + 1)
  }
  return teams.size === 2 && [...teams.values()].every((count) => count === 5) &&
    participants.filter((participant) => participant.owner).length === 1
}

/** The sole pure decision point for stored-match eligibility. */
export function evaluateMatchEligibility(input: MatchEligibilityInput): MatchEligibilityResult {
  const durationValid = input.normalizedDurationSeconds !== null &&
    Number.isSafeInteger(input.normalizedDurationSeconds) && input.normalizedDurationSeconds > 0 &&
    input.normalizedDurationSeconds <= MAX_ANALYTIC_MATCH_DURATION_SECS &&
    input.durationQuality !== "invalid" && input.durationQuality !== "inconsistent"
  const supported = input.family === "sr" || input.family === "aram" || input.family === "classic"
  const knownUnsupported = input.contextComplete && input.registeredCapability && input.family === "other"
  const unknownContext = !input.contextComplete || !input.registeredCapability || input.family === "unknown"
  const legacyException = input.provenance === "legacy" &&
    input.missingOnlyLegacyCompatibleFacts === true
  const missingSourceFact = (!input.requiredSourceFactsComplete || unknownContext) && !legacyException
  const short = durationValid && input.normalizedDurationSeconds! < 300
  const lobbyComplete = isCompleteGradeLobby(input.lobby)

  const analyticsEligible = durationValid && !input.knownBotTutorial && input.matched &&
    supported && !input.terminated && input.eligibleForProgression !== false && !short &&
    !missingSourceFact
  const gradeEligible = analyticsEligible && lobbyComplete && input.coreMetricsComplete
  const timelineEligible = analyticsEligible && supported

  let reason: MatchEligibilityReason
  if (!durationValid) reason = "invalid_duration"
  else if (input.knownBotTutorial) reason = "bot_or_tutorial"
  else if (!input.matched) reason = "unmatched"
  else if (knownUnsupported) reason = "unsupported_mode"
  else if (input.terminated) reason = "terminated"
  else if (input.eligibleForProgression === false) reason = "ineligible_for_progression"
  else if (short) reason = "short_game"
  else if (!lobbyComplete) reason = "incomplete_lobby"
  else if (!input.coreMetricsComplete) reason = "missing_core_metric"
  else if (missingSourceFact) reason = "missing_source_fact"
  else if (legacyException || input.provenance === "legacy") reason = "legacy_unknown"
  else reason = "eligible"

  return {
    stored: true,
    analyticsEligible,
    gradeEligible,
    timelineEligible,
    reason,
    normalizedDurationSeconds: durationValid ? input.normalizedDurationSeconds : null,
    durationQuality: input.durationQuality,
    sourceFactsComplete: input.requiredSourceFactsComplete && !unknownContext,
  }
}

/**
 * Riot's published Co-op vs. AI, Doom Bots, and tutorial queue ids.
 *
 * Queue names catch newly added bot queues when the client knows about them;
 * ids keep the filter reliable for older rows and while the client is closed.
 */
export const BOT_QUEUE_IDS = [
  7, 25, 31, 32, 33, 52, 67, 83, 91, 92, 93,
  800, 810, 820, 830, 840, 850, 870, 880, 890, 950, 960,
  2000, 2010, 2020,
  4320, 4321,
] as const

/**
 * League Classic ships as the Jade queue group. Keep 710 as a legacy fallback
 * for rows captured while the mode was still exposed as "Ranked 5s".
 */
export const LEAGUE_CLASSIC_PVP_QUEUE_IDS = [
  710,
  4300, 4301, 4302, 4303, 4304, 4305,
  4306, 4307, 4308, 4309, 4310, 4311,
] as const

export const LEAGUE_CLASSIC_QUEUE_IDS = [
  ...LEAGUE_CLASSIC_PVP_QUEUE_IDS,
  4320, 4321,
] as const

/** Standard Summoner's Rift queues eligible for comparable personal records. */
export const PERSONAL_RECORD_RIFT_QUEUE_IDS = [
  400, 420, 430, 440, 480, 490,
] as const

const BOT_QUEUE_ID_SET = new Set<number>(BOT_QUEUE_IDS)
const BOT_QUEUE_NAME =
  /\b(?:bot|bots|tutorial)\b|co[\s-]?op\s+vs\.?\s+ai/i
const LEAGUE_CLASSIC_QUEUE_ID_SET = new Set<number>(LEAGUE_CLASSIC_QUEUE_IDS)
const LEAGUE_CLASSIC_QUEUE_NAME = /\b(?:league(?: of legends)?\s+)?classic\b/i
const LEAGUE_CLASSIC_MODE_GROUP = /^k?jade$/i

export function isBotQueue(queueId: number, queueName?: string): boolean {
  return (
    BOT_QUEUE_ID_SET.has(queueId) ||
    (queueName !== undefined && BOT_QUEUE_NAME.test(queueName))
  )
}

export function isLeagueClassicQueue(
  game: Pick<LcuGame, "queueId" | "mapId" | "gameMode">,
  queue?: QueueInfo,
): boolean {
  const mapId = queue?.mapId || game.mapId
  const gameMode = queue?.gameMode || game.gameMode
  const queueText = [queue?.name, queue?.shortName, queue?.description]
    .filter(Boolean)
    .join(" ")

  return (
    LEAGUE_CLASSIC_QUEUE_ID_SET.has(game.queueId) ||
    (mapId !== 12 && (
      LEAGUE_CLASSIC_MODE_GROUP.test(queue?.gameSelectModeGroup ?? "") ||
      gameMode.toUpperCase() === "JADE" ||
      (gameMode.toUpperCase() === "CLASSIC" &&
        LEAGUE_CLASSIC_QUEUE_NAME.test(queueText))
    ))
  )
}

export function isEligibleMatch(game: LcuGame, queue?: QueueInfo): boolean {
  return (
    game.gameType === "MATCHED_GAME" &&
    queue?.gameSelectCategory !== "kVersusAI" &&
    !isBotQueue(game.queueId, [queue?.name, queue?.description].filter(Boolean).join(" "))
  )
}
