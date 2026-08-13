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
import type { MatchGradingService } from "../matches/match-grading-service.js"
import type { QueueIndex } from "../matches/queues.js"
import { RiotApiClient, RiotApiError } from "./api-client.js"
import {
  mapRiotMatch,
  MATCH_V5_MAPPER_VERSION,
  type RiotMatchDto,
} from "./match-mapper.js"
import {
  mapTimeline,
  TIMELINE_MAPPER_VERSION,
  type CompactTimeline,
} from "./timeline-mapper.js"

const PAGE_SIZE = 100

interface MatchApi {
  get<T>(path: string, scope: string, signal?: AbortSignal): Promise<T>
}

type TimelineFrames = Parameters<typeof mapTimeline>[0]

interface RiotMatchTimelineDto {
  frames?: TimelineFrames
  info?: { frames?: TimelineFrames }
}

interface BackfillOptions {
  api?: MatchApi
  matchPuuid?: string
  riotId?: {
    gameName: string
    tagLine: string
  }
  onAccountResolved?: (matchPuuid: string) => void
  onProgress?: (state: RiotBackfillState) => void
  champSelect?: ChampSelectRepository
  recall?: MatchGradingService
  sourceRepository?: MatchSourceRepository
}

const gameIdFromMatchId = (matchId: string) => {
  const value = Number(matchId.match(/(\d+)$/)?.[1])
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function ownerHasTotalTimeSpentDead(
  participants: ReturnType<ParticipantsRepository["getMatchDetail"]>["participants"],
): boolean {
  const value = participants.find((participant) => participant.isPlayer === 1)
    ?.extendedMetrics?.totalTimeSpentDead
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function completeMappedTimeline(
  timeline: CompactTimeline,
  participantIds: readonly number[],
  durationSecs: number,
): boolean {
  const expected = new Set(participantIds.filter((id) =>
    Number.isSafeInteger(id) && id > 0))
  if (expected.size === 0 || timeline.frames.length === 0) return false
  if (timeline.frames.some((frame) => frame.teamGoldComplete === false ||
      [...expected].some((participantId) =>
        !frame.participants.some((participant) =>
          participant.participantId === participantId)))) return false
  const lastTimestamp = timeline.frames.at(-1)?.timestamp
  return typeof lastTimestamp === "number" && Number.isFinite(lastTimestamp) &&
    lastTimestamp >= Math.max(0, durationSecs * 1_000 - 90_000)
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
  private readonly cachedMatchPuuid: string
  private readonly riotId: BackfillOptions["riotId"]
  private readonly onAccountResolved: (matchPuuid: string) => void
  private readonly onProgress: (state: RiotBackfillState) => void
  private readonly champSelect?: ChampSelectRepository
  private readonly recall?: MatchGradingService
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
    this.cachedMatchPuuid = options.matchPuuid ?? puuid
    this.riotId = options.riotId
    this.onAccountResolved = options.onAccountResolved ?? (() => undefined)
    this.onProgress = options.onProgress ?? (() => undefined)
    this.champSelect = options.champSelect
    this.recall = options.recall
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
          const hasCompleteLocalMatch = knownGameId !== undefined &&
            this.matches.hasCompleteMatch(knownGameId, this.puuid) &&
            this.participants.hasCurrentLobby(knownGameId, this.puuid)
          const storedParticipants = hasCompleteLocalMatch && knownGameId
            ? this.participants.getMatchDetail(knownGameId, this.puuid).participants
            : []
          const hasCurrentDetailArtifact = this.sourceRepository?.hasMappedPayload({
            ownerPuuid: this.puuid,
            source: "match_v5",
            sourceMatchId: matchId,
            kind: "match_detail",
            mapperVersion: MATCH_V5_MAPPER_VERSION,
          }) ?? false
          // A Riot match id alone is not proof that Match-V5 extended facts
          // were captured. Enrich an otherwise complete LCU lobby once when
          // its owner lacks time-dead evidence and no authoritative detail
          // artifact establishes that the field was genuinely absent.
          const needsExtendedDetail = hasCompleteLocalMatch &&
            !ownerHasTotalTimeSpentDead(storedParticipants) &&
            this.sourceRepository !== undefined && !hasCurrentDetailArtifact
          const needsTimeline = knownGameId !== undefined &&
            this.sourceRepository !== undefined &&
            !this.sourceRepository.hasCurrentTimelineResult({
              gameId: knownGameId,
              puuid: this.puuid,
              source: "match_v5",
              mapperVersion: TIMELINE_MAPPER_VERSION,
            })
          if (knownGameId !== undefined && hasCompleteLocalMatch &&
              !this.matches.needsLabelEvaluation(knownGameId, this.puuid) &&
              !needsExtendedDetail) {
            this.matches.setRiotMatchId(knownGameId, this.puuid, matchId)
            if (needsTimeline) {
              await this.captureTimeline(
                matchId,
                knownGameId,
                storedParticipants,
                signal,
              )
            }
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
            }) : [],
          )

          this.recall?.gradeStoredMatch(mapped.match.gameId, this.puuid)
          if (raw) this.sourceRepository?.setMappingResult(raw, "mapped", Date.now(), {
            gameId: mapped.match.gameId,
          })
          await this.captureTimeline(
            matchId,
            mapped.match.gameId,
            mapped.participants,
            signal,
          )

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
   * The League client exposes a local account UUID, while Match-V5 requires
   * Riot's public PUUID. Refresh it from the signed-in Riot ID so an old cache
   * cannot permanently break history imports after Riot rotates identifiers.
   */
  private async resolveMatchPuuid(signal?: AbortSignal): Promise<string> {
    if (!this.riotId) return this.cachedMatchPuuid

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

  private async captureTimeline(
    matchId: string,
    gameId: number,
    participants: ReturnType<ParticipantsRepository["getMatchDetail"]>["participants"],
    signal?: AbortSignal,
  ): Promise<CompactTimeline | undefined> {
    const sources = this.sourceRepository
    if (!sources || sources.hasCurrentTimelineResult({
      gameId,
      puuid: this.puuid,
      source: "match_v5",
      mapperVersion: TIMELINE_MAPPER_VERSION,
    })) return undefined

    let dto: RiotMatchTimelineDto
    try {
      dto = await this.api.get<RiotMatchTimelineDto>(
        `/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`,
        "timeline",
        signal,
      )
    } catch (error) {
      if (!(error instanceof RiotApiError) || error.status !== 404) throw error
      sources.markTimelineUnavailable({
        gameId,
        puuid: this.puuid,
        source: "match_v5",
        sourceMatchId: matchId,
        mapperVersion: TIMELINE_MAPPER_VERSION,
        capturedAt: Date.now(),
        reason: "match_v5_timeline_not_found",
      })
      return undefined
    }

    const fetchedAt = Date.now()
    const raw = sources.persistRawPayload({
      ownerPuuid: this.puuid,
      source: "match_v5",
      sourceMatchId: matchId,
      gameId,
      kind: "timeline",
      body: dto,
      mapperVersion: TIMELINE_MAPPER_VERSION,
      fetchedAt,
    })
    const frames = dto.frames ?? dto.info?.frames
    const owner = participants.find((participant) => participant.isPlayer === 1)
    if (!owner || !frames?.length) {
      sources.setMappingResult(raw, "unmappable", fetchedAt, {
        gameId,
        error: "match_v5_timeline_incomplete",
      })
      sources.markTimelineUnavailable({
        gameId,
        puuid: this.puuid,
        source: "match_v5",
        sourceMatchId: matchId,
        mapperVersion: TIMELINE_MAPPER_VERSION,
        capturedAt: fetchedAt,
        reason: "match_v5_timeline_incomplete",
      })
      return undefined
    }

    const timeline = mapTimeline(
      frames,
      owner.participantId,
      new Map(participants.map((participant) => [
        participant.participantId,
        participant.teamId,
      ])),
    )
    const durationSecs = this.matches.getMatch(gameId, this.puuid)?.durationSecs ?? 0
    if (!completeMappedTimeline(
      timeline,
      participants.map((participant) => participant.participantId),
      durationSecs,
    )) {
      sources.setMappingResult(raw, "unmappable", fetchedAt, {
        gameId,
        error: "match_v5_timeline_failed_completeness_contract",
      })
      sources.markTimelineUnavailable({
        gameId,
        puuid: this.puuid,
        source: "match_v5",
        sourceMatchId: matchId,
        mapperVersion: TIMELINE_MAPPER_VERSION,
        capturedAt: fetchedAt,
        reason: "match_v5_timeline_failed_completeness_contract",
      })
      return undefined
    }
    sources.persistTimelineSource({
      gameId,
      puuid: this.puuid,
      source: "match_v5",
      sourceMatchId: matchId,
      mapperVersion: TIMELINE_MAPPER_VERSION,
      timeline,
      sourcePayload: raw,
      capturedAt: fetchedAt,
    })
    sources.setMappingResult(raw, "mapped", fetchedAt, { gameId })
    this.recall?.gradeStoredMatch(gameId, this.puuid)
    return timeline
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
