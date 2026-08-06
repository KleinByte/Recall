export type EvidenceState =
  | "observed"
  | "unavailable"
  | "no_opportunity"
  | "invalid"
  | "not_applicable"
  | "unknown"

export type DataSource =
  | "league_client"
  | "live_client"
  | "live_capture"
  | "match_v5"
  | "derived"
  | "legacy"

export interface EvidenceMetadata {
  source?: DataSource
  reason?: string
}

export type Evidence<T> =
  | (EvidenceMetadata & { state: "observed"; value: T })
  | (EvidenceMetadata & {
      state: Exclude<EvidenceState, "observed">
      value?: never
    })

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T
}

export function observed<T>(value: T, metadata: EvidenceMetadata = {}): Evidence<T> {
  return withoutUndefined({ state: "observed" as const, value, ...metadata })
}

function unobserved<T>(
  state: Exclude<EvidenceState, "observed">,
  reason?: string,
  metadata: Omit<EvidenceMetadata, "reason"> = {},
): Evidence<T> {
  return withoutUndefined({ state, ...metadata, reason }) as Evidence<T>
}

export const unavailable = <T = never>(reason?: string, metadata: Omit<EvidenceMetadata, "reason"> = {}) =>
  unobserved<T>("unavailable", reason, metadata)

export const noOpportunity = <T = never>(reason?: string, metadata: Omit<EvidenceMetadata, "reason"> = {}) =>
  unobserved<T>("no_opportunity", reason, metadata)

export const invalid = <T = never>(reason?: string, metadata: Omit<EvidenceMetadata, "reason"> = {}) =>
  unobserved<T>("invalid", reason, metadata)

export const notApplicable = <T = never>(reason?: string, metadata: Omit<EvidenceMetadata, "reason"> = {}) =>
  unobserved<T>("not_applicable", reason, metadata)

/** Converts evidence whose original state cannot be proven from legacy storage. */
export const unknownEvidence = <T = never>(reason = "legacy_unproven"): Evidence<T> =>
  unobserved<T>("unknown", reason, { source: "legacy" })

export function isScorableEvidence<T>(evidence: Evidence<T>): evidence is EvidenceMetadata & {
  state: "observed"
  value: T
} {
  return evidence.state === "observed"
}

export function evidenceValueOrNull<T>(evidence: Evidence<T>): T | null {
  return isScorableEvidence(evidence) ? evidence.value : null
}

export type EvidenceSummary = Record<EvidenceState, number>

export function summarizeEvidence(evidence: readonly Evidence<unknown>[]): EvidenceSummary {
  const summary: EvidenceSummary = {
    observed: 0,
    unavailable: 0,
    no_opportunity: 0,
    invalid: 0,
    not_applicable: 0,
    unknown: 0,
  }
  for (const entry of evidence) summary[entry.state] += 1
  return summary
}

export interface EvidenceCoverageContract {
  noOpportunity: "include" | "exclude"
}

export interface EvidenceCoverage {
  observed: number
  applicable: number
  coverage: number | null
}

export function evidenceCoverage(
  evidence: readonly Evidence<unknown>[],
  contract: EvidenceCoverageContract,
): EvidenceCoverage {
  let observedCount = 0
  let applicable = 0
  for (const entry of evidence) {
    if (entry.state === "not_applicable") continue
    if (entry.state === "no_opportunity" && contract.noOpportunity === "exclude") continue
    applicable += 1
    if (entry.state === "observed") observedCount += 1
  }
  return {
    observed: observedCount,
    applicable,
    coverage: applicable === 0 ? null : observedCount / applicable,
  }
}
