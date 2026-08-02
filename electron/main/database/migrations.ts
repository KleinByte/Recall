import type { Database } from "better-sqlite3"
import {
  BOT_QUEUE_IDS,
  LEAGUE_CLASSIC_PVP_QUEUE_IDS,
} from "../matches/eligibility.js"

interface Migration {
  version: number
  up: string
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
]

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0

export function applyMigrations(db: Database): number {
  const current = db.pragma("user_version", { simple: true }) as number

  const pending = migrations.filter((migration) => migration.version > current)
  if (pending.length === 0) return current

  const latest = pending[pending.length - 1].version

  db.transaction(() => {
    for (const migration of pending) {
      db.exec(migration.up)
    }
    db.pragma(`user_version = ${latest}`)
  })()

  return latest
}
