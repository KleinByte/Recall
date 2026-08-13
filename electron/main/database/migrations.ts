import type { Database } from "better-sqlite3"
import {
  BOT_QUEUE_IDS,
  LEAGUE_CLASSIC_PVP_QUEUE_IDS,
} from "../matches/eligibility.js"
import { gzipJsonTextV1 } from "./json-body-codec.js"
import {
  TIMELINE_STORAGE_V32_AFTER,
  TIMELINE_STORAGE_V32_UP,
  migrateTimelineStorageV32,
  verifyTimelineStorageV32,
} from "./timeline-storage-migration.js"

export interface Migration {
  version: number
  up: string
  /** Synchronous data transform executed inside the migration transaction. */
  migrate?: (db: Database) => void
  /** Schema finalization executed after the data transform succeeds. */
  after?: string
  /** In-transaction invariant checks run before the schema version advances. */
  verify?: (db: Database) => void
  /**
   * SQLite treats dropping a referenced parent as a deferred DELETE even when
   * an equivalent parent is restored before commit. This opt-in disables FK
   * actions around the atomic rebuild; verify must still run foreign_key_check.
   */
  rebuildsReferencedTable?: boolean
}

interface LegacyLiveSnapshotBody {
  sourceRowId: number
  gameId: number
  puuid: string
  gameTimeMs: number
  capturedAt: number
  reason: string
  snapshotJson: string
}

interface LegacyGradeCalibrationBody {
  sourceRowId: number
  calibrationId: string
  calibrationHash: string
  referencePopulationJson: string
  sampleCount: number
  snapshotJson: string
  createdAt: number
}

function migrateCompressedSnapshotBodies(db: Database) {
  const insertLive = db.prepare(`
    INSERT INTO live_game_snapshots_v31
      (game_id, puuid, game_time_ms, captured_at, reason,
       has_active_player_stat_runes, snapshot_encoding,
       snapshot_uncompressed_bytes, snapshot_compressed_bytes,
       snapshot_sha256, snapshot_payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const readLive = db.prepare(`
    SELECT rowid AS sourceRowId, game_id AS gameId, puuid,
           game_time_ms AS gameTimeMs, captured_at AS capturedAt, reason,
           snapshot_json AS snapshotJson
    FROM live_game_snapshots
    WHERE rowid > ? ORDER BY rowid LIMIT 100
  `)
  let lastLiveRowId = 0
  while (true) {
    const rows = readLive.all(lastLiveRowId) as LegacyLiveSnapshotBody[]
    if (rows.length === 0) break
    for (const row of rows) {
      let encoded
      let hasActivePlayerStatRunes = 0
      try {
        encoded = gzipJsonTextV1(row.snapshotJson)
        const snapshot = JSON.parse(row.snapshotJson) as {
          activePlayer?: { runes?: { statRuneIds?: unknown } }
        }
        const statRuneIds = snapshot.activePlayer?.runes?.statRuneIds
        hasActivePlayerStatRunes = Array.isArray(statRuneIds) && statRuneIds.length > 0
          ? 1
          : 0
      } catch (error) {
        throw new Error(
          `live_game_snapshot_body_invalid:${row.gameId}:${row.puuid}:${row.gameTimeMs}`,
          { cause: error },
        )
      }
      insertLive.run(
        row.gameId,
        row.puuid,
        row.gameTimeMs,
        row.capturedAt,
        row.reason,
        hasActivePlayerStatRunes,
        encoded.encoding,
        encoded.uncompressedBytes,
        encoded.compressedBytes,
        encoded.sha256,
        encoded.payload,
      )
    }
    lastLiveRowId = rows.at(-1)!.sourceRowId
  }

  const insertCalibration = db.prepare(`
    INSERT INTO grade_calibration_snapshots_v31
      (calibration_id, calibration_hash, reference_population_json,
       sample_count, snapshot_encoding, snapshot_uncompressed_bytes,
       snapshot_compressed_bytes, snapshot_sha256, snapshot_payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const readCalibration = db.prepare(`
    SELECT rowid AS sourceRowId, calibration_id AS calibrationId,
           calibration_hash AS calibrationHash,
           reference_population_json AS referencePopulationJson,
           sample_count AS sampleCount, snapshot_json AS snapshotJson,
           created_at AS createdAt
    FROM grade_calibration_snapshots
    WHERE rowid > ? ORDER BY rowid LIMIT 1
  `)
  let lastCalibrationRowId = 0
  while (true) {
    const row = readCalibration.get(lastCalibrationRowId) as
      LegacyGradeCalibrationBody | undefined
    if (!row) break
    let encoded
    try {
      encoded = gzipJsonTextV1(row.snapshotJson)
    } catch (error) {
      throw new Error(`grade_calibration_snapshot_body_invalid:${row.calibrationId}`, {
        cause: error,
      })
    }
    insertCalibration.run(
      row.calibrationId,
      row.calibrationHash,
      row.referencePopulationJson,
      row.sampleCount,
      encoded.encoding,
      encoded.uncompressedBytes,
      encoded.compressedBytes,
      encoded.sha256,
      encoded.payload,
      row.createdAt,
    )
    lastCalibrationRowId = row.sourceRowId
  }

  const sourceLiveCount = Number((db.prepare(`
    SELECT COUNT(*) AS count FROM live_game_snapshots
  `).get() as { count: number }).count)
  const migratedLiveCount = Number((db.prepare(`
    SELECT COUNT(*) AS count FROM live_game_snapshots_v31
  `).get() as { count: number }).count)
  const sourceCalibrationCount = Number((db.prepare(`
    SELECT COUNT(*) AS count FROM grade_calibration_snapshots
  `).get() as { count: number }).count)
  const migratedCalibrationCount = Number((db.prepare(`
    SELECT COUNT(*) AS count FROM grade_calibration_snapshots_v31
  `).get() as { count: number }).count)
  if (sourceLiveCount !== migratedLiveCount ||
      sourceCalibrationCount !== migratedCalibrationCount) {
    throw new Error("snapshot_body_migration_row_count_mismatch")
  }
}

export const migrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE matches (
        game_id                  INTEGER NOT NULL,
        puuid                    TEXT    NOT NULL,
        queue_id                 INTEGER NOT NULL,
        game_mode                TEXT    NOT NULL,
        mode                     TEXT    NOT NULL,
        is_matched               INTEGER NOT NULL,
        played_at                INTEGER NOT NULL,
        duration_secs            INTEGER NOT NULL,
        game_version             TEXT    NOT NULL,
        champion_id              INTEGER NOT NULL,
        win                      INTEGER NOT NULL,
        kills                    INTEGER NOT NULL,
        deaths                   INTEGER NOT NULL,
        assists                  INTEGER NOT NULL,
        champ_level              INTEGER NOT NULL,
        gold_earned              INTEGER NOT NULL,
        damage_to_champions      INTEGER NOT NULL,
        damage_taken             INTEGER NOT NULL,
        damage_self_mitigated    INTEGER NOT NULL,
        total_heal               INTEGER NOT NULL,
        total_units_healed       INTEGER NOT NULL,
        time_ccing_others        INTEGER NOT NULL,
        largest_killing_spree    INTEGER NOT NULL,
        largest_multi_kill       INTEGER NOT NULL,
        double_kills             INTEGER NOT NULL,
        triple_kills             INTEGER NOT NULL,
        quadra_kills             INTEGER NOT NULL,
        penta_kills              INTEGER NOT NULL,
        total_minions_killed     INTEGER NOT NULL,
        vision_score             INTEGER NOT NULL,
        ended_in_surrender       INTEGER NOT NULL,
        ended_in_early_surrender INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid)
      );

      CREATE INDEX idx_matches_played   ON matches (puuid, played_at DESC);
      CREATE INDEX idx_matches_champion ON matches (puuid, champion_id);
    `,
  },
  {
    // Performance grade, derived by comparing the player against the other
    // nine participants of the same game.
    version: 2,
    up: `
      ALTER TABLE matches ADD COLUMN grade TEXT;
      ALTER TABLE matches ADD COLUMN grade_score REAL;
    `,
  },
  {
    // Multi-mode tracking. Additive so existing ARAM history survives: every
    // row recorded before this point was played on the Howling Abyss.
    version: 3,
    up: `
      ALTER TABLE matches ADD COLUMN mode_family       TEXT;
      ALTER TABLE matches ADD COLUMN is_ranked         INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE matches ADD COLUMN lane              TEXT;
      ALTER TABLE matches ADD COLUMN role              TEXT;
      ALTER TABLE matches ADD COLUMN neutral_minions   INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE matches ADD COLUMN wards_placed      INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE matches ADD COLUMN wards_killed      INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE matches ADD COLUMN control_wards     INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE matches ADD COLUMN damage_objectives INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE matches ADD COLUMN damage_turrets    INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE matches ADD COLUMN turret_kills      INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE matches ADD COLUMN inhibitor_kills   INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE matches ADD COLUMN first_blood       INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE matches ADD COLUMN cs_per_min        REAL;
      ALTER TABLE matches ADD COLUMN gold_per_min      REAL;

      UPDATE matches SET mode_family = 'aram' WHERE mode_family IS NULL;

      CREATE INDEX idx_matches_family
        ON matches (puuid, mode_family, played_at DESC);

      CREATE TABLE challenges (
        challenge_id      INTEGER NOT NULL,
        puuid             TEXT    NOT NULL,
        name              TEXT    NOT NULL,
        description       TEXT    NOT NULL,
        category          TEXT    NOT NULL,
        id_list_type      TEXT    NOT NULL,
        game_modes        TEXT    NOT NULL,
        current_level     TEXT    NOT NULL,
        next_level        TEXT,
        current_value     REAL    NOT NULL,
        current_threshold REAL,
        next_threshold    REAL,
        thresholds        TEXT    NOT NULL,
        percentile        REAL,
        points_awarded    INTEGER NOT NULL DEFAULT 0,
        is_capstone       INTEGER NOT NULL DEFAULT 0,
        is_apex           INTEGER NOT NULL DEFAULT 0,
        is_retired        INTEGER NOT NULL DEFAULT 0,
        parent_id         INTEGER,
        icon_path         TEXT,
        completed_ids     TEXT    NOT NULL,
        updated_at        INTEGER NOT NULL,
        PRIMARY KEY (challenge_id, puuid)
      );

      CREATE TABLE challenge_history (
        challenge_id  INTEGER NOT NULL,
        puuid         TEXT    NOT NULL,
        recorded_at   INTEGER NOT NULL,
        current_value REAL    NOT NULL,
        current_level TEXT    NOT NULL,
        PRIMARY KEY (challenge_id, puuid, recorded_at)
      );

      CREATE TABLE profile_snapshots (
        puuid         TEXT    NOT NULL,
        recorded_at   INTEGER NOT NULL,
        overall_level TEXT    NOT NULL,
        total_score   INTEGER NOT NULL,
        percentile    REAL,
        category_json TEXT    NOT NULL,
        PRIMARY KEY (puuid, recorded_at)
      );

      CREATE INDEX idx_challenges_cat ON challenges (puuid, category);
      CREATE INDEX idx_chal_hist_time ON challenge_history (puuid, recorded_at);
    `,
  },
  {
    // Version 3 added the per-minute rates but only filled them in for games
    // recorded afterwards, leaving every earlier game empty. Both are derived
    // from totals that have been stored since the first version, so they can
    // be worked out for the whole table.
    version: 4,
    up: `
      UPDATE matches
      SET cs_per_min   = (total_minions_killed + neutral_minions) * 60.0
                         / duration_secs,
          gold_per_min = gold_earned * 60.0 / duration_secs
      WHERE cs_per_min IS NULL AND duration_secs > 0;
    `,
  },
  {
    // The lobby behind each game, the ranked ladder over time, and goals the
    // player sets for themselves.
    //
    // Only statistics are kept for the other nine players — no names and no
    // PUUIDs. Comparing yourself against the people you played with needs
    // their numbers, never their identities.
    version: 5,
    up: `
      ALTER TABLE matches ADD COLUMN queue_name TEXT;

      CREATE TABLE match_participants (
        game_id               INTEGER NOT NULL,
        puuid                 TEXT    NOT NULL,
        participant_id        INTEGER NOT NULL,
        team_id               INTEGER NOT NULL,
        is_player             INTEGER NOT NULL,
        champion_id           INTEGER NOT NULL,
        win                   INTEGER NOT NULL,
        kills                 INTEGER NOT NULL,
        deaths                INTEGER NOT NULL,
        assists               INTEGER NOT NULL,
        gold_earned           INTEGER NOT NULL,
        damage_to_champions   INTEGER NOT NULL,
        damage_taken          INTEGER NOT NULL,
        damage_self_mitigated INTEGER NOT NULL,
        total_heal            INTEGER NOT NULL,
        time_ccing_others     INTEGER NOT NULL,
        total_minions_killed  INTEGER NOT NULL,
        neutral_minions       INTEGER NOT NULL,
        vision_score          INTEGER NOT NULL,
        damage_objectives     INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid, participant_id)
      );

      CREATE INDEX idx_participants_owner ON match_participants (puuid, game_id);

      CREATE TABLE ranked_snapshots (
        puuid         TEXT    NOT NULL,
        queue         TEXT    NOT NULL,
        recorded_at   INTEGER NOT NULL,
        tier          TEXT    NOT NULL,
        division      TEXT    NOT NULL,
        league_points INTEGER NOT NULL,
        wins          INTEGER NOT NULL,
        losses        INTEGER NOT NULL,
        PRIMARY KEY (puuid, queue, recorded_at)
      );

      CREATE INDEX idx_ranked_time ON ranked_snapshots (puuid, queue, recorded_at);

      CREATE TABLE goals (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        puuid        TEXT    NOT NULL,
        kind         TEXT    NOT NULL,
        target_key   TEXT    NOT NULL,
        target_value REAL    NOT NULL,
        label        TEXT    NOT NULL,
        created_at   INTEGER NOT NULL,
        achieved_at  INTEGER
      );

      CREATE INDEX idx_goals_owner ON goals (puuid, achieved_at);
    `,
  },
  {
    // Everything the client will tell us about a game.
    //
    // The earlier lobby table kept only the numbers needed to compare the
    // player against their game. This widens it to the whole scoreboard —
    // who was there, what they built, and what each team took — so a recorded
    // game can be read back in full long after it left the client.
    version: 6,
    up: `
      ALTER TABLE match_participants ADD COLUMN summoner_name TEXT;
      ALTER TABLE match_participants ADD COLUMN profile_icon  INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN spell1_id     INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN spell2_id     INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN item0 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN item1 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN item2 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN item3 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN item4 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN item5 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN item6 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN perk_primary_style INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN perk_sub_style     INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN perk0 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN perk1 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN perk2 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN perk3 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN perk4 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN perk5 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN champ_level   INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN gold_spent    INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN total_damage_dealt INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN magic_damage_to_champions    INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN physical_damage_to_champions INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN true_damage_to_champions     INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN largest_killing_spree INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN largest_multi_kill    INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN double_kills INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN triple_kills INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN quadra_kills INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN penta_kills  INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN wards_placed  INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN wards_killed  INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN control_wards INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN damage_turrets  INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN turret_kills    INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN inhibitor_kills INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN total_units_healed INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN total_heal_on_teammates INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN longest_time_living INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN first_blood INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN first_tower INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE match_participants ADD COLUMN lane TEXT;
      ALTER TABLE match_participants ADD COLUMN role TEXT;

      -- How completely a lobby was captured. Rows written before this version
      -- keep the default of 0 and are read again while the game is still
      -- inside the client's window.
      ALTER TABLE match_participants ADD COLUMN detail_version INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE match_teams (
        game_id         INTEGER NOT NULL,
        puuid           TEXT    NOT NULL,
        team_id         INTEGER NOT NULL,
        win             INTEGER NOT NULL,
        bans            TEXT    NOT NULL,
        baron_kills     INTEGER NOT NULL DEFAULT 0,
        dragon_kills    INTEGER NOT NULL DEFAULT 0,
        herald_kills    INTEGER NOT NULL DEFAULT 0,
        horde_kills     INTEGER NOT NULL DEFAULT 0,
        tower_kills     INTEGER NOT NULL DEFAULT 0,
        inhibitor_kills INTEGER NOT NULL DEFAULT 0,
        first_blood     INTEGER NOT NULL DEFAULT 0,
        first_tower     INTEGER NOT NULL DEFAULT 0,
        first_baron     INTEGER NOT NULL DEFAULT 0,
        first_dragon    INTEGER NOT NULL DEFAULT 0,
        first_inhibitor INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (game_id, puuid, team_id)
      );

      CREATE INDEX idx_teams_owner ON match_teams (puuid, game_id);
    `,
  },
  {
    // A match grade belongs to every player on the scoreboard, not only the
    // owner of the local history. Existing lobbies are refreshed while they
    // remain in the client's twenty-game window.
    version: 7,
    up: `
      ALTER TABLE match_participants ADD COLUMN grade TEXT;
      ALTER TABLE match_participants ADD COLUMN grade_score REAL;
    `,
  },
  {
    // A Match-V5 import can take hours under a personal key. Store its cursor
    // with the history so it survives restarts and cannot get ahead of a
    // restored database snapshot.
    version: 8,
    up: `
      CREATE TABLE riot_history_backfill (
        puuid             TEXT    NOT NULL,
        regional_route    TEXT    NOT NULL,
        end_time_seconds  INTEGER NOT NULL,
        next_offset       INTEGER NOT NULL DEFAULT 0,
        ids_scanned       INTEGER NOT NULL DEFAULT 0,
        matches_downloaded INTEGER NOT NULL DEFAULT 0,
        matches_imported  INTEGER NOT NULL DEFAULT 0,
        matches_skipped   INTEGER NOT NULL DEFAULT 0,
        status            TEXT    NOT NULL DEFAULT 'idle',
        last_error        TEXT,
        started_at        INTEGER,
        updated_at        INTEGER NOT NULL,
        completed_at      INTEGER,
        PRIMARY KEY (puuid, regional_route)
      );

      CREATE INDEX idx_riot_backfill_owner
        ON riot_history_backfill (puuid, updated_at DESC);
    `,
  },
  {
    // Personal review data. Everything is additive and account-scoped. Match
    // owned records use the same composite key as matches so restores and
    // account switches cannot leave detached review data behind.
    version: 9,
    up: `
      ALTER TABLE matches ADD COLUMN riot_match_id TEXT;

      CREATE UNIQUE INDEX idx_matches_riot_match_id
        ON matches (puuid, riot_match_id)
        WHERE riot_match_id IS NOT NULL;

      CREATE TABLE riot_accounts (
        puuid             TEXT    PRIMARY KEY,
        match_puuid       TEXT    NOT NULL,
        regional_route    TEXT    NOT NULL,
        platform_id       TEXT    NOT NULL,
        game_name         TEXT    NOT NULL DEFAULT '',
        tag_line          TEXT    NOT NULL DEFAULT '',
        resolved_at       INTEGER NOT NULL
      );

      CREATE TABLE sync_health (
        puuid             TEXT    NOT NULL,
        source            TEXT    NOT NULL,
        first_observed_at INTEGER NOT NULL,
        last_attempt_at   INTEGER,
        last_success_at   INTEGER,
        last_error_at     INTEGER,
        last_error        TEXT,
        items_seen        INTEGER NOT NULL DEFAULT 0,
        items_written     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (puuid, source)
      );

      CREATE TABLE match_grade_breakdowns (
        game_id              INTEGER NOT NULL,
        puuid                TEXT    NOT NULL,
        participant_id       INTEGER NOT NULL,
        algorithm_version    INTEGER NOT NULL,
        composite_percentile REAL    NOT NULL,
        components_json      TEXT    NOT NULL,
        created_at           INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid, participant_id, algorithm_version),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid)
          ON DELETE CASCADE
      );

      CREATE TABLE session_boundary_overrides (
        game_id    INTEGER NOT NULL,
        puuid      TEXT    NOT NULL,
        action     TEXT    NOT NULL CHECK (action IN ('split', 'join')),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid)
          ON DELETE CASCADE
      );

      CREATE TABLE match_timeline_cache (
        game_id       INTEGER NOT NULL,
        puuid         TEXT    NOT NULL,
        riot_match_id TEXT,
        status        TEXT    NOT NULL CHECK (
          status IN ('not_requested', 'pending', 'loading', 'ready', 'unavailable', 'error')
        ),
        mapper_version INTEGER NOT NULL DEFAULT 1,
        fetched_at     INTEGER,
        last_error     TEXT,
        data_json      TEXT,
        updated_at     INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid)
          ON DELETE CASCADE
      );

      CREATE TABLE match_annotations (
        game_id   INTEGER NOT NULL,
        puuid     TEXT    NOT NULL,
        note      TEXT    NOT NULL DEFAULT '',
        bookmarked INTEGER NOT NULL DEFAULT 0 CHECK (bookmarked IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid)
          ON DELETE CASCADE
      );

      CREATE TABLE annotation_tags (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        puuid           TEXT    NOT NULL,
        name            TEXT    NOT NULL,
        normalized_name TEXT    NOT NULL,
        color           TEXT    NOT NULL,
        created_at      INTEGER NOT NULL,
        UNIQUE (puuid, normalized_name)
      );

      CREATE TABLE match_annotation_tags (
        game_id INTEGER NOT NULL,
        puuid   TEXT    NOT NULL,
        tag_id  INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid, tag_id),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid)
          ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES annotation_tags (id)
          ON DELETE CASCADE
      );

      CREATE TABLE practice_experiments (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        puuid        TEXT    NOT NULL,
        name         TEXT    NOT NULL,
        hypothesis   TEXT    NOT NULL DEFAULT '',
        champion_ids TEXT    NOT NULL DEFAULT '[]',
        modes        TEXT    NOT NULL DEFAULT '[]',
        status       TEXT    NOT NULL CHECK (status IN ('active', 'paused', 'completed')),
        started_at   INTEGER NOT NULL,
        ended_at     INTEGER,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );

      CREATE TABLE match_experiments (
        game_id      INTEGER NOT NULL,
        puuid        TEXT    NOT NULL,
        experiment_id INTEGER NOT NULL,
        outcome      TEXT    NOT NULL DEFAULT 'unrated' CHECK (
          outcome IN ('worked', 'mixed', 'did_not_work', 'unrated')
        ),
        outcome_note TEXT    NOT NULL DEFAULT '',
        attached_at  INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid, experiment_id),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid)
          ON DELETE CASCADE,
        FOREIGN KEY (experiment_id) REFERENCES practice_experiments (id)
          ON DELETE CASCADE
      );

      CREATE INDEX idx_sync_health_owner
        ON sync_health (puuid, last_attempt_at DESC);
      CREATE INDEX idx_grade_breakdowns_match
        ON match_grade_breakdowns (puuid, game_id);
      CREATE INDEX idx_timeline_status
        ON match_timeline_cache (puuid, status, updated_at);
      CREATE INDEX idx_annotations_bookmarked
        ON match_annotations (puuid, bookmarked, updated_at DESC);
      CREATE INDEX idx_annotation_tags_owner
        ON annotation_tags (puuid, name);
      CREATE INDEX idx_experiments_owner
        ON practice_experiments (puuid, status, started_at DESC);
      CREATE INDEX idx_match_experiments_owner
        ON match_experiments (puuid, experiment_id, attached_at);
    `,
  },
  {
    // Keep the durable coverage boundary separate from an in-flight rolling
    // refresh. A crash can resume the same overlap window without claiming
    // that newer history is complete.
    version: 10,
    up: `
      ALTER TABLE riot_history_backfill ADD COLUMN start_time_seconds INTEGER;
      ALTER TABLE riot_history_backfill ADD COLUMN coverage_through_seconds INTEGER;
      UPDATE riot_history_backfill
      SET coverage_through_seconds = end_time_seconds
      WHERE status = 'complete';
    `,
  },
  {
    // Match-fidelity v2. Augment selections are normalized so every
    // participant can be rendered faithfully without creating cross-match
    // profiles for teammates or opponents. The capture manifest makes schema
    // drift and incomplete historical rows visible instead of silently
    // discarding newly-added Riot fields.
    version: 11,
    up: `
      ALTER TABLE match_participants
        ADD COLUMN extended_metrics_json TEXT NOT NULL DEFAULT '{}';

      CREATE TABLE participant_augments (
        game_id           INTEGER NOT NULL,
        puuid             TEXT    NOT NULL,
        participant_id    INTEGER NOT NULL,
        slot              INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 6),
        augment_id        INTEGER NOT NULL,
        selected_at_ms    INTEGER,
        source            TEXT    NOT NULL CHECK (
          source IN ('league_client', 'match_v5', 'timeline')
        ),
        name_snapshot     TEXT,
        rarity_snapshot   TEXT,
        icon_path_snapshot TEXT,
        capture_version   INTEGER NOT NULL,
        captured_at       INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid, participant_id, slot),
        FOREIGN KEY (game_id, puuid, participant_id)
          REFERENCES match_participants (game_id, puuid, participant_id)
          ON DELETE CASCADE
      );

      CREATE TABLE augment_catalog (
        augment_id    INTEGER NOT NULL,
        data_version  TEXT    NOT NULL,
        name          TEXT    NOT NULL,
        internal_name TEXT,
        rarity        TEXT,
        icon_path     TEXT,
        source        TEXT    NOT NULL,
        fetched_at    INTEGER NOT NULL,
        PRIMARY KEY (augment_id, data_version)
      );

      CREATE TABLE match_capture_manifests (
        game_id                 INTEGER NOT NULL,
        puuid                   TEXT    NOT NULL,
        source                  TEXT    NOT NULL,
        match_mapper_version    INTEGER NOT NULL,
        participant_mapper_version INTEGER NOT NULL,
        participant_count       INTEGER NOT NULL,
        team_count              INTEGER NOT NULL,
        augment_participant_count INTEGER NOT NULL,
        captured_categories_json TEXT NOT NULL,
        missing_categories_json  TEXT NOT NULL,
        unknown_field_names_json TEXT NOT NULL,
        captured_at             INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid)
          ON DELETE CASCADE
      );

      CREATE TABLE augment_enrichment_jobs (
        puuid            TEXT PRIMARY KEY,
        status           TEXT NOT NULL CHECK (
          status IN ('idle', 'running', 'paused', 'complete', 'error')
        ),
        last_played_at   INTEGER,
        scanned          INTEGER NOT NULL DEFAULT 0,
        enriched         INTEGER NOT NULL DEFAULT 0,
        unavailable      INTEGER NOT NULL DEFAULT 0,
        last_error       TEXT,
        updated_at       INTEGER NOT NULL
      );

      CREATE INDEX idx_participant_augments_owner
        ON participant_augments (puuid, augment_id, game_id);
      CREATE INDEX idx_capture_missing_augments
        ON match_capture_manifests (puuid, augment_participant_count, captured_at);
    `,
  },
  {
    // Riot reports Co-op vs. AI and tutorial queues as MATCHED_GAME. Older
    // versions treated that value as sufficient for statistics, so mark
    // existing bot rows as ineligible without deleting the stored history.
    version: 12,
    up: `
      UPDATE matches
      SET is_matched = 0
      WHERE queue_id IN (${BOT_QUEUE_IDS.join(", ")})
         OR LOWER(COALESCE(queue_name, '')) LIKE '% bot%'
         OR LOWER(COALESCE(queue_name, '')) LIKE 'bot%'
         OR LOWER(COALESCE(queue_name, '')) LIKE '%bots%'
         OR LOWER(COALESCE(queue_name, '')) LIKE '%co-op vs%'
         OR LOWER(COALESCE(queue_name, '')) LIKE '%coop vs%'
         OR LOWER(COALESCE(queue_name, '')) LIKE '%tutorial%';
    `,
  },
  {
    // Auto-awarded post-game labels are deliberately separate from the
    // player's free-form review tags. Each evaluation records the algorithm
    // version even when no label was earned, so an empty result is durable
    // and can be recomputed when the definitions change.
    version: 13,
    up: `
      CREATE TABLE IF NOT EXISTS match_label_evaluations (
        game_id            INTEGER NOT NULL,
        puuid              TEXT    NOT NULL,
        evaluator_version  INTEGER NOT NULL,
        source             TEXT    NOT NULL CHECK (source IN ('match_v5', 'timeline')),
        status             TEXT    NOT NULL CHECK (status IN ('ready', 'unavailable')),
        evaluated_at       INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS match_performance_labels (
        game_id           INTEGER NOT NULL,
        puuid             TEXT    NOT NULL,
        label_id          TEXT    NOT NULL,
        name              TEXT    NOT NULL,
        category          TEXT    NOT NULL,
        polarity          TEXT    NOT NULL CHECK (polarity IN ('positive', 'negative', 'mixed')),
        tooltip           TEXT    NOT NULL,
        evidence_json     TEXT    NOT NULL,
        source            TEXT    NOT NULL CHECK (source IN ('match_v5', 'timeline')),
        confidence        TEXT    NOT NULL CHECK (confidence IN ('exact', 'strong', 'inferred')),
        priority          REAL    NOT NULL,
        evaluator_version INTEGER NOT NULL,
        created_at        INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid, label_id),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_performance_labels_match
        ON match_performance_labels (puuid, game_id, priority DESC);
    `,
  },
  {
    // Keep the authenticated local-client response beside the compact model.
    // The LCU schema is unsupported and changes over time; retaining the raw
    // payload lets a later mapper recover newly-understood fields without
    // requiring the match to remain in the client's rolling history window.
    version: 14,
    up: `
      ALTER TABLE match_timeline_cache ADD COLUMN raw_json TEXT;
    `,
  },
  {
    // Port 2999 disappears after a match. Keep bounded periodic snapshots and
    // deduplicated live events while the game is running so post-game mapping
    // can recover item and level timing the LCU timeline often omits.
    version: 15,
    up: `
      CREATE TABLE live_game_snapshots (
        game_id       INTEGER NOT NULL,
        puuid         TEXT    NOT NULL,
        game_time_ms  INTEGER NOT NULL,
        captured_at   INTEGER NOT NULL,
        reason        TEXT    NOT NULL CHECK (reason IN ('first', 'periodic', 'state_change')),
        snapshot_json TEXT    NOT NULL,
        PRIMARY KEY (game_id, puuid, game_time_ms)
      );

      CREATE TABLE live_game_events (
        game_id       INTEGER NOT NULL,
        puuid         TEXT    NOT NULL,
        event_id      INTEGER NOT NULL,
        event_time_ms INTEGER NOT NULL,
        event_name    TEXT    NOT NULL,
        captured_at   INTEGER NOT NULL,
        event_json    TEXT    NOT NULL,
        PRIMARY KEY (game_id, puuid, event_id)
      );

      CREATE INDEX idx_live_snapshots_owner
        ON live_game_snapshots (puuid, game_id, game_time_ms);
      CREATE INDEX idx_live_events_owner
        ON live_game_events (puuid, game_id, event_time_ms);
    `,
  },
  {
    // Riot classifies lane and role after the fact, so swaps and off-meta
    // setups are sometimes misread. Champion select states the position the
    // client actually assigned, but only for the local team and only while it
    // is on screen, so it is captured then and kept against the game id.
    version: 16,
    up: `
      ALTER TABLE match_participants ADD COLUMN assigned_position TEXT;

      CREATE TABLE champ_select_positions (
        game_id     INTEGER NOT NULL,
        puuid       TEXT    NOT NULL,
        champion_id INTEGER NOT NULL,
        position    TEXT    NOT NULL,
        captured_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid, champion_id)
      );
    `,
  },
  {
    // League Classic moved from the legacy 710 identifier to Riot's Jade
    // queue group. Reclassify already-captured PvP rows into their own family
    // so they receive isolated filters, records, grades and RVI profiles.
    version: 17,
    up: `
      UPDATE matches
      SET mode = 'league_classic',
          mode_family = 'classic',
          is_ranked = 0,
          queue_name = 'League Classic'
      WHERE queue_id IN (${LEAGUE_CLASSIC_PVP_QUEUE_IDS.join(", ")})
         OR UPPER(COALESCE(game_mode, '')) = 'JADE'
         OR LOWER(COALESCE(queue_name, '')) LIKE '%league classic%'
         OR LOWER(COALESCE(queue_name, '')) LIKE '%5v5 jade%';

      UPDATE matches
      SET is_matched = 0
      WHERE queue_id IN (4320, 4321);
    `,
  },
  {
    // Keep the participant identity needed for player-scoped LCU resources,
    // and cache the small mastery projection shown in match reviews. The
    // owner key keeps cached data scoped to the account whose history caused
    // it to be read and lets "delete all history" remove it completely.
    version: 18,
    up: `
      ALTER TABLE match_participants ADD COLUMN participant_puuid TEXT;

      UPDATE match_participants
      SET participant_puuid = puuid
      WHERE is_player = 1;

      CREATE INDEX idx_participants_identity
        ON match_participants (participant_puuid, champion_id);

      CREATE TABLE champion_mastery_cache (
        owner_puuid                       TEXT    NOT NULL,
        participant_puuid                 TEXT    NOT NULL,
        champion_id                       INTEGER NOT NULL,
        champion_level                    INTEGER NOT NULL,
        champion_points                   INTEGER NOT NULL,
        champion_points_since_last_level  INTEGER NOT NULL,
        champion_points_until_next_level  INTEGER NOT NULL,
        tokens_earned                     INTEGER NOT NULL,
        highest_grade                     TEXT,
        updated_at                        INTEGER NOT NULL,
        PRIMARY KEY (owner_puuid, participant_puuid, champion_id)
      );

      CREATE INDEX idx_mastery_owner
        ON champion_mastery_cache (owner_puuid, updated_at);
    `,
  },
  {
    // Preserve full rune pages and the per-rune end-of-game counters supplied
    // by Match-V5/LCU without widening the participant table for every slot.
    version: 19,
    up: `
      ALTER TABLE match_participants ADD COLUMN rune_selections_json TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 20,
    up: `
      ALTER TABLE matches ADD COLUMN grade_algorithm_version INTEGER;
      ALTER TABLE matches ADD COLUMN grade_status TEXT;
      ALTER TABLE matches ADD COLUMN grade_composite_percentile REAL;
      ALTER TABLE matches ADD COLUMN game_end_timestamp INTEGER;
      ALTER TABLE matches ADD COLUMN map_id INTEGER;
      ALTER TABLE matches ADD COLUMN game_type TEXT;
      ALTER TABLE matches ADD COLUMN end_of_game_result TEXT;
      ALTER TABLE matches ADD COLUMN owner_eligible_for_progression INTEGER;
      ALTER TABLE matches ADD COLUMN duration_quality TEXT;
      ALTER TABLE matches ADD COLUMN resolved_position TEXT;
      ALTER TABLE matches ADD COLUMN position_resolver_version INTEGER;

      ALTER TABLE match_participants ADD COLUMN eligible_for_progression INTEGER;
      ALTER TABLE match_participants ADD COLUMN time_played_secs INTEGER;
      ALTER TABLE match_participants ADD COLUMN control_wards_purchased INTEGER;
      ALTER TABLE match_participants ADD COLUMN detector_wards_placed INTEGER;
      ALTER TABLE match_participants ADD COLUMN total_heals_on_teammates INTEGER;
      ALTER TABLE match_participants ADD COLUMN total_damage_shielded_on_teammates INTEGER;
      ALTER TABLE match_participants ADD COLUMN damage_dealt_to_buildings INTEGER;
      ALTER TABLE match_participants ADD COLUMN grade_algorithm_version INTEGER;
      ALTER TABLE match_participants ADD COLUMN grade_status TEXT;
      ALTER TABLE match_participants ADD COLUMN grade_composite_percentile REAL;
      ALTER TABLE match_participants ADD COLUMN lcu_lane TEXT;
      ALTER TABLE match_participants ADD COLUMN lcu_role TEXT;
      ALTER TABLE match_participants ADD COLUMN match_v5_team_position TEXT;
      ALTER TABLE match_participants ADD COLUMN match_v5_individual_position TEXT;
      ALTER TABLE match_participants ADD COLUMN resolved_position TEXT;
      ALTER TABLE match_participants ADD COLUMN position_resolver_version INTEGER;

      UPDATE match_participants
      SET control_wards_purchased = control_wards
      WHERE control_wards_purchased IS NULL;

      CREATE TABLE match_grade_attempts (
        game_id INTEGER NOT NULL, puuid TEXT NOT NULL,
        algorithm_version INTEGER NOT NULL, owner_participant_id INTEGER,
        grade_status TEXT NOT NULL CHECK (grade_status IN (
          'ready','unsupported_mode','short_game','invalid_duration','incomplete_lobby',
          'missing_core_metric','missing_source_fact','terminated',
          'ineligible_for_progression','unmatched','bot_or_tutorial','legacy_unknown')),
        input_fingerprint TEXT NOT NULL CHECK (length(input_fingerprint) = 64),
        attempted_at INTEGER NOT NULL,
        CHECK (grade_status <> 'ready' OR owner_participant_id IS NOT NULL),
        PRIMARY KEY (game_id, puuid, algorithm_version),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid) ON DELETE CASCADE,
        FOREIGN KEY (game_id, puuid, owner_participant_id)
          REFERENCES match_participants (game_id, puuid, participant_id) ON DELETE CASCADE
      );

      CREATE TABLE match_grade_results (
        game_id INTEGER NOT NULL, puuid TEXT NOT NULL, participant_id INTEGER NOT NULL,
        algorithm_version INTEGER NOT NULL,
        grade TEXT NOT NULL CHECK (grade IN (
          'S+','S','S-','A+','A','A-','B+','B','B-','C+','C','C-','D')),
        grade_score REAL NOT NULL CHECK (grade_score BETWEEN -4 AND 4),
        composite_percentile REAL NOT NULL CHECK (composite_percentile BETWEEN 0 AND 1),
        grade_status TEXT NOT NULL CHECK (grade_status = 'ready'),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid, participant_id, algorithm_version),
        FOREIGN KEY (game_id, puuid, algorithm_version)
          REFERENCES match_grade_attempts (game_id, puuid, algorithm_version) ON DELETE CASCADE,
        FOREIGN KEY (game_id, puuid, participant_id)
          REFERENCES match_participants (game_id, puuid, participant_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_grade_results_owner_version
        ON match_grade_results (puuid, algorithm_version, game_id);

      CREATE TABLE match_grade_breakdown_versions (
        game_id INTEGER NOT NULL, puuid TEXT NOT NULL, participant_id INTEGER NOT NULL,
        algorithm_version INTEGER NOT NULL,
        composite_percentile REAL NOT NULL CHECK (composite_percentile BETWEEN 0 AND 1),
        components_json TEXT NOT NULL CHECK (json_valid(components_json)),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid, participant_id, algorithm_version),
        FOREIGN KEY (game_id, puuid, participant_id, algorithm_version)
          REFERENCES match_grade_results (game_id, puuid, participant_id, algorithm_version)
          ON DELETE CASCADE
      );

      CREATE TABLE match_label_evaluation_versions (
        game_id INTEGER NOT NULL, puuid TEXT NOT NULL, evaluator_version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ready','unavailable','ineligible','stale')),
        status_reason TEXT,
        input_sources_json TEXT NOT NULL CHECK (json_valid(input_sources_json)),
        input_fingerprint TEXT NOT NULL CHECK (length(input_fingerprint) = 64),
        evaluated_at INTEGER NOT NULL,
        CHECK ((status = 'ready' AND status_reason IS NULL)
          OR (status <> 'ready' AND status_reason IS NOT NULL)),
        PRIMARY KEY (game_id, puuid, evaluator_version),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid) ON DELETE CASCADE
      );

      CREATE TABLE match_performance_label_versions (
        game_id INTEGER NOT NULL, puuid TEXT NOT NULL, label_id TEXT NOT NULL,
        evaluator_version INTEGER NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
        polarity TEXT NOT NULL CHECK (polarity IN ('positive','negative','mixed')),
        tooltip TEXT NOT NULL,
        evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
        evidence_sources_json TEXT NOT NULL CHECK (json_valid(evidence_sources_json)),
        confidence TEXT NOT NULL CHECK (confidence IN ('exact','strong','inferred')),
        priority REAL NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, puuid, label_id, evaluator_version),
        FOREIGN KEY (game_id, puuid, evaluator_version)
          REFERENCES match_label_evaluation_versions (game_id, puuid, evaluator_version)
          ON DELETE CASCADE
      );
      CREATE INDEX idx_label_versions_match ON match_performance_label_versions
        (puuid, evaluator_version, game_id, priority DESC);
    `,
  },
  {
    version: 21,
    up: `
      CREATE TABLE match_source_payloads (
        owner_puuid TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('league_client','match_v5')),
        source_match_id TEXT NOT NULL, game_id INTEGER,
        kind TEXT NOT NULL CHECK (
          (source = 'league_client' AND kind IN (
            'history_page','history_summary','scoreboard_detail','champ_select','timeline'))
          OR (source = 'match_v5' AND kind IN ('match_detail','timeline'))),
        encoding TEXT NOT NULL CHECK (encoding = 'gzip_json_v1'),
        payload BLOB NOT NULL, sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        data_version TEXT, mapper_version INTEGER NOT NULL,
        serialization_version INTEGER NOT NULL CHECK (serialization_version = 1),
        mapping_status TEXT NOT NULL CHECK (mapping_status IN ('pending','mapped','unmappable','error')),
        mapping_error TEXT, mapped_at INTEGER, fetched_at INTEGER NOT NULL,
        CHECK ((mapping_status = 'pending' AND mapping_error IS NULL AND mapped_at IS NULL)
          OR (mapping_status = 'mapped' AND (game_id IS NOT NULL OR kind = 'history_page')
            AND mapping_error IS NULL AND mapped_at IS NOT NULL)
          OR (mapping_status IN ('unmappable','error')
            AND mapping_error IS NOT NULL AND mapped_at IS NOT NULL)),
        PRIMARY KEY (owner_puuid, source, source_match_id, kind, sha256)
      );
      CREATE INDEX idx_source_payload_game
        ON match_source_payloads (owner_puuid, game_id, source, kind);

      CREATE TABLE match_source_captures (
        game_id INTEGER NOT NULL, puuid TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('league_client','match_v5')),
        capture_status TEXT NOT NULL CHECK (capture_status IN ('ready','partial')),
        manifest_version INTEGER NOT NULL, match_mapper_version INTEGER,
        participant_mapper_version INTEGER, champ_select_mapper_version INTEGER,
        timeline_mapper_version INTEGER, participant_count INTEGER NOT NULL,
        team_count INTEGER NOT NULL, applicable_json TEXT NOT NULL,
        captured_json TEXT NOT NULL, partial_json TEXT NOT NULL,
        unavailable_json TEXT NOT NULL, invalid_json TEXT NOT NULL,
        not_applicable_json TEXT NOT NULL, intentionally_ignored_json TEXT NOT NULL,
        unknown_json TEXT NOT NULL, unknown_fields_json TEXT NOT NULL,
        conflicts_json TEXT NOT NULL, captured_at INTEGER NOT NULL,
        CHECK (json_valid(applicable_json) AND json_valid(captured_json)
          AND json_valid(partial_json) AND json_valid(unavailable_json)
          AND json_valid(invalid_json) AND json_valid(not_applicable_json)
          AND json_valid(intentionally_ignored_json) AND json_valid(unknown_json)
          AND json_valid(unknown_fields_json) AND json_valid(conflicts_json)),
        PRIMARY KEY (game_id, puuid, source),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid) ON DELETE CASCADE
      );

      CREATE TABLE match_source_capture_payloads (
        game_id INTEGER NOT NULL, puuid TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('league_client','match_v5')),
        source_match_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN (
          'history_summary','scoreboard_detail','champ_select','match_detail','timeline')),
        sha256 TEXT NOT NULL,
        PRIMARY KEY (game_id, puuid, source, kind),
        FOREIGN KEY (game_id, puuid, source)
          REFERENCES match_source_captures (game_id, puuid, source) ON DELETE CASCADE,
        FOREIGN KEY (puuid, source, source_match_id, kind, sha256)
          REFERENCES match_source_payloads (owner_puuid, source, source_match_id, kind, sha256)
      );

      CREATE TABLE match_timeline_sources (
        game_id INTEGER NOT NULL, puuid TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('league_client','match_v5','live_capture')),
        source_match_id TEXT, mapper_version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ready','partial','unavailable')),
        data_json TEXT, data_sha256 TEXT, event_categories_json TEXT NOT NULL,
        evidence_counts_json TEXT NOT NULL, source_payload_sha256 TEXT,
        captured_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        CHECK (json_valid(event_categories_json) AND json_valid(evidence_counts_json)
          AND (data_json IS NULL OR json_valid(data_json))),
        CHECK (data_sha256 IS NULL OR length(data_sha256) = 64),
        CHECK (source_payload_sha256 IS NULL OR length(source_payload_sha256) = 64),
        CHECK (status <> 'ready' OR (data_json IS NOT NULL AND data_sha256 IS NOT NULL)),
        PRIMARY KEY (game_id, puuid, source, mapper_version),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid) ON DELETE CASCADE
      );
      CREATE INDEX idx_timeline_sources_current
        ON match_timeline_sources (puuid, game_id, source, mapper_version, status);
    `,
  },
  {
    version: 22,
    up: `
      CREATE TABLE riot_history_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, puuid TEXT NOT NULL,
        match_puuid TEXT NOT NULL, platform_route TEXT NOT NULL,
        regional_route TEXT NOT NULL, start_time_seconds INTEGER,
        end_time_seconds INTEGER NOT NULL, next_offset INTEGER NOT NULL DEFAULT 0,
        requested_detail INTEGER NOT NULL CHECK (requested_detail = 1),
        requested_timeline INTEGER NOT NULL CHECK (requested_timeline IN (0,1)),
        identity_source TEXT NOT NULL CHECK (identity_source IN ('cache','league_client')),
        discovery_attempts INTEGER NOT NULL DEFAULT 0,
        discovery_transient_failures INTEGER NOT NULL DEFAULT 0,
        discovery_next_retry_at INTEGER, discovery_http_status INTEGER,
        discovery_status TEXT NOT NULL CHECK (discovery_status IN (
          'not_requested','pending','running','waiting_retry','paused_key_expired',
          'paused_offline','paused_user','complete','complete_with_unresolved',
          'cancelled','error')),
        detail_status TEXT NOT NULL CHECK (detail_status IN (
          'not_requested','pending','running','waiting_retry','paused_key_expired',
          'paused_offline','paused_user','complete','complete_with_unresolved',
          'cancelled','error')),
        timeline_status TEXT NOT NULL CHECK (timeline_status IN (
          'not_requested','pending','running','waiting_retry','paused_key_expired',
          'paused_offline','paused_user','complete','complete_with_unresolved',
          'cancelled','error')),
        stop_reason TEXT, last_error TEXT, started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, completed_at INTEGER, terminal_summary_sha256 TEXT,
        CHECK (terminal_summary_sha256 IS NULL OR length(terminal_summary_sha256) = 64),
        UNIQUE (id, puuid)
      );
      CREATE INDEX idx_riot_history_runs_owner ON riot_history_runs (puuid, updated_at DESC);

      CREATE TABLE riot_match_ingestion (
        puuid TEXT NOT NULL, regional_route TEXT NOT NULL, riot_match_id TEXT NOT NULL,
        game_id INTEGER, first_discovered_at INTEGER NOT NULL,
        last_discovered_at INTEGER NOT NULL,
        detail_status TEXT NOT NULL CHECK (detail_status IN (
          'pending','ready','retryable','deferred','unmappable','ineligible','error')),
        detail_attempts INTEGER NOT NULL DEFAULT 0,
        detail_transient_failures INTEGER NOT NULL DEFAULT 0,
        detail_not_found_count INTEGER NOT NULL DEFAULT 0,
        detail_next_retry_at INTEGER, detail_http_status INTEGER,
        detail_last_error TEXT, detail_mapper_version INTEGER, detail_fetched_at INTEGER,
        timeline_status TEXT NOT NULL CHECK (timeline_status IN (
          'not_requested','pending','ready','retryable','deferred','unmappable','ineligible','error')),
        timeline_attempts INTEGER NOT NULL DEFAULT 0,
        timeline_transient_failures INTEGER NOT NULL DEFAULT 0,
        timeline_not_found_count INTEGER NOT NULL DEFAULT 0,
        timeline_next_retry_at INTEGER, timeline_http_status INTEGER,
        timeline_last_error TEXT, timeline_mapper_version INTEGER, timeline_fetched_at INTEGER,
        eligibility_reason TEXT, updated_at INTEGER NOT NULL,
        PRIMARY KEY (puuid, riot_match_id)
      );
      CREATE INDEX idx_riot_ingestion_detail_work
        ON riot_match_ingestion (puuid, detail_status, detail_next_retry_at);
      CREATE INDEX idx_riot_ingestion_timeline_work
        ON riot_match_ingestion (puuid, timeline_status, timeline_next_retry_at);

      CREATE TABLE riot_history_run_matches (
        run_id INTEGER NOT NULL, puuid TEXT NOT NULL, riot_match_id TEXT NOT NULL,
        list_offset INTEGER NOT NULL, discovered_at INTEGER NOT NULL,
        detail_disposition TEXT NOT NULL DEFAULT 'active'
          CHECK (detail_disposition IN ('active','waived')),
        detail_waived_reason TEXT, detail_waived_at INTEGER,
        timeline_disposition TEXT NOT NULL
          CHECK (timeline_disposition IN ('active','not_requested','waived')),
        timeline_waived_reason TEXT, timeline_waived_at INTEGER,
        detail_terminal_outcome TEXT CHECK (detail_terminal_outcome IS NULL OR
          detail_terminal_outcome IN ('ready','ineligible','unmappable','error','waived')),
        detail_terminal_reason TEXT, detail_terminal_at INTEGER,
        timeline_terminal_outcome TEXT CHECK (timeline_terminal_outcome IS NULL OR
          timeline_terminal_outcome IN ('ready','ineligible','unmappable','error','waived','not_requested')),
        timeline_terminal_reason TEXT, timeline_terminal_at INTEGER,
        CHECK ((detail_disposition = 'waived' AND detail_waived_reason IS NOT NULL AND detail_waived_at IS NOT NULL)
          OR (detail_disposition = 'active' AND detail_waived_reason IS NULL AND detail_waived_at IS NULL)),
        CHECK ((timeline_disposition = 'waived' AND timeline_waived_reason IS NOT NULL AND timeline_waived_at IS NOT NULL)
          OR (timeline_disposition IN ('active','not_requested') AND timeline_waived_reason IS NULL AND timeline_waived_at IS NULL)),
        CHECK ((detail_terminal_outcome IS NULL AND detail_terminal_reason IS NULL AND detail_terminal_at IS NULL)
          OR (detail_terminal_outcome IS NOT NULL AND detail_terminal_at IS NOT NULL)),
        CHECK ((timeline_terminal_outcome IS NULL AND timeline_terminal_reason IS NULL AND timeline_terminal_at IS NULL)
          OR (timeline_terminal_outcome IS NOT NULL AND timeline_terminal_at IS NOT NULL)),
        CHECK (detail_terminal_outcome <> 'waived' OR detail_disposition = 'waived'),
        CHECK (timeline_terminal_outcome <> 'waived' OR timeline_disposition = 'waived'),
        CHECK (detail_disposition <> 'waived' OR detail_terminal_outcome IS NULL OR detail_terminal_outcome = 'waived'),
        CHECK (timeline_disposition <> 'waived' OR timeline_terminal_outcome IS NULL OR timeline_terminal_outcome = 'waived'),
        CHECK (timeline_disposition <> 'not_requested' OR timeline_terminal_outcome IS NULL OR timeline_terminal_outcome = 'not_requested'),
        CHECK (detail_terminal_outcome IS NULL OR
          (detail_terminal_outcome = 'ready' AND detail_terminal_reason IS NULL) OR
          (detail_terminal_outcome IN ('ineligible','unmappable','error','waived') AND detail_terminal_reason IS NOT NULL)),
        CHECK (timeline_terminal_outcome IS NULL OR
          (timeline_terminal_outcome IN ('ready','not_requested') AND timeline_terminal_reason IS NULL) OR
          (timeline_terminal_outcome IN ('ineligible','unmappable','error','waived') AND timeline_terminal_reason IS NOT NULL)),
        PRIMARY KEY (run_id, puuid, riot_match_id),
        FOREIGN KEY (run_id, puuid) REFERENCES riot_history_runs (id, puuid) ON DELETE CASCADE,
        FOREIGN KEY (puuid, riot_match_id) REFERENCES riot_match_ingestion (puuid, riot_match_id)
      );
      CREATE INDEX idx_riot_run_matches_offset
        ON riot_history_run_matches (run_id, list_offset, riot_match_id);

      CREATE TABLE history_remediation_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, puuid TEXT NOT NULL,
        source_policy TEXT NOT NULL CHECK (source_policy IN ('local_only','explicit_match_v5')),
        status TEXT NOT NULL CHECK (status IN (
          'pending','running','paused','complete','complete_with_unresolved','cancelled','error')),
        stage TEXT NOT NULL CHECK (stage IN (
          'preflight','remap','optional_history','source_facts','participants',
          'grade','labels','invalidate_queries','verify')),
        target_grade_version INTEGER NOT NULL, target_label_version INTEGER NOT NULL,
        target_rvi_version INTEGER NOT NULL, target_report_version INTEGER NOT NULL,
        starting_versions_json TEXT NOT NULL, optional_history_run_id INTEGER,
        last_game_id INTEGER, last_game_puuid TEXT,
        processed_count INTEGER NOT NULL DEFAULT 0, changed_count INTEGER NOT NULL DEFAULT 0,
        unresolved_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0,
        backup_path TEXT, backup_sha256 TEXT, last_error TEXT, terminal_reason TEXT,
        started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
        UNIQUE (id, puuid),
        FOREIGN KEY (optional_history_run_id, puuid) REFERENCES riot_history_runs (id, puuid)
      );
      CREATE INDEX idx_history_remediation_owner
        ON history_remediation_runs (puuid, updated_at DESC);

      CREATE TABLE match_enrichment_jobs (
        game_id INTEGER NOT NULL, puuid TEXT NOT NULL, remediation_run_id INTEGER,
        kind TEXT NOT NULL CHECK (kind IN (
          'remap_lcu_detail','remap_lcu_timeline','fetch_v5_detail','fetch_v5_timeline',
          'repair_source_facts','repair_participants','regrade','relabel')),
        desired_version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'pending','running','paused','retryable','complete','unavailable','error')),
        attempts INTEGER NOT NULL DEFAULT 0, next_retry_at INTEGER, last_error TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
        PRIMARY KEY (game_id, puuid, kind),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid) ON DELETE CASCADE,
        FOREIGN KEY (remediation_run_id, puuid) REFERENCES history_remediation_runs (id, puuid)
      );
    `,
  },
  {
    version: 23,
    up: `
      CREATE TABLE live_capture_compactions (
        game_id INTEGER NOT NULL, puuid TEXT NOT NULL,
        compact_source TEXT NOT NULL DEFAULT 'live_capture' CHECK (compact_source = 'live_capture'),
        mapper_version INTEGER NOT NULL, compaction_version INTEGER NOT NULL,
        source_start_ms INTEGER NOT NULL, source_end_ms INTEGER NOT NULL,
        raw_event_count INTEGER NOT NULL, compact_event_count INTEGER NOT NULL,
        raw_sha256 TEXT NOT NULL CHECK (length(raw_sha256) = 64),
        compact_sha256 TEXT, analytics_fingerprint TEXT,
        raw_state TEXT NOT NULL DEFAULT 'retained' CHECK (raw_state IN ('retained','pruned')),
        status TEXT NOT NULL CHECK (status IN ('pending','verified','error')),
        compacted_at INTEGER, verified_at INTEGER, raw_retain_until INTEGER,
        raw_pruned_at INTEGER, last_error TEXT, updated_at INTEGER NOT NULL,
        CHECK (source_start_ms <= source_end_ms),
        CHECK (raw_event_count >= 0 AND compact_event_count >= 0),
        CHECK (compact_sha256 IS NULL OR length(compact_sha256) = 64),
        CHECK (analytics_fingerprint IS NULL OR length(analytics_fingerprint) = 64),
        CHECK ((raw_state = 'retained' AND raw_pruned_at IS NULL)
          OR (raw_state = 'pruned' AND raw_pruned_at IS NOT NULL)),
        CHECK (status <> 'verified' OR (compact_sha256 IS NOT NULL
          AND analytics_fingerprint IS NOT NULL AND compacted_at IS NOT NULL
          AND verified_at IS NOT NULL AND raw_retain_until IS NOT NULL)),
        PRIMARY KEY (game_id, puuid),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid) ON DELETE CASCADE
      );

      CREATE TABLE export_artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('full_backup','match_summary_csv')),
        absolute_path TEXT NOT NULL, artifact_sha256 TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('present','missing')),
        created_at INTEGER NOT NULL, last_verified_at INTEGER,
        CHECK (length(artifact_sha256) = 64), UNIQUE (absolute_path)
      );

      CREATE TABLE artifact_publish_journal (
        operation_id TEXT PRIMARY KEY CHECK (length(operation_id) = 36),
        kind TEXT NOT NULL CHECK (kind IN ('full_backup','match_summary_csv')),
        temp_path TEXT NOT NULL, final_path TEXT NOT NULL,
        expected_sha256 TEXT CHECK (expected_sha256 IS NULL OR length(expected_sha256) = 64),
        registry_row_json TEXT NOT NULL CHECK (json_valid(registry_row_json)),
        phase TEXT NOT NULL CHECK (phase IN ('staging','published','registered','rolled_back')),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_error TEXT,
        CHECK (phase = 'staging' OR expected_sha256 IS NOT NULL), UNIQUE (final_path)
      );

      CREATE TABLE maintenance_operations (
        operation_id TEXT PRIMARY KEY CHECK (length(operation_id) = 36),
        kind TEXT NOT NULL CHECK (kind = 'restore'),
        phase TEXT NOT NULL CHECK (phase IN (
          'planned','candidate_verified','writers_quiesced','swapped','merging',
          'verifying','complete','rolled_back','incomplete')),
        source_path TEXT, source_sha256 TEXT CHECK (source_sha256 IS NULL OR length(source_sha256) = 64),
        candidate_path TEXT, rollback_path TEXT,
        registry_snapshot_json TEXT NOT NULL CHECK (json_valid(registry_snapshot_json)),
        settings_snapshot_json TEXT NOT NULL CHECK (json_valid(settings_snapshot_json)),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_error TEXT
      );
    `,
  },
  {
    version: 24,
    up: `
      CREATE TRIGGER matches_grade_pair_insert
      BEFORE INSERT ON matches
      WHEN ((NEW.grade IS NULL) <> (NEW.grade_score IS NULL))
        OR (NEW.grade IS NOT NULL AND
          (NEW.grade_algorithm_version IS NULL OR COALESCE(NEW.grade_status, '') <> 'ready'
           OR NEW.grade_composite_percentile IS NULL))
        OR (NEW.grade IS NULL AND
          (NEW.grade_composite_percentile IS NOT NULL OR NEW.grade_status = 'ready'
           OR (NEW.grade_status IS NOT NULL AND NEW.grade_status NOT IN (
             'unsupported_mode','short_game','invalid_duration','incomplete_lobby',
             'missing_core_metric','missing_source_fact','terminated',
             'ineligible_for_progression','unmatched','bot_or_tutorial','legacy_unknown'))))
      BEGIN SELECT RAISE(ABORT, 'invalid complete grade cache state'); END;

      CREATE TRIGGER matches_grade_pair_update
      BEFORE UPDATE OF grade, grade_score, grade_algorithm_version,
                       grade_status, grade_composite_percentile ON matches
      WHEN ((NEW.grade IS NULL) <> (NEW.grade_score IS NULL))
        OR (NEW.grade IS NOT NULL AND
          (NEW.grade_algorithm_version IS NULL OR COALESCE(NEW.grade_status, '') <> 'ready'
           OR NEW.grade_composite_percentile IS NULL))
        OR (NEW.grade IS NULL AND
          (NEW.grade_composite_percentile IS NOT NULL OR NEW.grade_status = 'ready'
           OR (NEW.grade_status IS NOT NULL AND NEW.grade_status NOT IN (
             'unsupported_mode','short_game','invalid_duration','incomplete_lobby',
             'missing_core_metric','missing_source_fact','terminated',
             'ineligible_for_progression','unmatched','bot_or_tutorial','legacy_unknown'))))
      BEGIN SELECT RAISE(ABORT, 'invalid complete grade cache state'); END;

      CREATE TRIGGER match_participants_grade_pair_insert
      BEFORE INSERT ON match_participants
      WHEN ((NEW.grade IS NULL) <> (NEW.grade_score IS NULL))
        OR (NEW.grade IS NOT NULL AND
          (NEW.grade_algorithm_version IS NULL OR COALESCE(NEW.grade_status, '') <> 'ready'
           OR NEW.grade_composite_percentile IS NULL))
        OR (NEW.grade IS NULL AND
          (NEW.grade_composite_percentile IS NOT NULL OR NEW.grade_status = 'ready'
           OR (NEW.grade_status IS NOT NULL AND NEW.grade_status NOT IN (
             'unsupported_mode','short_game','invalid_duration','incomplete_lobby',
             'missing_core_metric','missing_source_fact','terminated',
             'ineligible_for_progression','unmatched','bot_or_tutorial','legacy_unknown'))))
      BEGIN SELECT RAISE(ABORT, 'invalid complete grade cache state'); END;

      CREATE TRIGGER match_participants_grade_pair_update
      BEFORE UPDATE OF grade, grade_score, grade_algorithm_version,
                       grade_status, grade_composite_percentile ON match_participants
      WHEN ((NEW.grade IS NULL) <> (NEW.grade_score IS NULL))
        OR (NEW.grade IS NOT NULL AND
          (NEW.grade_algorithm_version IS NULL OR COALESCE(NEW.grade_status, '') <> 'ready'
           OR NEW.grade_composite_percentile IS NULL))
        OR (NEW.grade IS NULL AND
          (NEW.grade_composite_percentile IS NOT NULL OR NEW.grade_status = 'ready'
           OR (NEW.grade_status IS NOT NULL AND NEW.grade_status NOT IN (
             'unsupported_mode','short_game','invalid_duration','incomplete_lobby',
             'missing_core_metric','missing_source_fact','terminated',
             'ineligible_for_progression','unmatched','bot_or_tutorial','legacy_unknown'))))
      BEGIN SELECT RAISE(ABORT, 'invalid complete grade cache state'); END;

      CREATE TABLE release_cleanup_state (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        schema24_first_seen_release_sequence INTEGER NOT NULL,
        rollback_observed_release_sequence INTEGER,
        cleanup_eligible_release_sequence INTEGER,
        repair_verified_at INTEGER, last_gate_error TEXT, updated_at INTEGER NOT NULL,
        CHECK ((rollback_observed_release_sequence IS NULL) =
               (cleanup_eligible_release_sequence IS NULL)),
        CHECK (cleanup_eligible_release_sequence IS NULL OR
               cleanup_eligible_release_sequence = rollback_observed_release_sequence + 1),
        CHECK (rollback_observed_release_sequence IS NULL OR
               (repair_verified_at IS NOT NULL AND repair_verified_at <= updated_at))
      );
    `,
  },
  {
    // Recall grades are identified by an immutable recipe, not only by the
    // product-facing algorithm version. The derived tables deliberately keep
    // their existing algorithm-version primary keys: one recipe can occupy an
    // algorithm version at a time, and a recipe change must purge those
    // derived rows before the new recipe is selected. Raw payloads, normalized
    // match facts, participants, teams, and timelines are not part of that
    // purge boundary.
    version: 25,
    up: `
      CREATE TABLE grade_calibration_snapshots (
        calibration_id TEXT PRIMARY KEY,
        calibration_hash TEXT NOT NULL UNIQUE CHECK (length(calibration_hash) = 64),
        reference_population_json TEXT NOT NULL CHECK (json_valid(reference_population_json)),
        sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
        snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
        created_at INTEGER NOT NULL
      );

      CREATE TABLE grade_recipes (
        recipe_id TEXT PRIMARY KEY,
        algorithm_version INTEGER NOT NULL CHECK (algorithm_version > 0),
        recipe_hash TEXT NOT NULL UNIQUE CHECK (length(recipe_hash) = 64),
        calibration_id TEXT,
        definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
        created_at INTEGER NOT NULL,
        UNIQUE (algorithm_version, recipe_id),
        FOREIGN KEY (calibration_id) REFERENCES grade_calibration_snapshots (calibration_id)
      );

      -- These markers make pre-v25 rows recognizable without ever allowing a
      -- legacy artifact to satisfy an exact current-recipe lookup by accident.
      INSERT INTO grade_recipes
        (recipe_id, algorithm_version, recipe_hash, definition_json, created_at)
      VALUES
        ('legacy:v1', 1, '182abf3067a993ee785e44bb914d68058d68b373b214110a2f2fa38853bcabd5',
         '{"kind":"legacy_unknown","algorithmVersion":1}', 0),
        ('legacy:v2', 2, 'deccdec500ed67bd2ad2976cd637263894a06c2986146b69c537adebbd301d40',
         '{"kind":"legacy_unknown","algorithmVersion":2}', 0),
        ('legacy:v3', 3, '3a443103ec44004dc51748fe036bed7afdae5b257d61bb2f272cc6878bb98faf',
         '{"kind":"legacy_shadow","algorithmVersion":3}', 0);

      -- Immutable means metadata cannot be rewritten in place. Deletion is a
      -- separate lifecycle operation and remains available once selections,
      -- derived artifacts, and recipe foreign keys have been removed.
      CREATE TRIGGER grade_calibration_snapshots_immutable_update
      BEFORE UPDATE ON grade_calibration_snapshots
      BEGIN SELECT RAISE(ABORT, 'grade_calibration_snapshot_is_immutable'); END;

      CREATE TRIGGER grade_recipes_immutable_update
      BEFORE UPDATE ON grade_recipes
      BEGIN SELECT RAISE(ABORT, 'grade_recipe_is_immutable'); END;

      -- The original attempt status enum is a table CHECK, so adding explicit
      -- cold-start states requires a derived-table rebuild. Stage and restore
      -- only grade artifacts; source and match evidence tables are untouched.
      CREATE TABLE match_grade_attempts_v25_stage AS
        SELECT * FROM match_grade_attempts;
      CREATE TABLE match_grade_results_v25_stage AS
        SELECT * FROM match_grade_results;
      CREATE TABLE match_grade_breakdowns_v25_stage AS
        SELECT * FROM match_grade_breakdown_versions;

      DROP TABLE match_grade_breakdown_versions;
      DROP TABLE match_grade_results;
      DROP TABLE match_grade_attempts;

      CREATE TABLE match_grade_attempts (
        game_id INTEGER NOT NULL, puuid TEXT NOT NULL,
        algorithm_version INTEGER NOT NULL, owner_participant_id INTEGER,
        grade_status TEXT NOT NULL CHECK (grade_status IN (
          'ready','unsupported_mode','short_game','invalid_duration','incomplete_lobby',
          'missing_core_metric','missing_source_fact','terminated',
          'ineligible_for_progression','unmatched','bot_or_tutorial','legacy_unknown',
          'calibrating','position_unresolved')),
        input_fingerprint TEXT NOT NULL CHECK (length(input_fingerprint) = 64),
        attempted_at INTEGER NOT NULL,
        recipe_id TEXT REFERENCES grade_recipes (recipe_id),
        role_fit_score REAL CHECK (role_fit_score IS NULL OR role_fit_score BETWEEN 0 AND 100),
        evidence_coverage REAL CHECK (evidence_coverage IS NULL OR evidence_coverage BETWEEN 0 AND 1),
        reference_sample_count INTEGER
          CHECK (reference_sample_count IS NULL OR reference_sample_count >= 0),
        reference_metadata_json TEXT
          CHECK (reference_metadata_json IS NULL OR json_valid(reference_metadata_json)),
        status_reason TEXT,
        CHECK (grade_status <> 'ready' OR owner_participant_id IS NOT NULL),
        PRIMARY KEY (game_id, puuid, algorithm_version),
        FOREIGN KEY (game_id, puuid) REFERENCES matches (game_id, puuid) ON DELETE CASCADE,
        FOREIGN KEY (game_id, puuid, owner_participant_id)
          REFERENCES match_participants (game_id, puuid, participant_id) ON DELETE CASCADE
      );

      CREATE TABLE match_grade_results (
        game_id INTEGER NOT NULL, puuid TEXT NOT NULL, participant_id INTEGER NOT NULL,
        algorithm_version INTEGER NOT NULL,
        grade TEXT NOT NULL CHECK (grade IN (
          'S+','S','S-','A+','A','A-','B+','B','B-','C+','C','C-','D')),
        grade_score REAL NOT NULL CHECK (grade_score BETWEEN -4 AND 4),
        composite_percentile REAL NOT NULL CHECK (composite_percentile BETWEEN 0 AND 1),
        grade_status TEXT NOT NULL CHECK (grade_status = 'ready'),
        created_at INTEGER NOT NULL,
        recipe_id TEXT REFERENCES grade_recipes (recipe_id),
        role_fit_score REAL CHECK (role_fit_score IS NULL OR role_fit_score BETWEEN 0 AND 100),
        evidence_coverage REAL CHECK (evidence_coverage IS NULL OR evidence_coverage BETWEEN 0 AND 1),
        reference_sample_count INTEGER
          CHECK (reference_sample_count IS NULL OR reference_sample_count >= 0),
        reference_metadata_json TEXT
          CHECK (reference_metadata_json IS NULL OR json_valid(reference_metadata_json)),
        PRIMARY KEY (game_id, puuid, participant_id, algorithm_version),
        FOREIGN KEY (game_id, puuid, algorithm_version)
          REFERENCES match_grade_attempts (game_id, puuid, algorithm_version) ON DELETE CASCADE,
        FOREIGN KEY (game_id, puuid, participant_id)
          REFERENCES match_participants (game_id, puuid, participant_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_grade_results_owner_version
        ON match_grade_results (puuid, algorithm_version, game_id);

      CREATE TABLE match_grade_breakdown_versions (
        game_id INTEGER NOT NULL, puuid TEXT NOT NULL, participant_id INTEGER NOT NULL,
        algorithm_version INTEGER NOT NULL,
        composite_percentile REAL NOT NULL CHECK (composite_percentile BETWEEN 0 AND 1),
        components_json TEXT NOT NULL CHECK (json_valid(components_json)),
        created_at INTEGER NOT NULL,
        recipe_id TEXT REFERENCES grade_recipes (recipe_id),
        role_fit_score REAL CHECK (role_fit_score IS NULL OR role_fit_score BETWEEN 0 AND 100),
        evidence_coverage REAL CHECK (evidence_coverage IS NULL OR evidence_coverage BETWEEN 0 AND 1),
        reference_sample_count INTEGER
          CHECK (reference_sample_count IS NULL OR reference_sample_count >= 0),
        reference_metadata_json TEXT
          CHECK (reference_metadata_json IS NULL OR json_valid(reference_metadata_json)),
        PRIMARY KEY (game_id, puuid, participant_id, algorithm_version),
        FOREIGN KEY (game_id, puuid, participant_id, algorithm_version)
          REFERENCES match_grade_results (game_id, puuid, participant_id, algorithm_version)
          ON DELETE CASCADE
      );

      INSERT INTO match_grade_attempts
        (game_id, puuid, algorithm_version, owner_participant_id, grade_status,
         input_fingerprint, attempted_at, recipe_id, reference_metadata_json)
      SELECT game_id, puuid, algorithm_version, owner_participant_id, grade_status,
             input_fingerprint, attempted_at, 'legacy:v' || algorithm_version,
             '{"kind":"legacy_unknown"}'
      FROM match_grade_attempts_v25_stage;
      INSERT INTO match_grade_results
        (game_id, puuid, participant_id, algorithm_version, grade, grade_score,
         composite_percentile, grade_status, created_at, recipe_id,
         reference_metadata_json)
      SELECT game_id, puuid, participant_id, algorithm_version, grade, grade_score,
             composite_percentile, grade_status, created_at,
             'legacy:v' || algorithm_version, '{"kind":"legacy_unknown"}'
      FROM match_grade_results_v25_stage;
      INSERT INTO match_grade_breakdown_versions
        (game_id, puuid, participant_id, algorithm_version,
         composite_percentile, components_json, created_at, recipe_id,
         reference_metadata_json)
      SELECT game_id, puuid, participant_id, algorithm_version,
             composite_percentile, components_json, created_at,
             'legacy:v' || algorithm_version, '{"kind":"legacy_unknown"}'
      FROM match_grade_breakdowns_v25_stage;

      DROP TABLE match_grade_breakdowns_v25_stage;
      DROP TABLE match_grade_results_v25_stage;
      DROP TABLE match_grade_attempts_v25_stage;

      ALTER TABLE match_grade_breakdowns ADD COLUMN recipe_id TEXT
        REFERENCES grade_recipes (recipe_id);
      ALTER TABLE match_grade_breakdowns ADD COLUMN role_fit_score REAL
        CHECK (role_fit_score IS NULL OR role_fit_score BETWEEN 0 AND 100);
      ALTER TABLE match_grade_breakdowns ADD COLUMN evidence_coverage REAL
        CHECK (evidence_coverage IS NULL OR evidence_coverage BETWEEN 0 AND 1);
      ALTER TABLE match_grade_breakdowns ADD COLUMN reference_sample_count INTEGER
        CHECK (reference_sample_count IS NULL OR reference_sample_count >= 0);
      ALTER TABLE match_grade_breakdowns ADD COLUMN reference_metadata_json TEXT
        CHECK (reference_metadata_json IS NULL OR json_valid(reference_metadata_json));

      ALTER TABLE matches ADD COLUMN grade_recipe_id TEXT
        REFERENCES grade_recipes (recipe_id);
      ALTER TABLE matches ADD COLUMN role_fit_score REAL
        CHECK (role_fit_score IS NULL OR role_fit_score BETWEEN 0 AND 100);
      ALTER TABLE matches ADD COLUMN grade_evidence_coverage REAL
        CHECK (grade_evidence_coverage IS NULL OR grade_evidence_coverage BETWEEN 0 AND 1);
      ALTER TABLE matches ADD COLUMN grade_reference_sample_count INTEGER
        CHECK (grade_reference_sample_count IS NULL OR grade_reference_sample_count >= 0);
      ALTER TABLE matches ADD COLUMN grade_reference_metadata_json TEXT
        CHECK (grade_reference_metadata_json IS NULL OR json_valid(grade_reference_metadata_json));

      ALTER TABLE match_participants ADD COLUMN grade_recipe_id TEXT
        REFERENCES grade_recipes (recipe_id);
      ALTER TABLE match_participants ADD COLUMN role_fit_score REAL
        CHECK (role_fit_score IS NULL OR role_fit_score BETWEEN 0 AND 100);
      ALTER TABLE match_participants ADD COLUMN grade_evidence_coverage REAL
        CHECK (grade_evidence_coverage IS NULL OR grade_evidence_coverage BETWEEN 0 AND 1);
      ALTER TABLE match_participants ADD COLUMN grade_reference_sample_count INTEGER
        CHECK (grade_reference_sample_count IS NULL OR grade_reference_sample_count >= 0);
      ALTER TABLE match_participants ADD COLUMN grade_reference_metadata_json TEXT
        CHECK (grade_reference_metadata_json IS NULL OR json_valid(grade_reference_metadata_json));

      -- Source fact completeness is separate from the normalized numeric
      -- columns. Older mappers converted an absent number to zero, so the
      -- stored value alone cannot prove that Riot actually reported the fact.
      ALTER TABLE match_participants ADD COLUMN grade_core_complete INTEGER NOT NULL DEFAULT 0
        CHECK (grade_core_complete IN (0, 1));
      ALTER TABLE match_participants ADD COLUMN grade_core_source TEXT NOT NULL
        DEFAULT 'legacy_unknown'
        CHECK (grade_core_source IN (
          'league_client','match_v5','legacy_full_detail','legacy_unknown'
        ));
      ALTER TABLE match_participants ADD COLUMN grade_core_missing_fields_json TEXT NOT NULL
        DEFAULT '["participant_id","team_id","champion_id","kills","deaths","assists","gold_earned","damage_to_champions","total_minions_killed","neutral_minions","damage_objectives","damage_turrets","time_ccing_others","vision_score"]'
        CHECK (json_valid(grade_core_missing_fields_json)
          AND json_type(grade_core_missing_fields_json) = 'array');
      ALTER TABLE match_participants ADD COLUMN grade_core_contract_version INTEGER NOT NULL
        DEFAULT 1 CHECK (grade_core_contract_version > 0);

      -- Do not infer source presence from old normalized columns. Before v25,
      -- mappers converted an absent numeric field to zero, so even a complete
      -- v7 lobby cannot prove whether a zero was reported. The v3 coordinator
      -- promotes a legacy row only after re-reading a checksummed raw full-
      -- scoreboard payload and verifying every core value against storage.

      UPDATE match_grade_attempts
      SET recipe_id = 'legacy:v' || algorithm_version,
          reference_metadata_json = '{"kind":"legacy_unknown"}'
      WHERE algorithm_version IN (1, 2, 3);
      UPDATE match_grade_results
      SET recipe_id = 'legacy:v' || algorithm_version,
          reference_metadata_json = '{"kind":"legacy_unknown"}'
      WHERE algorithm_version IN (1, 2, 3);
      UPDATE match_grade_breakdown_versions
      SET recipe_id = 'legacy:v' || algorithm_version,
          reference_metadata_json = '{"kind":"legacy_unknown"}'
      WHERE algorithm_version IN (1, 2, 3);
      UPDATE match_grade_breakdowns
      SET recipe_id = 'legacy:v' || algorithm_version,
          reference_metadata_json = '{"kind":"legacy_unknown"}'
      WHERE algorithm_version IN (1, 2, 3);
      UPDATE matches
      SET grade_recipe_id = 'legacy:v' || grade_algorithm_version,
          grade_reference_metadata_json = '{"kind":"legacy_unknown"}'
      WHERE grade_algorithm_version IN (1, 2, 3);
      UPDATE match_participants
      SET grade_recipe_id = 'legacy:v' || grade_algorithm_version,
          grade_reference_metadata_json = '{"kind":"legacy_unknown"}'
      WHERE grade_algorithm_version IN (1, 2, 3);

      DROP TRIGGER matches_grade_pair_insert;
      DROP TRIGGER matches_grade_pair_update;
      DROP TRIGGER match_participants_grade_pair_insert;
      DROP TRIGGER match_participants_grade_pair_update;

      CREATE TRIGGER matches_grade_pair_insert
      BEFORE INSERT ON matches
      WHEN ((NEW.grade IS NULL) <> (NEW.grade_score IS NULL))
        OR (NEW.grade IS NOT NULL AND
          (NEW.grade_algorithm_version IS NULL OR COALESCE(NEW.grade_status, '') <> 'ready'
           OR NEW.grade_composite_percentile IS NULL))
        OR (NEW.grade IS NULL AND
          (NEW.grade_composite_percentile IS NOT NULL OR NEW.grade_status = 'ready'
           OR (NEW.grade_status IS NOT NULL AND NEW.grade_status NOT IN (
             'unsupported_mode','short_game','invalid_duration','incomplete_lobby',
             'missing_core_metric','missing_source_fact','terminated',
             'ineligible_for_progression','unmatched','bot_or_tutorial','legacy_unknown',
             'calibrating','position_unresolved'))))
      BEGIN SELECT RAISE(ABORT, 'invalid complete grade cache state'); END;

      CREATE TRIGGER matches_grade_pair_update
      BEFORE UPDATE OF grade, grade_score, grade_algorithm_version,
                       grade_status, grade_composite_percentile ON matches
      WHEN ((NEW.grade IS NULL) <> (NEW.grade_score IS NULL))
        OR (NEW.grade IS NOT NULL AND
          (NEW.grade_algorithm_version IS NULL OR COALESCE(NEW.grade_status, '') <> 'ready'
           OR NEW.grade_composite_percentile IS NULL))
        OR (NEW.grade IS NULL AND
          (NEW.grade_composite_percentile IS NOT NULL OR NEW.grade_status = 'ready'
           OR (NEW.grade_status IS NOT NULL AND NEW.grade_status NOT IN (
             'unsupported_mode','short_game','invalid_duration','incomplete_lobby',
             'missing_core_metric','missing_source_fact','terminated',
             'ineligible_for_progression','unmatched','bot_or_tutorial','legacy_unknown',
             'calibrating','position_unresolved'))))
      BEGIN SELECT RAISE(ABORT, 'invalid complete grade cache state'); END;

      CREATE TRIGGER match_participants_grade_pair_insert
      BEFORE INSERT ON match_participants
      WHEN ((NEW.grade IS NULL) <> (NEW.grade_score IS NULL))
        OR (NEW.grade IS NOT NULL AND
          (NEW.grade_algorithm_version IS NULL OR COALESCE(NEW.grade_status, '') <> 'ready'
           OR NEW.grade_composite_percentile IS NULL))
        OR (NEW.grade IS NULL AND
          (NEW.grade_composite_percentile IS NOT NULL OR NEW.grade_status = 'ready'
           OR (NEW.grade_status IS NOT NULL AND NEW.grade_status NOT IN (
             'unsupported_mode','short_game','invalid_duration','incomplete_lobby',
             'missing_core_metric','missing_source_fact','terminated',
             'ineligible_for_progression','unmatched','bot_or_tutorial','legacy_unknown',
             'calibrating','position_unresolved'))))
      BEGIN SELECT RAISE(ABORT, 'invalid complete grade cache state'); END;

      CREATE TRIGGER match_participants_grade_pair_update
      BEFORE UPDATE OF grade, grade_score, grade_algorithm_version,
                       grade_status, grade_composite_percentile ON match_participants
      WHEN ((NEW.grade IS NULL) <> (NEW.grade_score IS NULL))
        OR (NEW.grade IS NOT NULL AND
          (NEW.grade_algorithm_version IS NULL OR COALESCE(NEW.grade_status, '') <> 'ready'
           OR NEW.grade_composite_percentile IS NULL))
        OR (NEW.grade IS NULL AND
          (NEW.grade_composite_percentile IS NOT NULL OR NEW.grade_status = 'ready'
           OR (NEW.grade_status IS NOT NULL AND NEW.grade_status NOT IN (
             'unsupported_mode','short_game','invalid_duration','incomplete_lobby',
             'missing_core_metric','missing_source_fact','terminated',
             'ineligible_for_progression','unmatched','bot_or_tutorial','legacy_unknown',
             'calibrating','position_unresolved'))))
      BEGIN SELECT RAISE(ABORT, 'invalid complete grade cache state'); END;

      CREATE INDEX idx_grade_attempts_exact_recipe
        ON match_grade_attempts (puuid, algorithm_version, recipe_id, game_id);
      CREATE INDEX idx_grade_results_exact_recipe
        ON match_grade_results (puuid, algorithm_version, recipe_id, game_id);
      CREATE INDEX idx_grade_breakdowns_exact_recipe
        ON match_grade_breakdown_versions (puuid, algorithm_version, recipe_id, game_id);

      CREATE TABLE grade_recipe_selections (
        algorithm_version INTEGER PRIMARY KEY,
        recipe_id TEXT NOT NULL,
        selected_at INTEGER NOT NULL,
        FOREIGN KEY (algorithm_version, recipe_id)
          REFERENCES grade_recipes (algorithm_version, recipe_id)
      );

      -- Artifact keys remain algorithm-version keyed. Refuse to switch recipes
      -- until every derived row/cache for that version has been purged.
      CREATE TRIGGER grade_recipe_selection_insert_requires_purge
      BEFORE INSERT ON grade_recipe_selections
      WHEN EXISTS (SELECT 1 FROM match_grade_attempts
                   WHERE algorithm_version = NEW.algorithm_version
                     AND COALESCE(recipe_id, '') <> NEW.recipe_id)
        OR EXISTS (SELECT 1 FROM match_grade_results
                   WHERE algorithm_version = NEW.algorithm_version
                     AND COALESCE(recipe_id, '') <> NEW.recipe_id)
        OR EXISTS (SELECT 1 FROM match_grade_breakdown_versions
                   WHERE algorithm_version = NEW.algorithm_version
                     AND COALESCE(recipe_id, '') <> NEW.recipe_id)
        OR EXISTS (SELECT 1 FROM match_grade_breakdowns
                   WHERE algorithm_version = NEW.algorithm_version
                     AND COALESCE(recipe_id, '') <> NEW.recipe_id)
        OR EXISTS (SELECT 1 FROM matches
                   WHERE grade_algorithm_version = NEW.algorithm_version
                     AND COALESCE(grade_recipe_id, '') <> NEW.recipe_id)
        OR EXISTS (SELECT 1 FROM match_participants
                   WHERE grade_algorithm_version = NEW.algorithm_version
                     AND COALESCE(grade_recipe_id, '') <> NEW.recipe_id)
      BEGIN SELECT RAISE(ABORT, 'grade_recipe_purge_required'); END;

      CREATE TRIGGER grade_recipe_selection_update_requires_purge
      BEFORE UPDATE OF recipe_id ON grade_recipe_selections
      WHEN OLD.recipe_id <> NEW.recipe_id AND (
        EXISTS (SELECT 1 FROM match_grade_attempts
                WHERE algorithm_version = NEW.algorithm_version)
        OR EXISTS (SELECT 1 FROM match_grade_results
                   WHERE algorithm_version = NEW.algorithm_version)
        OR EXISTS (SELECT 1 FROM match_grade_breakdown_versions
                   WHERE algorithm_version = NEW.algorithm_version)
        OR EXISTS (SELECT 1 FROM match_grade_breakdowns
                   WHERE algorithm_version = NEW.algorithm_version)
        OR EXISTS (SELECT 1 FROM matches
                   WHERE grade_algorithm_version = NEW.algorithm_version)
        OR EXISTS (SELECT 1 FROM match_participants
                   WHERE grade_algorithm_version = NEW.algorithm_version)
      )
      BEGIN SELECT RAISE(ABORT, 'grade_recipe_purge_required'); END;

      CREATE TRIGGER grade_attempt_selected_recipe_insert
      BEFORE INSERT ON match_grade_attempts
      WHEN EXISTS (
        SELECT 1 FROM grade_recipe_selections s
        WHERE s.algorithm_version = NEW.algorithm_version
          AND s.recipe_id <> COALESCE(NEW.recipe_id, '')
      )
      BEGIN SELECT RAISE(ABORT, 'grade_attempt_recipe_is_not_selected'); END;

      CREATE TRIGGER grade_attempt_selected_recipe_update
      BEFORE UPDATE OF algorithm_version, recipe_id ON match_grade_attempts
      WHEN EXISTS (
        SELECT 1 FROM grade_recipe_selections s
        WHERE s.algorithm_version = NEW.algorithm_version
          AND s.recipe_id <> COALESCE(NEW.recipe_id, '')
      )
      BEGIN SELECT RAISE(ABORT, 'grade_attempt_recipe_is_not_selected'); END;

      CREATE TRIGGER grade_result_attempt_recipe_insert
      BEFORE INSERT ON match_grade_results
      WHEN NOT EXISTS (
        SELECT 1 FROM match_grade_attempts a
        WHERE a.game_id = NEW.game_id AND a.puuid = NEW.puuid
          AND a.algorithm_version = NEW.algorithm_version
          AND COALESCE(a.recipe_id, '') = COALESCE(NEW.recipe_id, '')
      )
      BEGIN SELECT RAISE(ABORT, 'grade_result_recipe_mismatch'); END;

      CREATE TRIGGER grade_result_attempt_recipe_update
      BEFORE UPDATE OF game_id, puuid, algorithm_version, recipe_id ON match_grade_results
      WHEN NOT EXISTS (
        SELECT 1 FROM match_grade_attempts a
        WHERE a.game_id = NEW.game_id AND a.puuid = NEW.puuid
          AND a.algorithm_version = NEW.algorithm_version
          AND COALESCE(a.recipe_id, '') = COALESCE(NEW.recipe_id, '')
      )
      BEGIN SELECT RAISE(ABORT, 'grade_result_recipe_mismatch'); END;

      CREATE TRIGGER grade_breakdown_result_recipe_insert
      BEFORE INSERT ON match_grade_breakdown_versions
      WHEN NOT EXISTS (
        SELECT 1 FROM match_grade_results r
        WHERE r.game_id = NEW.game_id AND r.puuid = NEW.puuid
          AND r.participant_id = NEW.participant_id
          AND r.algorithm_version = NEW.algorithm_version
          AND COALESCE(r.recipe_id, '') = COALESCE(NEW.recipe_id, '')
      )
      BEGIN SELECT RAISE(ABORT, 'grade_breakdown_recipe_mismatch'); END;

      CREATE TRIGGER grade_breakdown_result_recipe_update
      BEFORE UPDATE OF game_id, puuid, participant_id, algorithm_version, recipe_id
      ON match_grade_breakdown_versions
      WHEN NOT EXISTS (
        SELECT 1 FROM match_grade_results r
        WHERE r.game_id = NEW.game_id AND r.puuid = NEW.puuid
          AND r.participant_id = NEW.participant_id
          AND r.algorithm_version = NEW.algorithm_version
          AND COALESCE(r.recipe_id, '') = COALESCE(NEW.recipe_id, '')
      )
      BEGIN SELECT RAISE(ABORT, 'grade_breakdown_recipe_mismatch'); END;

      CREATE TABLE grade_rebuild_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        puuid TEXT NOT NULL,
        algorithm_version INTEGER NOT NULL,
        recipe_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'pending','running','complete','complete_with_errors','cancelled','error')),
        stage TEXT NOT NULL CHECK (stage IN (
          'preflight','purge','recompute','verify','complete')),
        total_matches INTEGER NOT NULL DEFAULT 0 CHECK (total_matches >= 0),
        processed_matches INTEGER NOT NULL DEFAULT 0 CHECK (processed_matches >= 0),
        ready_matches INTEGER NOT NULL DEFAULT 0 CHECK (ready_matches >= 0),
        nonready_matches INTEGER NOT NULL DEFAULT 0 CHECK (nonready_matches >= 0),
        error_matches INTEGER NOT NULL DEFAULT 0 CHECK (error_matches >= 0),
        last_game_id INTEGER,
        backup_path TEXT NOT NULL,
        backup_sha256 TEXT NOT NULL CHECK (length(backup_sha256) = 64),
        last_error TEXT,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        CHECK (processed_matches <= total_matches),
        CHECK (ready_matches + nonready_matches + error_matches <= processed_matches),
        CHECK ((status IN ('complete','complete_with_errors','cancelled','error'))
          = (completed_at IS NOT NULL)),
        FOREIGN KEY (algorithm_version, recipe_id)
          REFERENCES grade_recipes (algorithm_version, recipe_id)
      );
      CREATE INDEX idx_grade_rebuild_runs_owner
        ON grade_rebuild_runs (puuid, updated_at DESC);

      -- Queue 900 is URF, not a standard Rift cohort. Correct stored rows
      -- before any v3 calibration/rebuild selects candidates.
      UPDATE matches
      SET mode = 'urf', mode_family = 'other', is_ranked = 0
      WHERE queue_id = 900 OR UPPER(game_mode) LIKE '%URF%';
    `,
  },
  {
    // Detailed RVI measurements are durable derived evidence. Keep their
    // recipe identity separate from the product-facing version and from the
    // Grade recipe: both aggregates share a calibration snapshot, but each
    // has its own immutable mapping and policy definition.
    version: 26,
    up: `
      CREATE TABLE rvi_recipes (
        recipe_id TEXT PRIMARY KEY CHECK (length(trim(recipe_id)) > 0),
        algorithm_version INTEGER NOT NULL CHECK (algorithm_version > 0),
        recipe_hash TEXT NOT NULL UNIQUE CHECK (length(recipe_hash) = 64),
        grade_recipe_id TEXT NOT NULL REFERENCES grade_recipes (recipe_id),
        calibration_id TEXT NOT NULL
          REFERENCES grade_calibration_snapshots (calibration_id),
        definition_json TEXT NOT NULL
          CHECK (json_valid(definition_json)
            AND json_type(definition_json) = 'object'),
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        UNIQUE (algorithm_version, recipe_id)
      );

      CREATE TRIGGER rvi_recipes_grade_calibration_insert
      BEFORE INSERT ON rvi_recipes
      WHEN NOT EXISTS (
        SELECT 1 FROM grade_recipes grade_recipe
        WHERE grade_recipe.recipe_id = NEW.grade_recipe_id
          AND grade_recipe.algorithm_version = NEW.algorithm_version
          AND grade_recipe.calibration_id = NEW.calibration_id
      )
      BEGIN SELECT RAISE(ABORT, 'rvi_grade_recipe_calibration_mismatch'); END;

      CREATE TRIGGER rvi_recipes_immutable_update
      BEFORE UPDATE ON rvi_recipes
      BEGIN SELECT RAISE(ABORT, 'rvi_recipe_is_immutable'); END;

      CREATE TABLE rvi_recipe_selections (
        algorithm_version INTEGER PRIMARY KEY CHECK (algorithm_version > 0),
        recipe_id TEXT NOT NULL,
        selected_at INTEGER NOT NULL CHECK (selected_at >= 0),
        FOREIGN KEY (algorithm_version, recipe_id)
          REFERENCES rvi_recipes (algorithm_version, recipe_id)
      );

      CREATE TABLE match_metric_observations (
        game_id INTEGER NOT NULL,
        puuid TEXT NOT NULL,
        participant_id INTEGER NOT NULL CHECK (participant_id > 0),
        algorithm_version INTEGER NOT NULL CHECK (algorithm_version > 0),
        recipe_id TEXT NOT NULL,
        calibration_id TEXT NOT NULL
          REFERENCES grade_calibration_snapshots (calibration_id),
        metric_key TEXT NOT NULL CHECK (length(trim(metric_key)) > 0),
        raw_evidence_state TEXT NOT NULL CHECK (raw_evidence_state IN (
          'observed','unavailable','no_opportunity','not_applicable','invalid','unknown')),
        raw_evidence_reason TEXT,
        raw_value REAL,
        score_evidence_state TEXT NOT NULL CHECK (score_evidence_state IN (
          'observed','unavailable','no_opportunity','not_applicable','invalid','unknown')),
        score_evidence_reason TEXT,
        score_value REAL,
        numerator REAL,
        denominator REAL CHECK (denominator IS NULL OR denominator >= 0),
        opportunity_count INTEGER
          CHECK (opportunity_count IS NULL OR opportunity_count >= 0),
        unit TEXT NOT NULL CHECK (length(trim(unit)) > 0),
        comparison_scope TEXT CHECK (comparison_scope IS NULL OR comparison_scope IN (
          'mode','position','archetype')),
        reference_match_count INTEGER
          CHECK (reference_match_count IS NULL OR reference_match_count >= 0),
        source TEXT NOT NULL CHECK (source IN (
          'scoreboard','extended','timeline','derived')),
        source_quality TEXT NOT NULL CHECK (source_quality IN (
          'verified','retained','derived','legacy')),
        derivation_id TEXT NOT NULL CHECK (length(trim(derivation_id)) > 0),
        derived_at INTEGER NOT NULL CHECK (derived_at >= 0),
        PRIMARY KEY (
          game_id, puuid, participant_id, algorithm_version, recipe_id, metric_key
        ),
        FOREIGN KEY (game_id, puuid, participant_id)
          REFERENCES match_participants (game_id, puuid, participant_id)
          ON DELETE CASCADE,
        FOREIGN KEY (algorithm_version, recipe_id)
          REFERENCES rvi_recipes (algorithm_version, recipe_id),
        CHECK ((raw_evidence_state = 'observed') = (raw_value IS NOT NULL)),
        CHECK ((score_evidence_state = 'observed') = (score_value IS NOT NULL)),
        CHECK (score_value IS NULL OR score_value BETWEEN 0 AND 1),
        CHECK (score_evidence_state <> 'observed' OR raw_evidence_state = 'observed')
      );

      CREATE INDEX idx_metric_observations_owner_recipe_history
        ON match_metric_observations
          (puuid, algorithm_version, recipe_id, participant_id, game_id, metric_key);
      CREATE INDEX idx_metric_observations_match_recipe_detail
        ON match_metric_observations
          (game_id, puuid, algorithm_version, recipe_id, participant_id, metric_key);

      CREATE TRIGGER rvi_selection_insert_requires_purge
      BEFORE INSERT ON rvi_recipe_selections
      WHEN EXISTS (
        SELECT 1 FROM match_metric_observations observation
        WHERE observation.algorithm_version = NEW.algorithm_version
          AND observation.recipe_id <> NEW.recipe_id
      )
      BEGIN SELECT RAISE(ABORT, 'rvi_recipe_purge_required'); END;

      CREATE TRIGGER rvi_selection_update_requires_purge
      BEFORE UPDATE OF algorithm_version, recipe_id ON rvi_recipe_selections
      WHEN (OLD.algorithm_version <> NEW.algorithm_version
            OR OLD.recipe_id <> NEW.recipe_id)
        AND (
          EXISTS (
            SELECT 1 FROM match_metric_observations observation
            WHERE observation.algorithm_version = OLD.algorithm_version
          )
          OR EXISTS (
            SELECT 1 FROM match_metric_observations observation
            WHERE observation.algorithm_version = NEW.algorithm_version
              AND observation.recipe_id <> NEW.recipe_id
          )
        )
      BEGIN SELECT RAISE(ABORT, 'rvi_recipe_purge_required'); END;

      CREATE TRIGGER rvi_selection_delete_requires_purge
      BEFORE DELETE ON rvi_recipe_selections
      WHEN EXISTS (
        SELECT 1 FROM match_metric_observations observation
        WHERE observation.algorithm_version = OLD.algorithm_version
      )
      BEGIN SELECT RAISE(ABORT, 'rvi_recipe_purge_required'); END;

      CREATE TRIGGER metric_observation_selected_recipe_insert
      BEFORE INSERT ON match_metric_observations
      WHEN NOT EXISTS (
        SELECT 1 FROM rvi_recipe_selections selection
        WHERE selection.algorithm_version = NEW.algorithm_version
          AND selection.recipe_id = NEW.recipe_id
      )
      BEGIN SELECT RAISE(ABORT, 'metric_observation_recipe_is_not_selected'); END;

      CREATE TRIGGER metric_observation_selected_recipe_update
      BEFORE UPDATE OF algorithm_version, recipe_id ON match_metric_observations
      WHEN NOT EXISTS (
        SELECT 1 FROM rvi_recipe_selections selection
        WHERE selection.algorithm_version = NEW.algorithm_version
          AND selection.recipe_id = NEW.recipe_id
      )
      BEGIN SELECT RAISE(ABORT, 'metric_observation_recipe_is_not_selected'); END;

      CREATE TRIGGER metric_observation_calibration_insert
      BEFORE INSERT ON match_metric_observations
      WHEN NOT EXISTS (
        SELECT 1 FROM rvi_recipes recipe
        WHERE recipe.algorithm_version = NEW.algorithm_version
          AND recipe.recipe_id = NEW.recipe_id
          AND recipe.calibration_id = NEW.calibration_id
      )
      BEGIN SELECT RAISE(ABORT, 'metric_observation_calibration_mismatch'); END;

      CREATE TRIGGER metric_observation_calibration_update
      BEFORE UPDATE OF algorithm_version, recipe_id, calibration_id
      ON match_metric_observations
      WHEN NOT EXISTS (
        SELECT 1 FROM rvi_recipes recipe
        WHERE recipe.algorithm_version = NEW.algorithm_version
          AND recipe.recipe_id = NEW.recipe_id
          AND recipe.calibration_id = NEW.calibration_id
      )
      BEGIN SELECT RAISE(ABORT, 'metric_observation_calibration_mismatch'); END;
    `,
  },
  {
    // Account identity and profile observations are separate from
    // profile_snapshots, which stores Challenge progression. LCU sessions are
    // sampled repeatedly, so the repository records only actual transitions.
    version: 27,
    up: `
      CREATE TABLE account_profile_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        puuid TEXT NOT NULL CHECK (length(trim(puuid)) > 0),
        summoner_id INTEGER
          CHECK (summoner_id IS NULL OR summoner_id >= 0),
        game_name TEXT,
        tag_line TEXT,
        profile_icon_id INTEGER
          CHECK (profile_icon_id IS NULL OR profile_icon_id >= 0),
        summoner_level INTEGER
          CHECK (summoner_level IS NULL OR summoner_level >= 0),
        platform_id TEXT,
        regional_route TEXT,
        observed_at INTEGER NOT NULL CHECK (observed_at >= 0)
      );

      CREATE INDEX idx_account_profile_snapshots_owner_time
        ON account_profile_snapshots (puuid, observed_at DESC, id DESC);
    `,
  },
  {
    // Remove abandoned parallel pipelines that were introduced as schema
    // experiments but never wired into the running application. The active
    // local-first history backfill, source payload, label, timeline, export,
    // and live-capture paths remain unchanged.
    version: 28,
    up: `
      DROP TABLE IF EXISTS match_enrichment_jobs;
      DROP TABLE IF EXISTS history_remediation_runs;
      DROP TABLE IF EXISTS riot_history_run_matches;
      DROP TABLE IF EXISTS riot_match_ingestion;
      DROP TABLE IF EXISTS riot_history_runs;

      DROP TABLE IF EXISTS match_source_capture_payloads;
      DROP TABLE IF EXISTS match_source_captures;

      DROP TABLE IF EXISTS match_performance_label_versions;
      DROP TABLE IF EXISTS match_label_evaluation_versions;

      DROP TABLE IF EXISTS live_capture_compactions;
      DROP TABLE IF EXISTS artifact_publish_journal;
      DROP TABLE IF EXISTS maintenance_operations;
      DROP TABLE IF EXISTS release_cleanup_state;
    `,
  },
  {
    // Raw bodies are content-addressed, but repeated observations still carry
    // useful provenance. Keep one copy of identical bytes together with the
    // first/last observation boundary and exact number of captures.
    version: 29,
    up: `
      ALTER TABLE match_source_payloads ADD COLUMN first_fetched_at INTEGER
        CHECK (first_fetched_at IS NULL OR first_fetched_at >= 0);
      ALTER TABLE match_source_payloads ADD COLUMN last_fetched_at INTEGER
        CHECK (last_fetched_at IS NULL OR last_fetched_at >= 0);
      ALTER TABLE match_source_payloads ADD COLUMN observation_count INTEGER
        NOT NULL DEFAULT 1 CHECK (observation_count > 0);

      UPDATE match_source_payloads
      SET first_fetched_at = fetched_at,
          last_fetched_at = fetched_at;

      -- Older builds put the observation timestamp in history-page identity,
      -- so an identical 0..19 response bypassed the payload primary key on
      -- every poll. The highest mapper owns mapping metadata while aggregate
      -- fields retain the complete observation boundary and count.
      CREATE TEMP TABLE retained_history_pages AS
      WITH ranked AS (
        SELECT payload_row.*,
               MIN(first_fetched_at) OVER (
                 PARTITION BY owner_puuid, source, kind, sha256
               ) AS retained_first_fetched_at,
               MAX(last_fetched_at) OVER (
                 PARTITION BY owner_puuid, source, kind, sha256
               ) AS retained_last_fetched_at,
               SUM(observation_count) OVER (
                 PARTITION BY owner_puuid, source, kind, sha256
               ) AS retained_observation_count,
               ROW_NUMBER() OVER (
                 PARTITION BY owner_puuid, source, kind, sha256
                 ORDER BY mapper_version DESC, fetched_at DESC, rowid DESC
               ) AS retained_rank
        FROM match_source_payloads payload_row
        WHERE source = 'league_client' AND kind = 'history_page'
      )
      SELECT owner_puuid, source, 'recent:0:19' AS source_match_id, game_id,
             kind, encoding, payload, sha256, data_version, mapper_version,
             serialization_version, mapping_status, mapping_error, mapped_at,
             retained_last_fetched_at AS fetched_at,
             retained_first_fetched_at AS first_fetched_at,
             retained_last_fetched_at AS last_fetched_at,
             retained_observation_count AS observation_count
      FROM ranked
      WHERE retained_rank = 1;

      DELETE FROM match_source_payloads
      WHERE source = 'league_client' AND kind = 'history_page';

      INSERT INTO match_source_payloads
        (owner_puuid, source, source_match_id, game_id, kind, encoding,
         payload, sha256, data_version, mapper_version,
         serialization_version, mapping_status, mapping_error, mapped_at,
         fetched_at, first_fetched_at, last_fetched_at, observation_count)
      SELECT owner_puuid, source, source_match_id, game_id, kind, encoding,
             payload, sha256, data_version, mapper_version,
             serialization_version, mapping_status, mapping_error, mapped_at,
             fetched_at, first_fetched_at, last_fetched_at, observation_count
      FROM retained_history_pages;

      DROP TABLE retained_history_pages;
    `,
  },
  {
    // Metric observations can outnumber matches by two orders of magnitude.
    // Store their immutable RVI recipe identity once and reference it with an
    // integer key; the details view keeps the exact public identity available
    // to every reader without duplicating long recipe/calibration strings in
    // each row and in both covering indexes.
    version: 30,
    up: `
      DROP TRIGGER IF EXISTS rvi_selection_insert_requires_purge;
      DROP TRIGGER IF EXISTS rvi_selection_update_requires_purge;
      DROP TRIGGER IF EXISTS rvi_selection_delete_requires_purge;
      DROP TRIGGER IF EXISTS metric_observation_selected_recipe_insert;
      DROP TRIGGER IF EXISTS metric_observation_selected_recipe_update;
      DROP TRIGGER IF EXISTS metric_observation_calibration_insert;
      DROP TRIGGER IF EXISTS metric_observation_calibration_update;

      DROP INDEX IF EXISTS idx_metric_observations_owner_recipe_history;
      DROP INDEX IF EXISTS idx_metric_observations_match_recipe_detail;

      ALTER TABLE match_metric_observations
        RENAME TO match_metric_observations_v29;

      CREATE TABLE rvi_recipe_storage_keys (
        recipe_key INTEGER PRIMARY KEY,
        algorithm_version INTEGER NOT NULL CHECK (algorithm_version > 0),
        recipe_id TEXT NOT NULL UNIQUE CHECK (length(trim(recipe_id)) > 0),
        UNIQUE (algorithm_version, recipe_id),
        FOREIGN KEY (algorithm_version, recipe_id)
          REFERENCES rvi_recipes (algorithm_version, recipe_id)
          ON DELETE CASCADE
      );

      INSERT INTO rvi_recipe_storage_keys (algorithm_version, recipe_id)
      SELECT algorithm_version, recipe_id
      FROM rvi_recipes
      ORDER BY algorithm_version, recipe_id;

      CREATE TRIGGER rvi_recipe_storage_key_insert
      AFTER INSERT ON rvi_recipes
      BEGIN
        INSERT INTO rvi_recipe_storage_keys (algorithm_version, recipe_id)
        VALUES (NEW.algorithm_version, NEW.recipe_id);
      END;

      CREATE TABLE match_metric_observations (
        game_id INTEGER NOT NULL,
        puuid TEXT NOT NULL,
        participant_id INTEGER NOT NULL CHECK (participant_id > 0),
        recipe_key INTEGER NOT NULL,
        metric_key TEXT NOT NULL CHECK (length(trim(metric_key)) > 0),
        raw_evidence_state TEXT NOT NULL CHECK (raw_evidence_state IN (
          'observed','unavailable','no_opportunity','not_applicable','invalid','unknown')),
        raw_evidence_reason TEXT,
        raw_value REAL,
        score_evidence_state TEXT NOT NULL CHECK (score_evidence_state IN (
          'observed','unavailable','no_opportunity','not_applicable','invalid','unknown')),
        score_evidence_reason TEXT,
        score_value REAL,
        numerator REAL,
        denominator REAL CHECK (denominator IS NULL OR denominator >= 0),
        opportunity_count INTEGER
          CHECK (opportunity_count IS NULL OR opportunity_count >= 0),
        unit TEXT NOT NULL CHECK (length(trim(unit)) > 0),
        comparison_scope TEXT CHECK (comparison_scope IS NULL OR comparison_scope IN (
          'mode','position','archetype')),
        reference_match_count INTEGER
          CHECK (reference_match_count IS NULL OR reference_match_count >= 0),
        source TEXT NOT NULL CHECK (source IN (
          'scoreboard','extended','timeline','derived')),
        source_quality TEXT NOT NULL CHECK (source_quality IN (
          'verified','retained','derived','legacy')),
        derivation_id TEXT NOT NULL CHECK (length(trim(derivation_id)) > 0),
        derived_at INTEGER NOT NULL CHECK (derived_at >= 0),
        PRIMARY KEY (
          game_id, puuid, participant_id, recipe_key, metric_key
        ),
        FOREIGN KEY (game_id, puuid, participant_id)
          REFERENCES match_participants (game_id, puuid, participant_id)
          ON DELETE CASCADE,
        FOREIGN KEY (recipe_key)
          REFERENCES rvi_recipe_storage_keys (recipe_key),
        CHECK ((raw_evidence_state = 'observed') = (raw_value IS NOT NULL)),
        CHECK ((score_evidence_state = 'observed') = (score_value IS NOT NULL)),
        CHECK (score_value IS NULL OR score_value BETWEEN 0 AND 1),
        CHECK (score_evidence_state <> 'observed' OR raw_evidence_state = 'observed')
      );

      INSERT INTO match_metric_observations
        (game_id, puuid, participant_id, recipe_key, metric_key,
         raw_evidence_state, raw_evidence_reason, raw_value,
         score_evidence_state, score_evidence_reason, score_value,
         numerator, denominator, opportunity_count, unit, comparison_scope,
         reference_match_count, source, source_quality, derivation_id, derived_at)
      SELECT observation.game_id, observation.puuid, observation.participant_id,
             (SELECT storage.recipe_key
              FROM rvi_recipe_storage_keys storage
              WHERE storage.algorithm_version = observation.algorithm_version
                AND storage.recipe_id = observation.recipe_id),
             observation.metric_key, observation.raw_evidence_state,
             observation.raw_evidence_reason, observation.raw_value,
             observation.score_evidence_state,
             observation.score_evidence_reason, observation.score_value,
             observation.numerator, observation.denominator,
             observation.opportunity_count, observation.unit,
             observation.comparison_scope, observation.reference_match_count,
             observation.source, observation.source_quality,
             observation.derivation_id, observation.derived_at
      FROM match_metric_observations_v29 observation;

      DROP TABLE match_metric_observations_v29;

      CREATE INDEX idx_metric_observations_owner_recipe_history
        ON match_metric_observations
          (puuid, recipe_key, participant_id, game_id, metric_key);
      CREATE INDEX idx_metric_observations_match_recipe_detail
        ON match_metric_observations
          (game_id, puuid, recipe_key, participant_id, metric_key);

      CREATE VIEW match_metric_observation_details AS
      SELECT observation.game_id,
             observation.puuid,
             observation.participant_id,
             storage.algorithm_version,
             storage.recipe_id,
             recipe.calibration_id,
             observation.metric_key,
             observation.raw_evidence_state,
             observation.raw_evidence_reason,
             observation.raw_value,
             observation.score_evidence_state,
             observation.score_evidence_reason,
             observation.score_value,
             observation.numerator,
             observation.denominator,
             observation.opportunity_count,
             observation.unit,
             observation.comparison_scope,
             observation.reference_match_count,
             observation.source,
             observation.source_quality,
             observation.derivation_id,
             observation.derived_at
      FROM match_metric_observations observation
      JOIN rvi_recipe_storage_keys storage
        ON storage.recipe_key = observation.recipe_key
      JOIN rvi_recipes recipe
        ON recipe.algorithm_version = storage.algorithm_version
       AND recipe.recipe_id = storage.recipe_id;

      CREATE TRIGGER rvi_selection_insert_requires_purge
      BEFORE INSERT ON rvi_recipe_selections
      WHEN EXISTS (
        SELECT 1
        FROM match_metric_observations observation
        JOIN rvi_recipe_storage_keys storage
          ON storage.recipe_key = observation.recipe_key
        WHERE storage.algorithm_version = NEW.algorithm_version
          AND storage.recipe_id <> NEW.recipe_id
      )
      BEGIN SELECT RAISE(ABORT, 'rvi_recipe_purge_required'); END;

      CREATE TRIGGER rvi_selection_update_requires_purge
      BEFORE UPDATE OF algorithm_version, recipe_id ON rvi_recipe_selections
      WHEN (OLD.algorithm_version <> NEW.algorithm_version
            OR OLD.recipe_id <> NEW.recipe_id)
        AND (
          EXISTS (
            SELECT 1
            FROM match_metric_observations observation
            JOIN rvi_recipe_storage_keys storage
              ON storage.recipe_key = observation.recipe_key
            WHERE storage.algorithm_version = OLD.algorithm_version
          )
          OR EXISTS (
            SELECT 1
            FROM match_metric_observations observation
            JOIN rvi_recipe_storage_keys storage
              ON storage.recipe_key = observation.recipe_key
            WHERE storage.algorithm_version = NEW.algorithm_version
              AND storage.recipe_id <> NEW.recipe_id
          )
        )
      BEGIN SELECT RAISE(ABORT, 'rvi_recipe_purge_required'); END;

      CREATE TRIGGER rvi_selection_delete_requires_purge
      BEFORE DELETE ON rvi_recipe_selections
      WHEN EXISTS (
        SELECT 1
        FROM match_metric_observations observation
        JOIN rvi_recipe_storage_keys storage
          ON storage.recipe_key = observation.recipe_key
        WHERE storage.algorithm_version = OLD.algorithm_version
      )
      BEGIN SELECT RAISE(ABORT, 'rvi_recipe_purge_required'); END;

      CREATE TRIGGER metric_observation_selected_recipe_insert
      BEFORE INSERT ON match_metric_observations
      WHEN NOT EXISTS (
        SELECT 1
        FROM rvi_recipe_storage_keys storage
        JOIN rvi_recipe_selections selection
          ON selection.algorithm_version = storage.algorithm_version
         AND selection.recipe_id = storage.recipe_id
        WHERE storage.recipe_key = NEW.recipe_key
      )
      BEGIN SELECT RAISE(ABORT, 'metric_observation_recipe_is_not_selected'); END;

      CREATE TRIGGER metric_observation_selected_recipe_update
      BEFORE UPDATE OF recipe_key ON match_metric_observations
      WHEN NOT EXISTS (
        SELECT 1
        FROM rvi_recipe_storage_keys storage
        JOIN rvi_recipe_selections selection
          ON selection.algorithm_version = storage.algorithm_version
         AND selection.recipe_id = storage.recipe_id
        WHERE storage.recipe_key = NEW.recipe_key
      )
      BEGIN SELECT RAISE(ABORT, 'metric_observation_recipe_is_not_selected'); END;
    `,
  },
  {
    // High-volume snapshot bodies are immutable and read as whole JSON values.
    // Keep their relational identity/timestamps queryable while storing the
    // body inline as deterministic gzip with independently verified metadata.
    version: 31,
    rebuildsReferencedTable: true,
    up: `
      CREATE TABLE live_game_snapshots_v31 (
        game_id       INTEGER NOT NULL,
        puuid         TEXT    NOT NULL,
        game_time_ms  INTEGER NOT NULL,
        captured_at   INTEGER NOT NULL,
        reason        TEXT    NOT NULL CHECK (reason IN ('first', 'periodic', 'state_change')),
        has_active_player_stat_runes INTEGER NOT NULL
          CHECK (has_active_player_stat_runes IN (0, 1)),
        snapshot_encoding TEXT NOT NULL CHECK (snapshot_encoding = 'gzip_json_v1'),
        snapshot_uncompressed_bytes INTEGER NOT NULL
          CHECK (snapshot_uncompressed_bytes > 0),
        snapshot_compressed_bytes INTEGER NOT NULL
          CHECK (snapshot_compressed_bytes >= 18),
        snapshot_sha256 TEXT NOT NULL CHECK (
          length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        snapshot_payload BLOB NOT NULL CHECK (
          typeof(snapshot_payload) = 'blob'
          AND length(snapshot_payload) = snapshot_compressed_bytes
        ),
        PRIMARY KEY (game_id, puuid, game_time_ms)
      );

      CREATE TABLE grade_calibration_snapshots_v31 (
        calibration_id TEXT PRIMARY KEY,
        calibration_hash TEXT NOT NULL UNIQUE CHECK (length(calibration_hash) = 64),
        reference_population_json TEXT NOT NULL CHECK (json_valid(reference_population_json)),
        sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
        snapshot_encoding TEXT NOT NULL CHECK (snapshot_encoding = 'gzip_json_v1'),
        snapshot_uncompressed_bytes INTEGER NOT NULL
          CHECK (snapshot_uncompressed_bytes > 0),
        snapshot_compressed_bytes INTEGER NOT NULL
          CHECK (snapshot_compressed_bytes >= 18),
        snapshot_sha256 TEXT NOT NULL CHECK (
          length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        snapshot_payload BLOB NOT NULL CHECK (
          typeof(snapshot_payload) = 'blob'
          AND length(snapshot_payload) = snapshot_compressed_bytes
        ),
        created_at INTEGER NOT NULL
      );
    `,
    migrate: migrateCompressedSnapshotBodies,
    after: `
      DROP TABLE live_game_snapshots;
      ALTER TABLE live_game_snapshots_v31 RENAME TO live_game_snapshots;
      CREATE INDEX idx_live_snapshots_owner
        ON live_game_snapshots (puuid, game_id, game_time_ms);

      DROP TRIGGER grade_calibration_snapshots_immutable_update;
      DROP TABLE grade_calibration_snapshots;
      ALTER TABLE grade_calibration_snapshots_v31
        RENAME TO grade_calibration_snapshots;
      CREATE TRIGGER grade_calibration_snapshots_immutable_update
      BEFORE UPDATE ON grade_calibration_snapshots
      BEGIN SELECT RAISE(ABORT, 'grade_calibration_snapshot_is_immutable'); END;
    `,
    verify: (db) => {
      if ((db.pragma("foreign_key_check") as unknown[]).length > 0) {
        throw new Error("snapshot_body_migration_foreign_key_violation")
      }
    },
  },
  {
    // The selected v11 source is the compact timeline authority. Preserve one
    // LCU and one Match-V5 candidate, promote the compatibility cache's only
    // raw bodies into the canonical gzip store, then remove the duplicate
    // cache only after byte/hash/coverage verification succeeds.
    version: 32,
    up: TIMELINE_STORAGE_V32_UP,
    migrate: migrateTimelineStorageV32,
    after: TIMELINE_STORAGE_V32_AFTER,
    verify: verifyTimelineStorageV32,
  },
]

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0

export function executeMigration(db: Database, migration: Migration) {
  db.exec(migration.up)
  migration.migrate?.(db)
  if (migration.after) db.exec(migration.after)
  migration.verify?.(db)
}

export function applyMigrations(db: Database): number {
  const current = db.pragma("user_version", { simple: true }) as number

  const pending = migrations.filter((migration) => migration.version > current)
  if (pending.length === 0) return current

  const latest = pending[pending.length - 1].version
  const foreignKeysWereEnabled = Number(db.pragma("foreign_keys", {
    simple: true,
  })) === 1
  const suspendForeignKeys = foreignKeysWereEnabled && pending.some((migration) =>
    migration.rebuildsReferencedTable)
  if (suspendForeignKeys) db.pragma("foreign_keys = OFF")
  try {
    db.transaction(() => {
      for (const migration of pending) {
        executeMigration(db, migration)
      }
      db.pragma(`user_version = ${latest}`)
    })()
  } finally {
    if (suspendForeignKeys) db.pragma("foreign_keys = ON")
  }

  return latest
}
