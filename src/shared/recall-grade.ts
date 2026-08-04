export const RECALL_GRADES = [
  "S+", "S", "S-", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D",
] as const

export type RecallGrade = (typeof RECALL_GRADES)[number]

/** Standard-deviation cutoffs used by the grading engine and every grade visualization. */
export const RECALL_GRADE_THRESHOLDS: ReadonlyArray<readonly [RecallGrade, number]> = [
  ["S+", 1.55], ["S", 1.2], ["S-", 0.9], ["A+", 0.65], ["A", 0.4],
  ["A-", 0.15], ["B+", -0.1], ["B", -0.35], ["B-", -0.6],
  ["C+", -0.9], ["C", -1.15], ["C-", -1.45],
]

export function recallGradeFromScore(score?: number | null): RecallGrade | undefined {
  if (score === undefined || score === null) return undefined
  return RECALL_GRADE_THRESHOLDS.find(([, minimum]) => score >= minimum)?.[0] ?? "D"
}

export function recallGradeBand(grade?: string): "S" | "A" | "B" | "C" | "D" | undefined {
  const band = grade?.charAt(0)
  return band && "SABCD".includes(band) ? band as "S" | "A" | "B" | "C" | "D" : undefined
}
