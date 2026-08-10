import type { MatchesRepository } from "./database/matches-repo.js"
import type { ChampSelectRepository } from "./database/champ-select-repo.js"
import type { ParticipantsRepository } from "./database/participants-repo.js"
import type { LiveGameCaptureRepository } from "./database/live-game-capture-repo.js"
import type { LcuClient } from "./lcu-client.js"
import type { RecallV3Service } from "./matches/recall-v3-service.js"
import {
  evaluateMatchLabels,
  prioritizePerformanceLabels,
} from "./matches/labels.js"
import { mapMatchRow } from "./matches/map-match.js"
import {
  mapParticipants,
  mapTeams,
  type GameDetail,
} from "./matches/map-participants.js"
import { fetchQueues, type QueueIndex } from "./matches/queues.js"
import type { LcuGame, MatchRow, ModeFamily } from "./matches/types.js"
import {
  MatchSourceRepository,
  gzipCanonicalJsonV1,
  type RawPayloadIdentity,
} from "./database/match-source-repo.js"
import { LCU_MATCH_MAPPER_VERSION } from "./matches/map-match.js"
import { PARTICIPANT_DETAIL_VERSION } from "./database/participants-repo.js"

export interface SyncResult {
  fetched: number
  inserted: number
  graded: number
  lobbies: number
}

interface MatchHistoryResponse {
  games?: { games?: LcuGame[] }
}

/**
 * The League Client only ever exposes the most recent 20 games. Paging
 * parameters beyond that are accepted but ignored, so this is the entire
 * window available to the app.
 */
const WINDOW_SIZE = 20

/**
 * So does fetching a lobby for a game recorded before lobbies were kept.
 *
 * Matched to the grading cap: on the first sync after an upgrade this is the
 * same load a fresh install already places on the client, and it fills the
 * whole window in one pass rather than trickling in over twenty minutes.
 */
const MAX_LOBBY_BACKFILL_PER_SYNC = 20

/**
 * Keeps the local database in step with the client's rolling history window.
 *
 * Because the client cannot serve older games, history is accumulated by
 * re-reading the window often and storing anything not seen before. Running
 * this repeatedly is intentional and cheap: the repository ignores matches it
 * already holds.
 */
export class MatchSync {
  private queues: QueueIndex = new Map()
  private gradedThisSync = 0

  constructor(
    private readonly client: LcuClient,
    private readonly repository: MatchesRepository,
    private readonly puuid: string,
    private readonly participants?: ParticipantsRepository,
    private readonly champSelect?: ChampSelectRepository,
    private readonly liveCaptures?: LiveGameCaptureRepository,
    private readonly sourceRepository?: MatchSourceRepository,
    private readonly recallV3?: RecallV3Service,
  ) {}

  async syncNow(): Promise<SyncResult> {
    this.gradedThisSync = 0
    let games: LcuGame[]

    // The client is the authority on what each queue is. Read once per sync so
    // a queue added mid-session is picked up without a restart.
    if (this.queues.size === 0) {
      this.queues = await fetchQueues(this.client)
    }

    try {
      const response = await this.client.request<MatchHistoryResponse>(
        `/lol-match-history/v1/products/lol/${this.puuid}/matches` +
          `?begIndex=0&endIndex=${WINDOW_SIZE - 1}`,
      )
      games = response.games?.games ?? []
      if (this.sourceRepository) {
        const capturedAt = Date.now()
        const sha = gzipCanonicalJsonV1(response).sha256
        const page = this.sourceRepository.persistRawPayload({
          ownerPuuid: this.puuid, source: "league_client",
          sourceMatchId: `page:${capturedAt}:${sha.slice(0, 12)}`,
          kind: "history_page", body: response,
          mapperVersion: LCU_MATCH_MAPPER_VERSION, fetchedAt: capturedAt,
        })
        this.sourceRepository.setMappingResult(page, "mapped", capturedAt)
      }
    } catch (error) {
      // A closed or busy client is normal; the next sync will pick these up.
      console.warn(`Match history sync skipped: ${(error as Error).message}`)
      return { fetched: 0, inserted: 0, graded: 0, lobbies: 0 }
    }

    const rows: MatchRow[] = []
    const rawRows: RawPayloadIdentity[] = []
    for (const game of games) {
      const capturedAt = Date.now()
      const raw = this.sourceRepository?.persistRawPayload({
        ownerPuuid: this.puuid, source: "league_client",
        sourceMatchId: String(game.gameId), gameId: game.gameId,
        kind: "history_summary", body: game,
        dataVersion: game.gameVersion, mapperVersion: LCU_MATCH_MAPPER_VERSION,
        fetchedAt: capturedAt,
      })
      try {
        const row = mapMatchRow(game, this.puuid, this.queues.get(game.queueId))
        if (!row) throw new Error("owner_participant_missing")
        rows.push(row)
        if (raw) rawRows.push(raw)
      } catch (error) {
        if (raw) this.sourceRepository?.setMappingResult(raw, "unmappable", capturedAt, {
          gameId: game.gameId,
          error: error instanceof Error ? error.message.slice(0, 500) : "history_summary_unmappable",
        })
      }
    }

    this.liveCaptures?.repairStoredPositions(this.puuid)
    const inserted = this.repository.insertMany(rows)
    for (const raw of rawRows) {
      this.sourceRepository?.setMappingResult(raw, "mapped", Date.now(), {
        gameId: Number(raw.sourceMatchId),
      })
    }
    const lobbies = await this.backfillLobbies(rows)

    return { fetched: games.length, inserted, graded: this.gradedThisSync, lobbies }
  }

  /**
   * Stores the lobby for games that were recorded before lobbies were kept.
   *
   * Only games still inside the client's window can be recovered; anything
   * older is gone for good, which is why this runs on every sync rather than
   * once.
   */
  private async backfillLobbies(windowRows: MatchRow[]): Promise<number> {
    if (!this.participants) return 0

    const missing = this.participants.getGamesMissingLobby(
      this.puuid,
      windowRows
        .filter((row) => row.isMatched === 1)
        .map((row) => row.gameId),
      MAX_LOBBY_BACKFILL_PER_SYNC,
    )

    let stored = 0

    for (const gameId of missing) {
      try {
        const detail = await this.client.request<GameDetail>(
          `/lol-match-history/v1/games/${gameId}`,
        )
        const raw = this.captureLobbyDetail(detail)
        const family = windowRows.find((row) => row.gameId === gameId)?.modeFamily
        if (this.storeLobby(detail, family, raw)) stored += 1
      } catch (error) {
        console.warn(
          `Could not read the lobby for game ${gameId}: ${(error as Error).message}`,
        )
        break
      }
    }

    return stored
  }

  private storeLobby(
    detail: GameDetail,
    family?: ModeFamily,
    raw?: RawPayloadIdentity,
  ): boolean {
    if (!this.participants) return false

    const rows = mapParticipants(detail, this.puuid)
    if (rows.length === 0) {
      if (raw) this.sourceRepository?.setMappingResult(raw, "unmappable", Date.now(), {
        gameId: detail.gameId, error: "scoreboard_owner_or_roster_missing",
      })
      return false
    }

    this.liveCaptures?.stampPositions(detail.gameId, this.puuid, rows)
    this.champSelect?.stamp(detail.gameId, this.puuid, rows)

    const stored = this.participants.insertMany(rows) > 0
    const teams = mapTeams(detail, this.puuid)
    this.participants.insertTeams(teams)
    if (detail.gameId) {
      this.participants.recordCapture(
        detail.gameId,
        this.puuid,
        "league_client",
        rows,
        teams.length,
      )
    }
    if (detail.gameId) {
      this.repository.reconcileLcuDetailDuration(
        detail.gameId,
        this.puuid,
        detail.gameDuration,
      )
    }
    if (detail.gameId && this.recallV3) {
      const status = this.recallV3.gradeStoredMatch(detail.gameId, this.puuid)
      if (status === "ready") this.gradedThisSync += 1
    }
    if (detail.gameId) {
      const match = this.repository.getMatch(detail.gameId, this.puuid)
      const owner = rows.find((row) => row.isPlayer === 1)
      if (match && owner) {
        this.repository.replacePerformanceLabels(
          detail.gameId,
          this.puuid,
          prioritizePerformanceLabels(evaluateMatchLabels({
            match,
            player: owner,
            participants: rows,
            teams,
          })),
        )
      }
    }

    if (raw) this.sourceRepository?.setMappingResult(raw, "mapped", Date.now(), {
      gameId: detail.gameId,
    })
    return stored
  }

  private captureLobbyDetail(detail: GameDetail): RawPayloadIdentity | undefined {
    if (!this.sourceRepository) return undefined
    return this.sourceRepository.persistRawPayload({
      ownerPuuid: this.puuid, source: "league_client",
      sourceMatchId: String(detail.gameId), gameId: detail.gameId,
      kind: "scoreboard_detail", body: detail,
      mapperVersion: PARTICIPANT_DETAIL_VERSION, fetchedAt: Date.now(),
    })
  }

}
