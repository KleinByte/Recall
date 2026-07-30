import type { MatchesRepository } from "../database/matches-repo.js"
import type { ParticipantsRepository } from "../database/participants-repo.js"
import {
  RiotBackfillRepository,
  type RiotBackfillState,
} from "../database/riot-backfill-repo.js"
import { gradeLobby } from "../matches/grade.js"
import type { QueueIndex } from "../matches/queues.js"
import { RiotApiClient, RiotApiError } from "./api-client.js"
import { mapRiotMatch, type RiotMatchDto } from "./match-mapper.js"

const PAGE_SIZE = 100

interface MatchApi {
  get<T>(path: string, scope: string, signal?: AbortSignal): Promise<T>
}

interface BackfillOptions {
  api?: MatchApi
  riotId?: {
    gameName: string
    tagLine: string
  }
  onProgress?: (state: RiotBackfillState) => void
  onAccountResolved?: (matchPuuid: string) => void
}

const gameIdFromMatchId = (matchId: string) => {
  const value = Number(matchId.match(/(\d+)$/)?.[1])
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/**
 * Imports every Match-V5 page Riot makes available for one account.
 *
 * The cursor advances only after each match is durable. Replaying the current
 * match after a crash is safe because match and lobby writes are idempotent.
 */
export class RiotHistoryBackfill {
  private readonly api: MatchApi
  private readonly progress: RiotBackfillRepository
  private readonly riotId: BackfillOptions["riotId"]
  private readonly onProgress: (state: RiotBackfillState) => void
  private readonly onAccountResolved: (matchPuuid: string) => void

  constructor(
    private readonly apiKey: string,
    private readonly regionalRoute: string,
    private readonly puuid: string,
    private readonly matches: MatchesRepository,
    private readonly participants: ParticipantsRepository,
    private readonly queues: QueueIndex,
    progress: RiotBackfillRepository,
    options: BackfillOptions = {},
  ) {
    this.api =
      options.api ?? new RiotApiClient(this.apiKey, this.regionalRoute)
    this.progress = progress
    this.riotId = options.riotId
    this.onProgress = options.onProgress ?? (() => undefined)
    this.onAccountResolved = options.onAccountResolved ?? (() => undefined)
  }

  async run(restart: boolean, signal?: AbortSignal) {
    const existing = this.progress.get(this.puuid, this.regionalRoute)
    const persistedStart = typeof existing?.startTimeSeconds === "number"
      ? existing.startTimeSeconds
      : undefined
    const incrementalFrom = !restart && existing?.status === "complete"
      ? Math.max(
        0,
        (existing.coverageThroughSeconds ?? existing.endTimeSeconds) -
          24 * 60 * 60,
      )
      : restart ? undefined : persistedStart
    let state = existing
    try {
      const matchPuuid = await this.resolveMatchPuuid(signal)
      if (
        !restart &&
        existing?.status === "complete" &&
        (existing.completedAt ?? 0) >= Date.now() - 6 * 60 * 60 * 1000
      ) {
        this.onProgress(existing)
        return existing
      }

      state = this.progress.start(
        this.puuid,
        this.regionalRoute,
        restart || incrementalFrom !== undefined,
        Date.now(),
        incrementalFrom,
      )
      this.onProgress(state)

      while (!signal?.aborted) {
        const ids = await this.api.get<string[]>(
          `/lol/match/v5/matches/by-puuid/${encodeURIComponent(
            matchPuuid,
          )}/ids?start=${state.nextOffset}&count=${PAGE_SIZE}` +
            `&endTime=${state.endTimeSeconds}` +
            (typeof state.startTimeSeconds !== "number"
              ? ""
              : `&startTime=${state.startTimeSeconds}`),
          "match-ids",
          signal,
        )

        if (ids.length === 0) {
          state = this.progress.complete(this.puuid, this.regionalRoute)
          this.onProgress(state)
          return state
        }

        for (const matchId of ids) {
          if (signal?.aborted) break

          let downloaded = 0
          let imported = 0
          let skipped = 0
          const knownGameId = gameIdFromMatchId(matchId)
          if (
            knownGameId &&
            this.matches.hasCompleteMatch(knownGameId, this.puuid) &&
            this.participants.hasCurrentLobby(knownGameId, this.puuid)
          ) {
            this.matches.setRiotMatchId(knownGameId, this.puuid, matchId)
            state = this.advanceOne(state, {
              downloaded,
              imported,
              skipped,
            })
            continue
          }

          let dto: RiotMatchDto
          try {
            dto = await this.api.get<RiotMatchDto>(
              `/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
              "match-detail",
              signal,
            )
            downloaded += 1
          } catch (error) {
            // A deleted/remade record can remain in the ID list. It has no
            // useful detail to retry, so record it and continue.
            if (error instanceof RiotApiError && error.status === 404) {
              skipped += 1
              state = this.advanceOne(state, {
                downloaded,
                imported,
                skipped,
              })
              continue
            }
            throw error
          }

          const mapped = mapRiotMatch(
            dto,
            this.puuid,
            this.queues.get(dto.info?.queueId ?? 0),
            matchPuuid,
          )
          if (!mapped) {
            skipped += 1
            state = this.advanceOne(state, {
              downloaded,
              imported,
              skipped,
            })
            continue
          }

          imported += this.matches.insertMany([mapped.match])
          this.participants.insertMany(mapped.participants)
          this.participants.insertTeams(mapped.teams)
          this.participants.recordCapture(
            mapped.match.gameId,
            this.puuid,
            "match_v5",
            mapped.participants,
            mapped.teams.length,
            mapped.unknownParticipantFields,
          )

          if (
            mapped.match.modeFamily === "aram" ||
            mapped.match.modeFamily === "sr"
          ) {
            const grades = gradeLobby(
              mapped.gradeInputs,
              mapped.match.modeFamily,
            )
            this.participants.setGrades(
              mapped.match.gameId,
              this.puuid,
              grades,
            )
            const owner = mapped.participants.find(
              (participant) => participant.isPlayer === 1,
            )
            const grade = owner && grades.get(owner.participantId)
            if (grade) {
              this.matches.setGrade(
                mapped.match.gameId,
                this.puuid,
                grade.grade,
                grade.score,
              )
            }
          }

          state = this.advanceOne(state, {
            downloaded,
            imported,
            skipped,
          })
        }

        if (signal?.aborted) break

        if (ids.length < PAGE_SIZE) {
          state = this.progress.complete(this.puuid, this.regionalRoute)
          this.onProgress(state)
          return state
        }
      }

      state = this.progress.stop(
        this.puuid,
        this.regionalRoute,
        "paused",
      )
      this.onProgress(state)
      return state
    } catch (error) {
      if (!state) {
        state = this.progress.start(
          this.puuid,
          this.regionalRoute,
          false,
        )
      }
      if (signal?.aborted) {
        state = this.progress.stop(
          this.puuid,
          this.regionalRoute,
          "paused",
        )
        this.onProgress(state)
        return state
      }

      state = this.progress.stop(
        this.puuid,
        this.regionalRoute,
        "error",
        (error as Error).message,
      )
      this.onProgress(state)
      throw error
    }
  }

  /**
   * The League client now exposes a local 36-character account UUID, while
   * Match-V5 still requires Riot's encrypted PUUID. Resolve it from the
   * signed-in Riot ID and retain the local UUID as Recall's storage key.
   */
  private async resolveMatchPuuid(signal?: AbortSignal): Promise<string> {
    if (!this.riotId) return this.puuid

    const account = await this.api.get<{ puuid?: unknown }>(
      `/riot/account/v1/accounts/by-riot-id/` +
        `${encodeURIComponent(this.riotId.gameName)}/` +
        `${encodeURIComponent(this.riotId.tagLine)}`,
      "account",
      signal,
    )
    if (typeof account.puuid !== "string" || account.puuid.length === 0) {
      throw new Error("Riot's account response did not include a PUUID")
    }
    this.onAccountResolved(account.puuid)
    return account.puuid
  }

  private advanceOne(
    state: RiotBackfillState,
    counts: { downloaded: number; imported: number; skipped: number },
  ) {
    const next = this.progress.advance(
      this.puuid,
      this.regionalRoute,
      state.nextOffset + 1,
      {
        idsScanned: 1,
        matchesDownloaded: counts.downloaded,
        matchesImported: counts.imported,
        matchesSkipped: counts.skipped,
      },
    )
    this.onProgress(next)
    return next
  }
}
