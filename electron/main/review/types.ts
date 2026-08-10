export type Confidence = "thin" | "fair" | "solid"

export function confidenceForGames(games: number): Confidence {
  if (games >= 12) return "solid"
  if (games >= 5) return "fair"
  return "thin"
}

export interface GradeComponent {
  key:
    | "combat"
    | "participation"
    | "economy"
    | "survival"
    | "frontlining"
    | "farming"
    | "fighting"
    | "availability"
    | "resources"
    | "vision"
    | "objectives"
    | "control"
  label: string
  percentile: number
  weight: number
  contribution: number
  scope: "lobby" | "team" | "role"
}

export interface GradeBreakdown {
  algorithmVersion: number
  recipeId?: string
  roleFitScore?: number
  lobbyPercentile?: number
  compositePercentile: number
  components: GradeComponent[]
  unavailableReason?: string
}

export type ChampionChoiceObjective =
  | "best_overall"
  | "recent_form"
  | "challenges"
  | "practice"
  | "most_reliable"

export interface ChoiceSignal {
  key: "long_term" | "recent" | "reliability" | "novelty" | "challenges"
  label: string
  score: number
  weight: number
  contribution: number
}
