import type { CaptureCategoryId, SourceArtifactKind } from "./source-capabilities.js"

export type FieldValidatorId =
  | "epoch_ms" | "match_duration" | "elapsed_seconds" | "elapsed_milliseconds"
  | "positive_game_id" | "participant_id" | "positive_team_id" | "queue_id"
  | "map_id" | "catalog_champion_id" | "ban_champion_id" | "nonnegative_id"
  | "safe_integer" | "item_slot_id" | "spell_id" | "rune_id" | "augment_id"
  | "nonnegative_count" | "nonnegative_amount" | "champion_level" | "placement"
  | "subteam_id" | "finite_fraction" | "finite_number" | "map_coordinate"
  | "strict_boolean" | "win_result" | "lcu_lane_token" | "lcu_role_token"
  | "match_v5_position" | "champ_select_position" | "opaque_puuid"
  | "opaque_match_id" | "ascii_token" | "registered_enum_token"
  | "display_string" | "patch_string"

export interface SourceFieldDefinition {
  key: string
  category: CaptureCategoryId
  validatorId: FieldValidatorId
  normalizedPath?: string
  sources: readonly ("league_client" | "match_v5" | "live_capture")[]
  artifactKinds?: readonly SourceArtifactKind[]
}

const field = (
  key: string,
  category: CaptureCategoryId,
  validatorId: FieldValidatorId,
  sources: SourceFieldDefinition["sources"] = ["league_client", "match_v5"],
): SourceFieldDefinition => ({ key, category, validatorId, sources })

const countFields = [
  "kills", "deaths", "assists", "largest_killing_spree", "largest_multi_kill",
  "double_kills", "triple_kills", "quadra_kills", "penta_kills",
] as const
const damageFields = [
  "total_damage_dealt", "damage_to_champions", "magic_damage_to_champions",
  "physical_damage_to_champions", "true_damage_to_champions", "damage_taken",
  "damage_self_mitigated", "damage_dealt_to_buildings",
] as const

export const SOURCE_FIELD_REGISTRY_V1: readonly SourceFieldDefinition[] = [
  field("match.game_id", "match.key", "positive_game_id"),
  field("match.riot_match_id", "match.external_id", "opaque_match_id", ["match_v5"]),
  field("match.queue_id", "match.context_raw", "queue_id"),
  field("match.game_mode", "match.context_raw", "registered_enum_token"),
  field("match.map_id", "match.context_raw", "map_id"),
  field("match.game_type", "match.context_raw", "registered_enum_token"),
  field("match.game_version", "match.context_raw", "patch_string"),
  field("match.data_version", "match.context_raw", "ascii_token"),
  field("match.played_at", "match.start_time", "epoch_ms"),
  field("match.creation_timestamp", "match.start_time", "epoch_ms"),
  field("match.start_timestamp", "match.start_time", "epoch_ms", ["match_v5"]),
  field("match.duration_secs", "match.duration", "match_duration"),
  field("match.game_end_timestamp", "match.end_state", "epoch_ms", ["match_v5"]),
  field("match.end_of_game_result", "match.end_state", "registered_enum_token", ["match_v5"]),
  field("match.owner_eligible_for_progression", "match.end_state", "strict_boolean", ["match_v5"]),
  field("participant.participant_id", "participant.roster", "participant_id"),
  field("participant.team_id", "participant.roster", "positive_team_id"),
  field("participant.participant_puuid", "participant.roster", "opaque_puuid"),
  field("participant.champion_id", "participant.roster", "catalog_champion_id"),
  field("participant.champ_level", "participant.progression", "champion_level"),
  field("participant.time_played_secs", "participant.progression", "elapsed_seconds", ["match_v5"]),
  field("participant.eligible_for_progression", "participant.progression", "strict_boolean", ["match_v5"]),
  field("participant.win", "participant.result", "win_result"),
  ...countFields.map((name) => field(`participant.${name}`, "participant.kda", "nonnegative_count")),
  ...damageFields.map((name) => field(`participant.${name}`, "participant.damage", "nonnegative_amount")),
  ...["gold_earned", "gold_spent"].map((name) => field(`participant.${name}`, "participant.economy", "nonnegative_amount")),
  ...["time_ccing_others", "total_heals_on_teammates", "total_damage_shielded_on_teammates",
    "total_time_spent_dead"]
    .map((name) => field(`participant.${name}`, "participant.sustain_cc", "nonnegative_amount")),
  ...["damage_objectives", "damage_turrets"]
    .map((name) => field(`participant.${name}`, "participant.objectives", "nonnegative_amount")),
  ...["total_minions_killed", "neutral_minions"].map((name) => field(`participant.${name}`, "participant.farm", "nonnegative_count")),
  field("participant.vision_score", "participant.vision_score", "nonnegative_count"),
  ...["wards_placed", "wards_killed", "control_wards_purchased", "detector_wards_placed"]
    .map((name) => field(`participant.${name}`, "participant.wards", "nonnegative_count")),
  field("participant.lcu_lane", "participant.position", "lcu_lane_token", ["league_client"]),
  field("participant.lcu_role", "participant.position", "lcu_role_token", ["league_client"]),
  field("participant.match_v5_team_position", "participant.position", "match_v5_position", ["match_v5"]),
  field("participant.match_v5_individual_position", "participant.position", "match_v5_position", ["match_v5"]),
  field("participant.assigned_position", "participant.position", "champ_select_position", ["league_client"]),
  field("timeline.ward_events", "timeline.ward", "nonnegative_count", ["league_client", "match_v5", "live_capture"]),
  field("timeline.frames", "timeline.frame_economy", "nonnegative_count", ["league_client", "match_v5", "live_capture"]),
]

const keys = SOURCE_FIELD_REGISTRY_V1.map((definition) => definition.key)
if (new Set(keys).size !== keys.length) throw new Error("duplicate_source_field_key")

export const SOURCE_FIELD_BY_KEY = new Map(
  SOURCE_FIELD_REGISTRY_V1.map((definition) => [definition.key, definition]),
)

export function requireSourceField(key: string): SourceFieldDefinition {
  const definition = SOURCE_FIELD_BY_KEY.get(key)
  if (!definition) throw new Error(`unregistered_source_field:${key}`)
  return definition
}
