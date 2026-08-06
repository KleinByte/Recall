import { createHash } from "node:crypto"
import { canonicalJson } from "../database/match-source-repo.js"

export type FieldValidation<T> =
  | { state: "valid"; value: T }
  | { state: "invalid"; reason: string }
  | { state: "unavailable"; reason: string }
  | { state: "unknown_variant"; valueSha256: string }

const valid = <T>(value: T): FieldValidation<T> => ({ state: "valid", value })
const invalid = <T>(reason: string): FieldValidation<T> => ({ state: "invalid", reason })
const unknownVariant = <T>(value: unknown): FieldValidation<T> => ({
  state: "unknown_variant",
  valueSha256: createHash("sha256").update(canonicalJson(value)).digest("hex"),
})

const safeInteger = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
    ? valid(value as number) : invalid<number>("invalid_integer")
const ascii = (value: unknown, pattern: RegExp, maxBytes: number) =>
  typeof value === "string" && Buffer.byteLength(value, "utf8") <= maxBytes && pattern.test(value)
    ? valid(value) : invalid<string>("invalid_ascii_token")

const position = (
  value: unknown,
  allowed: readonly string[],
  sentinels: readonly string[],
  aliases: Readonly<Record<string, string>> = {},
): FieldValidation<string> => {
  if (typeof value !== "string") return invalid("invalid_type")
  const token = value.trim().toUpperCase()
  if (sentinels.includes(token)) return { state: "unavailable", reason: "source_sentinel" }
  const normalized = aliases[token] ?? token
  return allowed.includes(normalized) ? valid(normalized) : unknownVariant(token)
}

export const FIELD_VALIDATORS_V1 = {
  epoch_ms: (value: unknown, context: { capturedAt: number }) =>
    safeInteger(value, Date.UTC(2010, 0, 1), context.capturedAt + 86_400_000),
  elapsed_seconds: (value: unknown) => safeInteger(value, 0, 43_200),
  positive_game_id: (value: unknown) => safeInteger(value, 1),
  participant_id: (value: unknown) => safeInteger(value, 1, 64),
  positive_team_id: (value: unknown) => safeInteger(value, 1),
  queue_id: (value: unknown) => safeInteger(value, 0),
  map_id: (value: unknown) => safeInteger(value, 1),
  nonnegative_count: (value: unknown) => safeInteger(value, 0),
  nonnegative_amount: (value: unknown) => safeInteger(value, 0),
  champion_level: (value: unknown) => safeInteger(value, 1, 30),
  strict_boolean: (value: unknown) => typeof value === "boolean"
    ? valid(value) : invalid<boolean>("invalid_type"),
  opaque_puuid: (value: unknown) => ascii(value, /^[A-Za-z0-9_-]+$/, 128),
  opaque_match_id: (value: unknown) => ascii(value, /^[A-Za-z0-9_-]+$/, 96),
  ascii_token: (value: unknown) => ascii(value, /^[A-Za-z0-9_.:+-]+$/, 96),
  patch_string: (value: unknown) => typeof value === "string" && value.length <= 64 &&
    /^[0-9]+(?:\.[0-9]+){1,3}(?:[-+._A-Za-z0-9]*)?$/.test(value)
    ? valid(value) : unknownVariant<string>(value),
  lcu_lane_token: (value: unknown) => position(value,
    ["TOP", "JUNGLE", "MIDDLE", "BOTTOM"], ["NONE", "UNKNOWN", ""],
    { MID: "MIDDLE", BOT: "BOTTOM" }),
  lcu_role_token: (value: unknown) => position(value,
    ["SOLO", "DUO", "DUO_CARRY", "DUO_SUPPORT"], ["NONE", "UNKNOWN", ""]),
  match_v5_position: (value: unknown) => position(value,
    ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"],
    ["NONE", "INVALID", "UNKNOWN", ""]),
  champ_select_position: (value: unknown) => position(value,
    ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"],
    ["UNSELECTED", "FILL", "UNKNOWN", ""]),
} as const
