import type { Database } from "better-sqlite3"
import { MAX_ANALYTIC_MATCH_DURATION_SECS } from "../../../src/helpers/time-contract-core.js"
import { decodeCanonicalJsonV1 } from "../database/match-source-repo.js"
import {
  GRADE_CORE_FACT_CONTRACT_VERSION,
  GRADE_CORE_FIELDS,
  assessGradeCoreFacts,
  type GradeCoreField,
  type RawGradeCoreFacts,
} from "./grade-core-facts.js"

interface StoredRawPayload {
  gameId: number
  puuid: string
  source: "league_client" | "match_v5"
  payload: Buffer
  sha256: string
}

interface DecodedGradeSourceLobby {
  facts: RawGradeCoreFacts[]
  durationSecs: number
  durationQuality: "verified" | "source_reported"
}

type StoredCoreRow = Record<GradeCoreField, number>

const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined

function lcuFacts(payload: unknown): RawGradeCoreFacts[] {
  const root = objectRecord(payload)
  const participants = Array.isArray(root?.participants) ? root.participants : []
  return participants.flatMap((value) => {
    const participant = objectRecord(value)
    const stats = objectRecord(participant?.stats)
    if (!participant || !stats) return []
    return [{
      participant_id: participant.participantId,
      team_id: participant.teamId,
      champion_id: participant.championId,
      kills: stats.kills,
      deaths: stats.deaths,
      assists: stats.assists,
      gold_earned: stats.goldEarned,
      damage_to_champions: stats.totalDamageDealtToChampions,
      total_minions_killed: stats.totalMinionsKilled,
      neutral_minions: stats.neutralMinionsKilled,
      damage_objectives: stats.damageDealtToObjectives,
      damage_turrets: stats.damageDealtToTurrets,
      time_ccing_others: stats.timeCCingOthers,
      vision_score: stats.visionScore,
    }]
  })
}

function positiveDuration(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined
  const seconds = value > 100_000 ? Math.round(value / 1_000) : Math.trunc(value)
  return seconds > 0 && seconds <= MAX_ANALYTIC_MATCH_DURATION_SECS ? seconds : undefined
}

function decodedLobby(
  payload: unknown,
  source: StoredRawPayload["source"],
): DecodedGradeSourceLobby | undefined {
  const root = objectRecord(payload)
  if (!root) return undefined
  if (source === "league_client") {
    const durationSecs = positiveDuration(root.gameDuration)
    return durationSecs === undefined ? undefined : {
      facts: lcuFacts(root),
      durationSecs,
      durationQuality: "source_reported",
    }
  }

  const info = objectRecord(root.info)
  if (!info) return undefined
  let durationSecs = positiveDuration(info.gameDuration)
  const start = info.gameStartTimestamp
  const end = info.gameEndTimestamp
  const hasTimestamps = typeof start === "number" && Number.isFinite(start) &&
    typeof end === "number" && Number.isFinite(end)
  if (durationSecs === undefined && hasTimestamps) {
    durationSecs = Math.round(((end as number) - (start as number)) / 1_000)
  }
  if (durationSecs === undefined) return undefined
  if (hasTimestamps) {
    const elapsedSecs = Math.round(((end as number) - (start as number)) / 1_000)
    const toleranceSecs = Math.max(10, Math.round(elapsedSecs * .02))
    if (elapsedSecs <= 0 || Math.abs(durationSecs - elapsedSecs) > toleranceSecs) return undefined
  }
  return {
    facts: matchV5Facts(root),
    durationSecs,
    durationQuality: hasTimestamps ? "verified" : "source_reported",
  }
}

function matchV5Facts(payload: unknown): RawGradeCoreFacts[] {
  const root = objectRecord(payload)
  const info = objectRecord(root?.info)
  const participants = Array.isArray(info?.participants) ? info.participants : []
  return participants.flatMap((value) => {
    const participant = objectRecord(value)
    if (!participant) return []
    return [{
      participant_id: participant.participantId,
      team_id: participant.teamId,
      champion_id: participant.championId,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      gold_earned: participant.goldEarned,
      damage_to_champions: participant.totalDamageDealtToChampions,
      total_minions_killed: participant.totalMinionsKilled,
      neutral_minions: participant.neutralMinionsKilled,
      damage_objectives: participant.damageDealtToObjectives,
      damage_turrets: participant.damageDealtToTurrets,
      time_ccing_others: participant.timeCCingOthers,
      vision_score: participant.visionScore,
    }]
  })
}

function exactStoredLobby(
  db: Database,
  gameId: number,
  puuid: string,
): Map<number, StoredCoreRow> {
  const rows = db.prepare(`
    SELECT participant_id, team_id, champion_id, kills, deaths, assists,
           gold_earned, damage_to_champions, total_minions_killed,
           neutral_minions, damage_objectives, damage_turrets,
           time_ccing_others, vision_score
    FROM match_participants
    WHERE game_id = ? AND puuid = ?
    ORDER BY participant_id
  `).all(gameId, puuid) as StoredCoreRow[]
  return new Map(rows.map((row) => [row.participant_id, row]))
}

function storedDuration(db: Database, gameId: number, puuid: string): number | undefined {
  const row = db.prepare(`
    SELECT duration_secs AS durationSecs
    FROM matches WHERE game_id = ? AND puuid = ?
  `).get(gameId, puuid) as { durationSecs: number } | undefined
  return row && Number.isSafeInteger(row.durationSecs) && row.durationSecs > 0 &&
      row.durationSecs <= MAX_ANALYTIC_MATCH_DURATION_SECS
    ? row.durationSecs
    : undefined
}

function rawLobbyIsExact(
  source: StoredRawPayload["source"],
  facts: RawGradeCoreFacts[],
  stored: Map<number, StoredCoreRow>,
): facts is StoredCoreRow[] {
  if (facts.length !== 10 || stored.size !== 10) return false
  const ids = new Set<number>()
  for (const participant of facts) {
    const assessment = assessGradeCoreFacts(source, participant)
    if (assessment.gradeCoreComplete !== 1) return false
    const participantId = participant.participant_id
    if (!Number.isSafeInteger(participantId) || ids.has(participantId as number)) return false
    ids.add(participantId as number)
    const storedParticipant = stored.get(participantId as number)
    if (!storedParticipant || GRADE_CORE_FIELDS.some((field) =>
      storedParticipant[field] !== participant[field])) return false
  }
  return true
}

export interface GradeCoreBackfillResult {
  verifiedLobbies: number
  verifiedParticipants: number
}

interface VerifiedRawLobby {
  row: StoredRawPayload
  decoded: DecodedGradeSourceLobby
}

function verifiedRawLobbies(db: Database): VerifiedRawLobby[] {
  const payloads = db.prepare(`
    SELECT game_id AS gameId, owner_puuid AS puuid, source, payload, sha256
    FROM match_source_payloads
    WHERE game_id IS NOT NULL AND mapping_status = 'mapped'
      AND ((source = 'league_client' AND kind = 'scoreboard_detail')
        OR (source = 'match_v5' AND kind = 'match_detail'))
    ORDER BY CASE source WHEN 'match_v5' THEN 0 ELSE 1 END,
             fetched_at DESC, sha256 DESC
  `).all() as StoredRawPayload[]
  const verified = new Set<string>()
  const result: VerifiedRawLobby[] = []
  for (const row of payloads) {
    const key = `${row.gameId}\u0000${row.puuid}`
    if (verified.has(key)) continue
    let decoded: DecodedGradeSourceLobby | undefined
    try {
      decoded = decodedLobby(decodeCanonicalJsonV1(row.payload, row.sha256), row.source)
    } catch {
      // Corrupt, incomplete, or mismatched raw evidence remains unavailable.
      // Never fall back to trusting normalized zeroes.
      continue
    }
    if (!decoded) continue
    const durationSecs = storedDuration(db, row.gameId, row.puuid)
    if (durationSecs === undefined || Math.abs(durationSecs - decoded.durationSecs) > 2) continue
    const stored = exactStoredLobby(db, row.gameId, row.puuid)
    if (!rawLobbyIsExact(row.source, decoded.facts, stored)) continue
    verified.add(key)
    result.push({ row, decoded })
  }
  return result
}

/**
 * Read-only startup probe. It prevents a valid legacy raw scoreboard from
 * being stranded behind the "no supported scopes" fast path while preserving
 * the rule that the actual promotion happens only after a verified backup.
 */
export function hasRecoverableGradeCoreFactsFromRawPayloads(db: Database): boolean {
  const pending = db.prepare(`
    SELECT EXISTS(
      SELECT 1 FROM match_participants
      WHERE game_id = ? AND puuid = ? AND (
        COALESCE(grade_core_complete, 0) <> 1 OR
        COALESCE(grade_core_contract_version, 0) <> ? OR
        COALESCE(grade_core_source, '') NOT IN ('league_client', 'match_v5') OR
        COALESCE(grade_core_missing_fields_json, '') <> '[]'
      )
    ) AS participantPending,
    (SELECT duration_quality FROM matches WHERE game_id = ? AND puuid = ?) AS durationQuality
  `)
  return verifiedRawLobbies(db).some(({ row }) => {
    const status = pending.get(
      row.gameId,
      row.puuid,
      GRADE_CORE_FACT_CONTRACT_VERSION,
      row.gameId,
      row.puuid,
    ) as { participantPending: number; durationQuality: string | null }
    return status.participantPending === 1 ||
      !["verified", "source_reported", "inconsistent"].includes(
        status.durationQuality ?? "",
      )
  })
}

/**
 * Re-establishes source-presence semantics only when Recall still has the
 * checksummed raw full-scoreboard payload and every core value agrees with the
 * normalized lobby. Old normalized zeroes alone are deliberately insufficient.
 */
export function backfillGradeCoreFactsFromRawPayloads(
  db: Database,
): GradeCoreBackfillResult {
  const lobbies = verifiedRawLobbies(db)
  const update = db.prepare(`
    UPDATE match_participants
    SET grade_core_complete = 1, grade_core_source = ?,
        grade_core_missing_fields_json = '[]',
        grade_core_contract_version = ?
    WHERE game_id = ? AND puuid = ? AND participant_id = ? AND (
      COALESCE(grade_core_complete, 0) <> 1 OR
      COALESCE(grade_core_contract_version, 0) <> ? OR
      COALESCE(grade_core_source, '') NOT IN ('league_client', 'match_v5') OR
      COALESCE(grade_core_missing_fields_json, '') <> '[]'
    )
  `)
  const updateDuration = db.prepare(`
    UPDATE matches SET duration_quality = CASE
      WHEN duration_quality IN ('verified', 'inconsistent') THEN duration_quality
      WHEN ? = 'verified' THEN 'verified'
      ELSE 'source_reported'
    END
    WHERE game_id = ? AND puuid = ?
  `)

  let verifiedParticipants = 0
  const transaction = db.transaction(() => {
    for (const { row, decoded } of lobbies) {
      for (const participant of decoded.facts) {
        const changes = update.run(
          row.source,
          GRADE_CORE_FACT_CONTRACT_VERSION,
          row.gameId,
          row.puuid,
          participant.participant_id,
          GRADE_CORE_FACT_CONTRACT_VERSION,
        ).changes
        if (changes > 1) throw new Error("grade_core_backfill_participant_write_failed")
        verifiedParticipants += changes
      }
      if (updateDuration.run(decoded.durationQuality, row.gameId, row.puuid).changes !== 1) {
        throw new Error("grade_core_backfill_duration_write_failed")
      }
    }
  })
  transaction()
  return { verifiedLobbies: lobbies.length, verifiedParticipants }
}
