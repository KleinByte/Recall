import { LEAGUE_CLASSIC_QUEUE_IDS } from "./eligibility.js"

export const CAPTURE_CATEGORY_IDS = [
  "match.key", "match.external_id", "match.context_raw", "match.start_time",
  "match.duration", "match.end_state", "participant.roster",
  "participant.display_identity", "participant.position", "participant.progression",
  "participant.result", "participant.spells", "participant.kda",
  "participant.multikills", "participant.damage", "participant.sustain_cc",
  "participant.economy", "participant.farm", "participant.vision_score",
  "participant.wards", "participant.objectives", "participant.items",
  "participant.runes_modern", "participant.runes_classic", "participant.augments",
  "participant.extended", "team.result", "team.bans", "team.neutral_objectives",
  "team.structures", "timeline.frame_economy", "timeline.frame_progression",
  "timeline.frame_farm", "timeline.frame_position", "timeline.champion_kill",
  "timeline.item", "timeline.neutral_objective", "timeline.structure",
  "timeline.ward", "timeline.level_exact", "timeline.level_inferred",
  "timeline.game_end", "timeline.augment_selection",
] as const

export type CaptureCategoryId = typeof CAPTURE_CATEGORY_IDS[number]
export type SourceArtifactKind =
  | "history_page" | "history_summary" | "scoreboard_detail"
  | "champ_select" | "match_detail" | "timeline"
export type ModeCapabilityKey =
  | "rift_draft" | "rift_no_bans" | "aram" | "mayhem"
  | "league_classic" | "arena" | "unknown"

export interface ScoreboardShapeContract {
  participants: 10
  teams: 2
  participantsPerTeam: 5
  owners: 1
}

const STANDARD_SCOREBOARD_SHAPE = Object.freeze({
  participants: 10 as const,
  teams: 2 as const,
  participantsPerTeam: 5 as const,
  owners: 1 as const,
})

export const SCOREBOARD_SHAPE_CONTRACTS_V1 = Object.freeze({
  rift_draft: STANDARD_SCOREBOARD_SHAPE,
  rift_no_bans: STANDARD_SCOREBOARD_SHAPE,
  aram: STANDARD_SCOREBOARD_SHAPE,
  mayhem: STANDARD_SCOREBOARD_SHAPE,
  league_classic: STANDARD_SCOREBOARD_SHAPE,
}) satisfies Readonly<Partial<Record<ModeCapabilityKey, ScoreboardShapeContract>>>

export function scoreboardShapeState(
  capability: ModeCapabilityKey,
  participants: readonly { participantId: number; teamId: number; owner: boolean }[],
): "complete" | "incomplete" | "mode_specific_unknown" {
  const contract = SCOREBOARD_SHAPE_CONTRACTS_V1[
    capability as keyof typeof SCOREBOARD_SHAPE_CONTRACTS_V1
  ]
  if (!contract) return "mode_specific_unknown"
  const ids = new Set(participants.map((row) => row.participantId))
  const teams = new Map<number, number>()
  participants.forEach((row) => teams.set(row.teamId, (teams.get(row.teamId) ?? 0) + 1))
  return participants.length === contract.participants && ids.size === contract.participants &&
    teams.size === contract.teams && [...teams.values()].every((count) =>
      count === contract.participantsPerTeam) && participants.filter((row) => row.owner).length === contract.owners
    ? "complete" : "incomplete"
}

export interface RawModeContext {
  queueId?: number | null
  mapId?: number | null
  gameMode?: string | null
  queueSelectGroup?: string | null
  queueCategory?: string | null
}

const DRAFT_QUEUES = new Set([400, 420, 440])
const CLASSIC_QUEUES = new Set<number>(LEAGUE_CLASSIC_QUEUE_IDS)

export function resolveModeCapability(context: RawModeContext): ModeCapabilityKey {
  const mode = context.gameMode?.trim().toUpperCase()
  if (mode === "CHERRY" || context.mapId === 30) return "arena"
  if (mode?.startsWith("KIWI")) return "mayhem"
  if (mode === "JADE" || (context.queueId !== undefined && context.queueId !== null &&
      CLASSIC_QUEUES.has(context.queueId))) return "league_classic"
  if (context.mapId === 12 || mode === "ARAM") return "aram"
  if (context.mapId === 11 && mode === "CLASSIC") {
    const queueText = `${context.queueSelectGroup ?? ""} ${context.queueCategory ?? ""}`
    return DRAFT_QUEUES.has(context.queueId ?? -1) || /draft/i.test(queueText)
      ? "rift_draft"
      : "rift_no_bans"
  }
  return "unknown"
}

const NO_VISION = new Set<ModeCapabilityKey>(["aram", "mayhem", "arena"])
const NO_NEUTRAL = new Set<ModeCapabilityKey>(["aram", "mayhem", "arena"])
const NO_STRUCTURES = new Set<ModeCapabilityKey>(["arena"])

export type Applicability = "applicable" | "not_applicable" | "unknown" | "source_unpromised"

export function categoryApplicability(
  capability: ModeCapabilityKey,
  category: CaptureCategoryId,
  source?: "league_client" | "match_v5" | "live_capture",
): Applicability {
  if (capability === "unknown") return "unknown"
  if (category === "participant.runes_modern" && capability === "league_classic") return "not_applicable"
  if (category === "participant.runes_classic") return capability === "league_classic"
    ? "source_unpromised" : "not_applicable"
  if (category === "participant.augments" && capability !== "mayhem" && capability !== "arena") {
    return "not_applicable"
  }
  if ((category === "participant.vision_score" || category === "participant.wards" ||
       category === "timeline.ward") && NO_VISION.has(capability)) return "not_applicable"
  if ((category === "team.neutral_objectives" || category === "timeline.neutral_objective") &&
      NO_NEUTRAL.has(capability)) return "not_applicable"
  if ((category === "team.structures" || category === "timeline.structure") &&
      NO_STRUCTURES.has(capability)) return "not_applicable"
  if (category === "team.bans") {
    if (capability === "rift_draft") return "applicable"
    if (capability === "league_classic") return "unknown"
    return "not_applicable"
  }
  if (category === "match.end_state" && source === "league_client") return "source_unpromised"
  if (category === "timeline.level_exact" && source === "league_client") return "source_unpromised"
  if (category === "timeline.augment_selection") return "source_unpromised"
  return "applicable"
}
