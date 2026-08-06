import type { Evidence } from "../../../src/shared/measurement.js"
import { invalid, notApplicable, observed, unavailable, unknownEvidence } from "../../../src/shared/measurement.js"
import { requireSourceField } from "../matches/source-field-contract.js"

export type ManifestStateEntry = string | { key: string; reason?: string }

export interface SourceCaptureManifest {
  source: "league_client" | "match_v5"
  current: boolean
  captured: readonly ManifestStateEntry[]
  partial: readonly ManifestStateEntry[]
  unavailable: readonly ManifestStateEntry[]
  invalid: readonly ManifestStateEntry[]
  notApplicable: readonly ManifestStateEntry[]
  intentionallyIgnored: readonly ManifestStateEntry[]
  unknown: readonly ManifestStateEntry[]
}

const find = (entries: readonly ManifestStateEntry[], key: string) => entries.find((entry) =>
  typeof entry === "string" ? entry === key : entry.key === key)
const reason = (entry: ManifestStateEntry | undefined, fallback: string) =>
  typeof entry === "object" ? entry.reason ?? fallback : fallback

export function readSourceFact<T>(input: {
  key: string
  normalizedValue: T | null | undefined
  normalizedValueValid: (value: unknown) => value is T
  captures: readonly SourceCaptureManifest[]
  compatibilityValueExists?: boolean
}): Evidence<T> {
  const definition = requireSourceField(input.key)
  const captures = input.captures.filter((capture) => capture.current &&
    definition.sources.includes(capture.source))
  for (const capture of captures) {
    const source = capture.source
    const captured = find(capture.captured, input.key)
    if (captured !== undefined) {
      return input.normalizedValueValid(input.normalizedValue)
        ? observed(input.normalizedValue, { source })
        : invalid("normalized_value_invalid", { source })
    }
    const invalidEntry = find(capture.invalid, input.key)
    if (invalidEntry !== undefined) return invalid(reason(invalidEntry, "invalid_source_value"), { source })
    const partial = find(capture.partial, input.key)
    if (partial !== undefined) return unavailable("partial_entities", { source })
    const missing = find(capture.unavailable, input.key)
    if (missing !== undefined) return unavailable(reason(missing, "not_in_source"), { source })
    const na = find(capture.notApplicable, input.key)
    if (na !== undefined) return notApplicable(reason(na, "not_applicable"), { source })
    const unknown = find(capture.unknown, input.key)
    if (unknown !== undefined) return unavailable(reason(unknown, "current_unknown"), { source })
    if (find(capture.intentionallyIgnored, input.key) !== undefined) {
      return unavailable("consumed_field_intentionally_ignored", { source })
    }
  }
  return input.compatibilityValueExists
    ? unknownEvidence<T>()
    : unavailable("not_in_source")
}
