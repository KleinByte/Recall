import type { MatchesRepository } from "./database/matches-repo.js"
import type { ChampSelectRepository } from "./database/champ-select-repo.js"
import type { ParticipantsRepository } from "./database/participants-repo.js"
import type { LcuClient } from "./lcu-client.js"
import { gradeLobby, type GradeInput } from "./matches/grade.js"
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
import { resolvePosition } from "./matches/position.js"

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

/** Grading costs one request per game, so it is capped per sync. */
const MAX_GRADES_PER_SYNC = 20

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

  constructor(
    private readonly client: LcuClient,
    private readonly repository: MatchesRepository,
    private readonly puuid: string,
    private readonly participants?: ParticipantsRepository,
    private readonly champSelect?: ChampSelectRepository,
  ) {}

  async syncNow(): Promise<SyncResult> {
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
    } catch (error) {
      // A closed or busy client is normal; the next sync will pick these up.
      console.warn(`Match history sync skipped: ${(error as Error).message}`)
      return { fetched: 0, inserted: 0, graded: 0, lobbies: 0 }
    }

    const rows = games
      .map((game) => mapMatchRow(game, this.puuid, this.queues.get(game.queueId)))
      .filter(
        (row): row is MatchRow =>
          row !== undefined && row.isMatched === 1,
      )

    const inserted = this.repository.insertMany(rows)
    const graded = await this.gradePendingMatches()
    const lobbies = await this.backfillLobbies(rows)

    return { fetched: games.length, inserted, graded, lobbies }
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
        const family = windowRows.find((row) => row.gameId === gameId)?.modeFamily
        if (this.storeLobby(detail, family)) stored += 1
      } catch (error) {
        console.warn(
          `Could not read the lobby for game ${gameId}: ${(error as Error).message}`,
        )
        break
      }
    }

    return stored
  }

  private storeLobby(detail: GameDetail, family?: ModeFamily): boolean {
    if (!this.participants) return false

    const rows = mapParticipants(detail, this.puuid)
    if (rows.length === 0) return false

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
    if ((family === "aram" || family === "sr") && detail.gameId) {
      this.participants.setGrades(
        detail.gameId,
        this.puuid,
        gradeLobby(this.gradeInputs(detail), family),
      )
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

    return stored
  }

  /**
   * Assigns grades to stored matches that do not have one yet.
   *
   * Grading is separate from recording because it needs the full lobby, which
   * is an extra request per game. Keeping it separate means a grading failure
   * never costs us the match itself.
   */
  private async gradePendingMatches(): Promise<number> {
    const pending = this.repository.getUngradedMatches(
      this.puuid,
      MAX_GRADES_PER_SYNC,
    )

    let graded = 0

    for (const { gameId, modeFamily } of pending) {
      try {
        const detail = await this.client.request<GameDetail>(
          `/lol-match-history/v1/games/${gameId}`,
        )

        // The lobby is already in hand, so keep it rather than paying for the
        // same request again later.
        this.storeLobby(detail, modeFamily)

        const result = gradeLobby(this.gradeInputs(detail), modeFamily).get(
          identityParticipantId(detail, this.puuid),
        )
        if (!result) continue

        this.repository.setGrade(
          gameId,
          this.puuid,
          result.grade,
          result.score,
        )
        graded += 1
      } catch (error) {
        // Games that have aged out of the client's history can never be
        // graded; stop rather than retrying the whole batch every sync.
        console.warn(
          `Could not grade game ${gameId}: ${(error as Error).message}`,
        )
        break
      }
    }

    return graded
  }

  private gradeInputs(detail: GameDetail): GradeInput[] {
    const minutes = Math.max(1, (detail.gameDuration ?? 0) / 60)
    const ownerId = identityParticipantId(detail, this.puuid)
    const ownTeam = detail.participants?.find(
      (participant) => participant.participantId === ownerId,
    )?.teamId
    const assigned = detail.gameId && this.champSelect
      ? this.champSelect.positionsFor(detail.gameId, this.puuid)
      : new Map<number, string>()

    const lobby: GradeInput[] = (detail.participants ?? []).map((participant) => ({
      participantId: participant.participantId,
      teamId: participant.teamId,
      kills: number(participant.stats?.kills),
      deaths: number(participant.stats?.deaths),
      assists: number(participant.stats?.assists),
      damageToChampions: number(participant.stats?.totalDamageDealtToChampions),
      damageTaken: number(participant.stats?.totalDamageTaken),
      goldEarned: number(participant.stats?.goldEarned),
      csPerMin:
        (number(participant.stats?.totalMinionsKilled) +
          number(participant.stats?.neutralMinionsKilled)) /
        minutes,
      visionScore: number(participant.stats?.visionScore),
      damageObjectives: number(participant.stats?.damageDealtToObjectives),
      role: resolvePosition(
        participant.timeline?.lane,
        participant.timeline?.role,
        participant.teamId === ownTeam && participant.championId !== undefined
          ? assigned.get(participant.championId)
          : undefined,
      ),
    }))

    return lobby
  }
}

function identityParticipantId(detail: GameDetail, puuid: string): number {
  return detail.participantIdentities?.find(
    (entry) => entry.player?.puuid === puuid,
  )?.participantId ?? -1
}

const number = (value: number | boolean | undefined) =>
  typeof value === "number" ? value : 0
