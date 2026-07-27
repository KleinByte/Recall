import type { Database } from "better-sqlite3"

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
]

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
