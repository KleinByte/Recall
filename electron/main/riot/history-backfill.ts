import type { MatchesRepository } from "../database/matches-repo.js"
import type { ParticipantsRepository } from "../database/participants-repo.js"
import type { ChampSelectRepository } from "../database/champ-select-repo.js"
import {
  MatchSourceRepository,
  type RawPayloadIdentity,
} from "../database/match-source-repo.js"
import {
  RiotBackfillRepository,
  type RiotBackfillState,
} from "../database/riot-backfill-repo.js"
import { evaluateMatchLabels } from "../matches/labels.js"
import type { RecallV3Service } from "../matches/recall-v3-service.js"
import type { QueueIndex } from "../matches/queues.js"
import { RiotApiClient, RiotApiError } from "./api-client.js"
import {
  mapRiotMatch,
  MATCH_V5_MAPPER_VERSION,
  type RiotMatchDto,
} from "./match-mapper.js"

const PAGE_SIZE = 100

interface MatchApi {
  get<T>(path: string, scope: string, signal?: AbortSignal): Promise<T>
}

interface BackfillOptions {
  api?: MatchApi
  matchPuuid?: string
  onProgress?: (state: RiotBackfillState) => void
  champSelect?: ChampSelectRepository
  recallV3?: RecallV3Service
  sourceRepository?: MatchSourceRepository
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
  private readonly matchPuuid: string
  private readonly onProgress: (state: RiotBackfillState) => void
  private readonly champSelect?: ChampSelectRepository
  private readonly recallV3?: RecallV3Service
  private readonly sourceRepository?: MatchSourceRepository

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
    this.matchPuuid = options.matchPuuid ?? puuid
    this.onProgress = options.onProgress ?? (() => undefined)
    this.champSelect = options.champSelect
    this.recallV3 = options.recallV3
    this.sourceRepository = options.sourceRepository
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
      const matchPuuid = this.matchPuuid
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
            this.participants.hasCurrentLobby(knownGameId, this.puuid) &&
            !this.matches.needsLabelEvaluation(knownGameId, this.puuid)
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
          let raw: RawPayloadIdentity | undefined
          try {
            dto = await this.api.get<RiotMatchDto>(
              `/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
              "match-detail",
              signal,
            )
            downloaded += 1
            raw = this.sourceRepository?.persistRawPayload({
              ownerPuuid: this.puuid,
              source: "match_v5",
              sourceMatchId: matchId,
              gameId: knownGameId,
              kind: "match_detail",
              body: dto,
              mapperVersion: MATCH_V5_MAPPER_VERSION,
              fetchedAt: Date.now(),
            })
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
            if (raw) this.sourceRepository?.setMappingResult(raw, "unmappable", Date.now(), {
              error: "match_v5_detail_unmappable",
            })
            skipped += 1
            state = this.advanceOne(state, {
              downloaded,
              imported,
              skipped,
            })
            continue
          }

          if (mapped.match.isMatched !== 1) {
            if (raw) this.sourceRepository?.setMappingResult(raw, "mapped", Date.now(), {
              gameId: mapped.match.gameId,
            })
            skipped += 1
            state = this.advanceOne(state, {
              downloaded,
              imported,
              skipped,
            })
            continue
          }

          imported += this.matches.insertMany([mapped.match])
          this.champSelect?.stamp(mapped.match.gameId, this.puuid, mapped.participants)
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

          const owner = mapped.participants.find(
            (participant) => participant.isPlayer === 1,
          )
          this.matches.replacePerformanceLabels(
            mapped.match.gameId,
            this.puuid,
            owner ? evaluateMatchLabels({
              match: mapped.match,
              player: owner,
              participants: mapped.participants,
              teams: mapped.teams,
            }) : [],
          )

          this.recallV3?.gradeStoredMatch(mapped.match.gameId, this.puuid)
          if (raw) this.sourceRepository?.setMappingResult(raw, "mapped", Date.now(), {
            gameId: mapped.match.gameId,
          })

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
