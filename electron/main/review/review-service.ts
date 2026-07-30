import type { Database } from "better-sqlite3"
import type { MatchesRepository } from "../database/matches-repo.js"
import type { ParticipantsRepository } from "../database/participants-repo.js"
import type { ReviewRepository } from "../database/review-repo.js"
import { gradeLobby, GRADE_ALGORITHM_VERSION } from "../matches/grade.js"
import type { MatchRow } from "../matches/types.js"
import type { TimelineService } from "../riot/timeline-service.js"
import { confidenceForGames, type GradeBreakdown } from "./types.js"
import { buildSessions } from "./sessions.js"

export class ReviewService {
  constructor(
    private readonly db: Database,
    private readonly matches: MatchesRepository,
    private readonly participants: ParticipantsRepository,
    private readonly reviews: ReviewRepository,
    private readonly timelines: TimelineService,
  ) {}

  overview(puuid: string) {
    const latest = this.matches.getRecentMatches({ puuid }, 1)[0]
    const all = this.matches.getAllMatches(puuid)
    return {
      latest: latest ? this.match(latest.gameId, puuid) : undefined,
      recentSession: buildSessions(
        all,
        this.reviews.getBoundaryOverrides(puuid),
      )[0],
      bookmarkCount: (this.db.prepare(
        `SELECT COUNT(*) AS count FROM match_annotations
         WHERE puuid = ? AND bookmarked = 1`,
      ).get(puuid) as { count: number }).count,
      activeExperimentCount: (this.db.prepare(
        `SELECT COUNT(*) AS count FROM practice_experiments
         WHERE puuid = ? AND status = 'active'`,
      ).get(puuid) as { count: number }).count,
    }
  }

  match(gameId: number, puuid: string) {
    const match = this.matches.getMatch(gameId, puuid)
    if (!match) throw new Error("Match not found")
    const detail = this.participants.getMatchDetail(gameId, puuid)
    const owner = detail.participants.find((participant) => participant.isPlayer === 1)
    let grade = owner
      ? this.reviews.getGradeBreakdown(gameId, puuid, owner.participantId)
      : undefined
    if (!grade && owner && detail.participants.length >= 10) {
      const duration = Math.max(1, match.durationSecs / 60)
      const results = gradeLobby(detail.participants.map((participant) => ({
        participantId: participant.participantId,
        teamId: participant.teamId,
        kills: participant.kills,
        deaths: participant.deaths,
        assists: participant.assists,
        damageToChampions: participant.damageToChampions,
        damageTaken: participant.damageTaken,
        goldEarned: participant.goldEarned,
        csPerMin: (participant.totalMinionsKilled + participant.neutralMinions) / duration,
        visionScore: participant.visionScore,
        damageObjectives: participant.damageObjectives,
        role: participant.role,
      })), match.modeFamily)
      this.participants.setGrades(gameId, puuid, results)
      grade = this.reviews.getGradeBreakdown(gameId, puuid, owner.participantId)
    }
    if (!grade && match.grade) {
      grade = {
        algorithmVersion: GRADE_ALGORITHM_VERSION,
        compositePercentile: 0,
        components: [],
        unavailableReason: "Breakdown unavailable for this match.",
      }
    }
    const baseline = this.baseline(match, puuid)
    return {
      match,
      scoreboard: detail.participants,
      grade,
      baseline,
      highlights: highlights(grade, baseline),
      annotation: this.reviews.getAnnotation(gameId, puuid),
      timeline: this.timelines.get(gameId, puuid),
    }
  }

  sessions(puuid: string, page: number, pageSize = 20) {
    const all = buildSessions(
      this.matches.getAllMatches(puuid),
      this.reviews.getBoundaryOverrides(puuid),
    )
    const size = Math.min(20, Math.max(1, pageSize))
    const current = Math.max(1, page)
    return {
      rows: all.slice((current - 1) * size, current * size),
      total: all.length,
      page: current,
      pageSize: size,
    }
  }

  private baseline(match: MatchRow, puuid: string) {
    const previous = this.matches.getAllMatches(puuid)
      .filter((candidate) =>
        candidate.playedAt < match.playedAt ||
        (candidate.playedAt === match.playedAt && candidate.gameId < match.gameId),
      )
      .sort((a, b) => b.playedAt - a.playedAt || b.gameId - a.gameId)
    const championMode = previous.filter((candidate) =>
      candidate.championId === match.championId && candidate.mode === match.mode,
    ).slice(0, 20)
    const roleMode = match.modeFamily === "sr"
      ? previous.filter((candidate) =>
        candidate.mode === match.mode && match.role && candidate.role === match.role,
      ).slice(0, 20)
      : []
    const mode = previous.filter((candidate) => candidate.mode === match.mode).slice(0, 20)
    const selected = championMode.length >= 5
      ? { rows: championMode, scope: "champion_mode" as const }
      : roleMode.length >= 5
        ? { rows: roleMode, scope: "role_mode" as const }
        : { rows: mode, scope: "mode" as const }
    if (selected.rows.length === 0) return undefined
    const minute = (row: MatchRow) => Math.max(1, row.durationSecs / 60)
    const metrics = [
      metric("grade", "Grade score", match.gradeScore, selected.rows, (row) => row.gradeScore, "higher"),
      metric("kda", "KDA", (match.kills + match.assists) / Math.max(1, match.deaths), selected.rows, (row) => (row.kills + row.assists) / Math.max(1, row.deaths), "higher"),
      metric("damage", "Damage / min", match.damageToChampions / minute(match), selected.rows, (row) => row.damageToChampions / minute(row), "higher"),
      metric("deaths", "Deaths", match.deaths, selected.rows, (row) => row.deaths, "lower"),
      metric("gold", "Gold / min", match.goldPerMin, selected.rows, (row) => row.goldPerMin, "higher"),
      metric("cs", "CS / min", match.csPerMin, selected.rows, (row) => row.csPerMin, "higher"),
      metric("vision", "Vision / min", match.visionScore / minute(match), selected.rows, (row) => row.visionScore / minute(row), "higher"),
      metric("objectives", "Objective damage / min", match.damageObjectives / minute(match), selected.rows, (row) => row.damageObjectives / minute(row), "higher"),
    ].filter((entry) => entry !== undefined)
    return {
      scope: selected.scope,
      games: selected.rows.length,
      confidence: confidenceForGames(selected.rows.length),
      metrics,
    }
  }
}

function metric(
  key: string,
  label: string,
  current: number | undefined,
  rows: MatchRow[],
  get: (row: MatchRow) => number | undefined,
  preferredDirection: "higher" | "lower",
) {
  const values = rows.map(get).filter((value): value is number => value !== undefined)
  if (current === undefined || values.length === 0) return undefined
  const baseline = values.reduce((sum, value) => sum + value, 0) / values.length
  return { key, label, current, baseline, difference: current - baseline, preferredDirection }
}

function highlights(
  grade: GradeBreakdown | undefined,
  baseline: ReturnType<ReviewService["baseline"]>,
) {
  const result: Array<Record<string, string>> = []
  const weighted = [...(grade?.components ?? [])]
    .sort((a, b) => b.contribution - a.contribution || a.key.localeCompare(b.key))
  const strength = weighted.find((component) => component.percentile >= .6)
  if (strength) result.push({
    kind: "strength", title: "Strength",
    detail: `${strength.label} ranked at the ${Math.round(strength.percentile * 100)}th lobby percentile.`,
    metricKey: strength.key,
  })
  const opportunity = [...weighted]
    .sort((a, b) => a.percentile - b.percentile || a.key.localeCompare(b.key))
    .find((component) => component.percentile <= .4)
  if (opportunity) result.push({
    kind: "opportunity", title: "Opportunity",
    detail: `${opportunity.label} ranked at the ${Math.round(opportunity.percentile * 100)}th lobby percentile.`,
    metricKey: opportunity.key,
  })
  const personal = [...(baseline?.metrics ?? [])]
    .map((entry) => ({
      ...entry,
      directional: entry.difference * (entry.preferredDirection === "higher" ? 1 : -1),
      scale: Math.abs(entry.difference) / Math.max(.01, Math.abs(entry.baseline)),
    }))
    .sort((a, b) => b.scale - a.scale || a.key.localeCompare(b.key))[0]
  if (personal && personal.scale >= .1) result.push({
    kind: personal.directional >= 0 ? "improvement" : "regression",
    title: personal.directional >= 0 ? "Personal improvement" : "Personal regression",
    detail: `${personal.label} was ${Math.abs(personal.difference).toFixed(1)} ${personal.directional >= 0 ? "better" : "worse"} than the selected baseline.`,
    metricKey: personal.key,
  })
  return result
}
