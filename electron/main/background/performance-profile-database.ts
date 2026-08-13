import type { Database } from "better-sqlite3"
import { InsightsRepository } from "../database/insights-repo.js"
import type { StatsFilter } from "../database/matches-repo.js"
import {
  buildPerformanceProfile,
  type PerformanceProfile,
  type PerformanceScoringContext,
} from "../matches/performance-profile.js"
import type { ModeFamily } from "../matches/types.js"

export interface PerformanceProfileDatabaseInput {
  filter: StatsFilter
  family: ModeFamily
  scoringContext?: PerformanceScoringContext
}

/** Reads one consistent RVI snapshot, then releases it before CPU analysis. */
export function buildPerformanceProfileFromDatabase(
  database: Database,
  input: PerformanceProfileDatabaseInput,
): PerformanceProfile | undefined {
  const rvi = database.transaction(() =>
    new InsightsRepository(database).getRviObservations(input.filter))()
  if (!rvi) return undefined

  return buildPerformanceProfile({
    recipeId: rvi.recipeId,
    rviObservations: rvi.observations,
    family: input.family,
    scoringContext: input.scoringContext,
  })
}
