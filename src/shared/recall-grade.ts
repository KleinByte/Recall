export const RECALL_GRADES = [
  "S+", "S", "S-", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D",
] as const

export type RecallGrade = (typeof RECALL_GRADES)[number]

/** Compatibility normal-score cutoffs used when a view has no stored letter. */
export const RECALL_GRADE_THRESHOLDS: ReadonlyArray<readonly [RecallGrade, number]> = [
  ["S+", 1.55], ["S", 1.2], ["S-", 0.9], ["A+", 0.65], ["A", 0.4],
  ["A-", 0.15], ["B+", -0.1], ["B", -0.35], ["B-", -0.6],
  ["C+", -0.9], ["C", -1.15], ["C-", -1.45],
]

export function recallGradeFromScore(score?: number | null): RecallGrade | undefined {
  if (score === undefined || score === null) return undefined
  return RECALL_GRADE_THRESHOLDS.find(([, minimum]) => score >= minimum)?.[0] ?? "D"
}

/** Recall v3 letter bands in the authoritative 0-100 RoleFit score space. */
export const RECALL_ROLE_FIT_THRESHOLDS: ReadonlyArray<readonly [RecallGrade, number]> = [
  ["S+", 93.94], ["S", 88.49], ["S-", 81.59], ["A+", 74.22], ["A", 65.54],
  ["A-", 55.96], ["B+", 46.02], ["B", 36.32], ["B-", 27.43],
  ["C+", 18.41], ["C", 12.51], ["C-", 7.35],
]

/** Derives an aggregate display letter from an average Recall v3 RoleFit score. */
export function recallGradeFromRoleFitScore(score?: number | null): RecallGrade | undefined {
  if (score === undefined || score === null || !Number.isFinite(score)) return undefined
  return RECALL_ROLE_FIT_THRESHOLDS.find(([, minimum]) => score >= minimum)?.[0] ?? "D"
}

export function recallGradeBand(grade?: string): "S" | "A" | "B" | "C" | "D" | undefined {
  const band = grade?.charAt(0)
  return band && "SABCD".includes(band) ? band as "S" | "A" | "B" | "C" | "D" : undefined
}
