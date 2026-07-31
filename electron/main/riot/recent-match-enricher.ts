import type { MatchesRepository } from "../database/matches-repo.js"
import type { ParticipantsRepository } from "../database/participants-repo.js"
import { gradeLobby } from "../matches/grade.js"
import { evaluateMatchLabels } from "../matches/labels.js"
import type { QueueIndex } from "../matches/queues.js"
import type { MatchRow } from "../matches/types.js"
import { RiotApiClient, RiotApiError } from "./api-client.js"
import { mapRiotMatch, type RiotMatchDto } from "./match-mapper.js"

interface MatchApi {
  get<T>(path: string, scope: string, signal?: AbortSignal): Promise<T>
}

interface RecentMatchEnricherOptions {
  apiFactory?: (apiKey: string, regionalRoute: string) => MatchApi
  onAccountResolved?: (matchPuuid: string) => void
}

/**
 * Enriches games in the League client's current history window immediately.
 * A missing key is a normal no-op. A rejected key is remembered so periodic
 * sync does not keep sending credentials Riot has already refused.
 */
export class RecentMatchEnricher {
  private rejectedKey?: string
  private resolvedKey?: string
  private matchPuuid?: string

  constructor(
    private readonly getApiKey: () => string | undefined,
    private readonly regionalRoute: string,
    private readonly platformId: string,
    private readonly ownerPuuid: string,
    private readonly riotId: { gameName: string; tagLine: string },
    private readonly matches: MatchesRepository,
    private readonly participants: ParticipantsRepository,
    private readonly options: RecentMatchEnricherOptions = {},
  ) {}

  async enrich(rows: MatchRow[], queues: QueueIndex): Promise<number> {
    const apiKey = this.getApiKey()
    if (!apiKey || apiKey === this.rejectedKey) return 0

    const pending = rows.filter(
      (row) => row.isMatched === 1 &&
        this.matches.needsLabelEvaluation(row.gameId, this.ownerPuuid),
    )
    if (pending.length === 0) return 0

    const api = this.options.apiFactory?.(apiKey, this.regionalRoute) ??
      new RiotApiClient(apiKey, this.regionalRoute)

    let participantPuuid: string
    try {
      participantPuuid = await this.resolveMatchPuuid(api, apiKey)
    } catch (error) {
      if (this.rejectsKey(error)) this.rejectedKey = apiKey
      console.warn(`Match-V5 label enrichment skipped: ${(error as Error).message}`)
      return 0
    }

    let enriched = 0
    for (const row of pending) {
      const matchId = row.riotMatchId || `${this.platformId}_${row.gameId}`
      try {
        const dto = await api.get<RiotMatchDto>(
          `/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
          "match-detail",
        )
        const mapped = mapRiotMatch(
          dto,
          this.ownerPuuid,
          queues.get(dto.info?.queueId ?? row.queueId),
          participantPuuid,
        )
        if (!mapped || mapped.match.isMatched !== 1) {
          this.matches.markLabelsUnavailable(row.gameId, this.ownerPuuid)
          continue
        }

        this.matches.setRiotMatchId(row.gameId, this.ownerPuuid, matchId)
        this.participants.insertMany(mapped.participants)
        this.participants.insertTeams(mapped.teams)
        this.participants.recordCapture(
          row.gameId,
          this.ownerPuuid,
          "match_v5",
          mapped.participants,
          mapped.teams.length,
          mapped.unknownParticipantFields,
        )

        const owner = mapped.participants.find((entry) => entry.isPlayer === 1)
        if (owner && (mapped.match.modeFamily === "sr" || mapped.match.modeFamily === "aram")) {
          const grades = gradeLobby(mapped.gradeInputs, mapped.match.modeFamily)
          this.participants.setGrades(row.gameId, this.ownerPuuid, grades)
          const grade = grades.get(owner.participantId)
          if (grade) {
            this.matches.setGrade(
              row.gameId,
              this.ownerPuuid,
              grade.grade,
              grade.score,
            )
          }
        }

        this.matches.replacePerformanceLabels(
          row.gameId,
          this.ownerPuuid,
          owner ? evaluateMatchLabels({
            match: mapped.match,
            player: owner,
            participants: mapped.participants,
            teams: mapped.teams,
          }) : [],
        )
        enriched += 1
      } catch (error) {
        if (error instanceof RiotApiError && error.status === 404) {
          this.matches.markLabelsUnavailable(row.gameId, this.ownerPuuid)
          continue
        }
        if (this.rejectsKey(error)) this.rejectedKey = apiKey
        console.warn(`Match-V5 label enrichment stopped: ${(error as Error).message}`)
        break
      }
    }

    return enriched
  }

  private async resolveMatchPuuid(api: MatchApi, apiKey: string) {
    if (this.resolvedKey === apiKey && this.matchPuuid) return this.matchPuuid

    const account = await api.get<{ puuid?: unknown }>(
      `/riot/account/v1/accounts/by-riot-id/` +
        `${encodeURIComponent(this.riotId.gameName)}/` +
        `${encodeURIComponent(this.riotId.tagLine)}`,
      "account",
    )
    if (typeof account.puuid !== "string" || account.puuid.length === 0) {
      throw new Error("Riot's account response did not include a PUUID")
    }
    this.resolvedKey = apiKey
    this.matchPuuid = account.puuid
    this.options.onAccountResolved?.(account.puuid)
    return account.puuid
  }

  private rejectsKey(error: unknown) {
    return error instanceof RiotApiError && (error.status === 401 || error.status === 403)
  }
}
