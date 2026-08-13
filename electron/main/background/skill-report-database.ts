import type { Database } from "better-sqlite3"
import {
  MatchesRepository,
  type StatsFilter,
} from "../database/matches-repo.js"
import { ParticipantsRepository } from "../database/participants-repo.js"
import { InsightsRepository } from "../database/insights-repo.js"
import {
  buildSkillReport,
  type SkillReport,
  type SkillReportInput,
} from "../matches/skill-report.js"
import { buildStyleProfile } from "../matches/style.js"
import type { ModeFamily } from "../matches/types.js"

export interface SkillReportDatabaseInput {
  filter: StatsFilter
  family: ModeFamily
  generatedAt: number
}

/** Reads one consistent SQLite snapshot, then releases it before CPU analysis. */
export function buildSkillReportFromDatabase(
  db: Database,
  input: SkillReportDatabaseInput,
): SkillReport {
  const reportInput = db.transaction((): SkillReportInput => {
    const repo = new MatchesRepository(db)
    const insights = new InsightsRepository(db)
    const participants = new ParticipantsRepository(db)
    const timeOfDay = insights.getTimeOfDay(input.filter)
    const careerStyle = buildStyleProfile(repo.getStyleAverages(input.filter), input.family)
    const recentStyle = buildStyleProfile(
      repo.getStyleAverages(input.filter, { limit: 10 }),
      input.family,
    )
    const earlierStyle = buildStyleProfile(
      repo.getStyleAverages(input.filter, { offset: 10 }),
      input.family,
    )

    return {
      modes: input.filter.modes ?? (input.filter.mode ? [input.filter.mode] : []),
      family: input.family,
      generatedAt: input.generatedAt,
      summary: repo.getSummary(input.filter),
      style: careerStyle
        ? { career: careerStyle, recent: recentStyle, earlier: earlierStyle }
        : undefined,
      grades: repo.getGradeDistribution(input.filter),
      lobby: participants.getLobbyComparison(input.filter),
      contribution: insights.getTeamContribution(input.filter),
      duration: insights.getDurationBuckets(input.filter, input.family),
      hours: timeOfDay.hours,
      weekdays: timeOfDay.weekdays,
      pool: insights.getChampionPool(input.filter),
      builds: insights.getBuildPatterns(input.filter, 8),
      observations: insights.getObservations(input.filter),
      championStats: repo.getChampionStats(input.filter),
      itemObservations: insights.getFinalItemObservations(input.filter),
      gradeComponentHistory: insights.getGradeComponentHistory(input.filter),
      rvi: insights.getRviObservations(input.filter),
      performanceTimelineHistory: insights.getRviTimelineHistory(input.filter, 240),
    }
  })()

  return buildSkillReport(reportInput)
}

