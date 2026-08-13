# Recall codebase audit

Date: 2026-08-12

## Executive summary

Recall has good foundations, but several migrations were started without being
finished. The application already has a raw-source archive, strong grading
tests, semantic design tokens, lazy-loaded pages, and a small dependency set.
The largest maintenance problems come from running old and new storage designs
side by side, keeping compatibility caches after the canonical path is active,
and allowing page-level Vue files to grow their own component and styling
systems.

The recommended target is one **canonical Grade and RVI implementation** with
no product-facing `v3` naming. Its formulas, thresholds, and outputs should stay
unchanged. Internally, an immutable recipe hash and calibration identity should
remain because they prove what produced stored derived data. That is data
provenance, not product-version ceremony.

The database should likewise have one authoritative representation for each
concept. Raw LCU evidence should be retained in a content-addressed archive;
normalized match facts should be easy to query; Grade/RVI should be derived and
rebuildable. Current duplicate or unwired tables should be removed after a
verified migration.

No production behavior was changed during this audit.

## Scope and limits

This was a static audit of the repository, generated build output, schema
migrations, source ingestion, Grade/RVI paths, renderer architecture, and test
suite structure. There was no user `stats.db` in the workspace, so actual row
counts, database size, query plans against real data, and field completeness
rates could not be measured. Those measurements are a required first step
before destructive schema work.

The checked-out dependency tree cannot currently execute Vitest or the strict
TypeScript audit: Vite cannot resolve `rollup/parseAst`, and the available
Node/pnpm versions do not match the pinned toolchain. Existing `dist` and
`release/3.1.0` output show that the project built recently, but a clean pinned
install is required before refactoring begins.

## Baseline

| Area | Current baseline |
|---|---:|
| Renderer source | 149 TS/Vue/CSS files, about 33,530 lines |
| Electron source | 107 TypeScript files, about 33,868 lines |
| Tests | 137 TypeScript/Vue-related files, about 22,744 lines |
| Vue components/pages | 89 files, about 26,751 lines |
| Scoped component styles | 82 Vue files |
| Current schema | 26 sequential migrations in one 1,781-line file |
| Electron composition root | 2,516 lines, 64 imports, 42 mutable globals, 82 functions, 95 IPC handlers |
| Renderer build | 15.65 MiB; 12.72 MiB is PNG data |
| Current unpacked app | about 281.6 MiB for `release/3.1.0` |
| App-specific ASAR | 18.1 MiB, plus an unpacked native module tree |

The renderer already code-splits pages and ECharts. The 646 KiB chart engine is
lazy and is not the main size problem. Static game assets and the broad
`better-sqlite3` unpack rule are better optimization targets.

## Findings by priority

### P0: Canonical Grade/RVI naming is entangled with historical cutover logic

The current formulas appear to be centralized and deliberate, but the active
path is surrounded by version and compatibility machinery:

- `MATCH_GRADE_ALGORITHM_VERSION = 3` and `RVI_ALGORITHM_VERSION = 3` are used
  throughout repositories, services, queries, schema keys, tests, and error
  messages.
- Recipe identifiers contain `recall.grade.v3` and `recall.rvi.v3`.
- `MatchGradingService` still detects and purges algorithms 1 and 2, checks for
  a direct v3 cutover, clears compatibility caches, and has hard-coded version
  predicates.
- `matches` and `match_participants` keep renderer cache columns while
  `match_grade_attempts`, `match_grade_results`, and
  `match_grade_breakdown_versions` keep the authoritative derived records.
- `match_grade_breakdowns` is an older parallel breakdown table that remains in
  the schema and compatibility queries.
- Legacy writers remain in `MatchesRepository.setGrade` and
  `ParticipantsRepository.setGrades`, guarded by runtime cutover checks.

Recommendation: remove product and source-code version names, but retain one
opaque, immutable recipe definition hash and calibration ID. Make `recipe_id`
the only identity for derived Grade/RVI data. Existing formulas and thresholds
must be frozen with golden tests before any rename or schema change.

This distinction matters. Removing `v3` is safe; removing all provenance would
make it impossible to tell whether a persisted score was produced by the
current formula or by stale code.

### P0: The database has parallel, unwired, and compatibility-only structures

The schema contains several designs that are not used by the production path:

- Production still uses the version-8 `riot_history_backfill` table,
  `RiotBackfillRepository`, and `RiotHistoryBackfill`.
- The version-22 `riot_history_runs`, `riot_match_ingestion`, and
  `riot_history_run_matches` path is isolated behind an unwired
  `RiotHistoryCoordinator` and `RiotHistoryImportRepository`.
- `HistoryRemediationService` and `match_enrichment_jobs` are not connected to
  the running app.
- `match_source_captures` and `match_source_capture_payloads` were introduced
  for a richer source manifest, but normal LCU sync writes the older
  `match_capture_manifests` path.
- Versioned label tables (`match_label_evaluation_versions` and
  `match_performance_label_versions`) are not used. Production writes
  `match_label_evaluations` and `match_performance_labels`.
- `artifact_publish_journal`, `maintenance_operations`, and
  `release_cleanup_state` have schema definitions but no production readers or
  writers.
- `live_capture_compactions` exists, but live snapshots/events are not
  compacted through it.
- `match_timeline_sources` is copied into `match_timeline_cache` by a function
  explicitly named `refreshTimelineCompatibilityCache`; raw timelines can also
  be present in `match_source_payloads`. One timeline may therefore exist in
  three representations.

There is also an unbounded growth issue in the active path. Every five-minute
sync stores a raw `history_page` under a source ID containing the current
timestamp, even when its content hash is unchanged. The primary key therefore
does not deduplicate identical pages. Match detail payloads use stable match
IDs and deduplicate correctly; history pages do not.

Recommendation: choose one production path per concept, migrate current data,
and remove the alternatives. Store raw bytes once by content hash and store
small capture/observation rows that reference that payload. Add explicit
retention rules for repeated history pages and verified live captures.

### P0: Expensive synchronous work can block Electron's main process

Most SQLite work uses synchronous `better-sqlite3` calls directly from the
Electron main process. Small point queries are appropriate there, but several
operations are not small:

- Grade reference rebuild loads all matches and participants, derives timeline
  evidence, grades every match, and writes every result inside one synchronous
  transaction.
- Calibration, RVI observation generation, skill reports, insights queries,
  raw gzip/gunzip, hashing, CSV generation, export, and restore work can all run
  on the process that owns windows, tray interactions, LCU events, and IPC.
- An `async` IPC handler does not move synchronous CPU or SQLite work off the
  event loop.
- The backup manager already demonstrates a worker-thread pattern, but it is
  not generalized for analytics and rebuild jobs.

Recommendation: create one database/analytics worker with its own SQLite
connection in WAL mode for long reads and rebuild jobs. Keep short transactional
writes serialized through the existing write coordinator. Report progress by
message and use bounded batches so cancellation and shutdown remain safe.

### P0: Data capture is stronger than it looks, but profile/inventory history is weak

The match pipeline already captures much of the requested data:

- Full LCU scoreboard details for all participants, including opponent identity
  when exposed, champion, items, spells, runes, combat/economy/vision/objective
  stats, positions, and extended metrics.
- Ordered Mayhem augments for every participant from post-game detail.
- Match-V5 augments for every participant when the optional import is used.
- Both teams, bans, and objectives.
- Live Client Data snapshots for both teams, levels, items, positions, scores,
  deaths/respawns, and events; the local player's full rune page is retained.
- Raw history summaries, scoreboard details, and timelines are gzip-compressed,
  hashed, and retained so future mappers can recover fields without another API
  request.
- Champion mastery is cached for encountered participants when LCU exposes it.

Important gaps and ambiguities remain:

- `summonerLevel` is read at session start but is not stored as account history.
- The champion inventory is stored as an `electron-store` catalog, not a
  database snapshot. Its normalized type discards ownership/collection fields
  that may be present in the raw LCU response.
- The Champions page says “of N owned,” but the catalog model only proves that
  champions were returned and visible; it does not model ownership explicitly.
- Skin ownership/count is not captured.
- Profile icon, Riot ID, summoner level, champion ownership, and collection
  changes do not share a normalized account-snapshot history.
- Augment selection timing is generally unknown. The code correctly marks
  timeline augment selection as “source unpromised”; it should not invent a
  timestamp from post-game slot order.
- Raw match data is durable, but raw account, mastery, champion inventory, and
  skin inventory responses do not use the same content-addressed source archive.

Recommendation: add account and inventory source captures using the same raw
evidence approach as matches. Normalize only verified, useful fields such as
summoner level, profile icon, owned champion count/IDs, and owned skin count/IDs.
Before adding skin fields, inspect the live client's own local OpenAPI/Swagger
schema and record real fixtures across at least two accounts/patches. LCU
shapes are private and can drift; runtime field manifests are safer than
assuming a community-documented shape.

Do not add hundreds of speculative match columns. The existing raw payload plus
an `extended_metrics_json` escape hatch is the right foundation. Promote a raw
field to a typed column only when it has a query, UI, or grading use case and a
validated source contract.

### P1: `electron/main/index.ts` is a service locator, scheduler, UI controller, and IPC router

The main entry point owns app lifecycle, windows, tray, overlay behavior, LCU
discovery/session state, live capture scheduling, sync, Riot history, backup,
Grade/RVI initialization, snapshots, validation helpers, repository factories,
and 95 IPC registrations. This makes unrelated changes collide and makes it
hard to identify which work is safe on the main thread.

Recommendation: leave `index.ts` as a composition root. Extract:

- `AppRuntime`/dependency container
- window, tray, and tempo-overlay controller
- LCU session controller
- sync scheduler
- post-game ingestion orchestrator
- maintenance/rebuild job controller
- feature-scoped IPC routers (`stats`, `matches`, `review`, `settings`,
  `maintenance`, `live`)

Routers should validate DTOs and call application services. They should not
contain SQL, data mapping, or long-running loops.

### P1: Repository boundaries are too broad

`MatchesRepository` is 1,819 lines and mixes ingestion, grade compatibility,
labels, summary analytics, champion aggregates, match paging, records, and
deletion. `ParticipantsRepository` mixes ingestion, capture manifests, Grade
compatibility, match detail, augments, and lobby analytics. `InsightsRepository`
is 1,480 lines and performs many unrelated reports.

Recommendation: split repositories by aggregate and workload:

- `MatchWriter` and `MatchReader`
- `MatchListQuery`, `SummaryQuery`, `ChampionStatsQuery`, `RecordsQuery`
- `ParticipantWriter`, `LobbyQuery`, `AugmentQuery`
- `GradeStore`, `RviObservationStore`, `LabelStore`
- feature-specific insight query objects

Share SQL fragments only through small tested helpers or views. Avoid a generic
repository abstraction that hides SQL; the current explicit SQL is valuable.

### P1: Several renderer files are page-sized applications

Highest-priority renderer hotspots include:

| File | Approx. lines | Main issue |
|---|---:|---|
| `ReviewPage.vue` | 1,331 | Match loading, annotations, experiments, timeline model, map playback, insights, and four page tabs in one component |
| `PerformanceProfile.vue` | 1,468 | Presentation logic plus about 1,022 style lines |
| `MatchPlaybackMap.vue` | 1,168 | Playback state, map rendering, event stacks, and large local styling |
| `MomentumGauge.vue` | 1,133 | Visualization, animation state, presentation, and about 747 style lines |
| `DashboardPage.vue` | 1,040 | Multiple data loaders, refresh coalescing, telemetry, form, RVI, ranked, and challenges |
| `ProgressPage.vue` | 1,071 | Several independent analysis panels and about 469 style lines |

Recommendation: use feature folders and composables. For example,
`features/review` should own `useMatchReview`, `useTimelinePlayback`,
`ReviewOverviewPanel`, `ReviewStatsPanel`, `ReviewTimelinePanel`,
`ReviewProbabilityPanel`, `SessionsPanel`, `BookmarksPanel`, and
`ExperimentsPanel`. Components should receive typed view models rather than the
entire API response.

### P1: The design system exists, but adoption is incomplete

`src/design/tokens.css`, `dial-tokens.css`, `theme.ts`, chart theme helpers, and
13 UI primitives are a solid base. The remaining renderer still contains:

- about 3,525 raw `px` literals outside the global token files
- 257 raw hex colors and 322 raw `rgb/rgba` colors outside the token files
- 125 uses of old `--surface-*` aliases, 184 `--gold*` uses, and other legacy
  aliases
- duplicated global `.league-button`/`.league-select` recipes and component
  equivalents
- only 28 source files directly importing the shared UI primitive layer

Not every pixel should become a token. SVG coordinates, chart geometry, map
positions, one-pixel borders, and responsive breakpoints can be local. Repeated
layout, typography, color, spacing, radius, shadow, motion, and control values
should be semantic tokens.

Recommendation: define a documented token API for typography scale, spacing,
control geometry, surfaces, state colors, charts, breakpoints, and motion. Add
layout primitives such as `Stack`, `Cluster`, `Grid`, `Toolbar`, `DataTable`,
and `Modal`. Migrate one feature at a time, then remove compatibility aliases
and global legacy classes.

`theme.ts` currently duplicates CSS color literals for canvas/SVG consumers.
Generate both CSS tokens and TypeScript chart tokens from one typed source so a
theme change is truly single-file.

### P1: App size work should target packaging and assets first

The current renderer is 15.65 MiB, of which 12.72 MiB is PNG. JavaScript is
about 1.55 MiB and already split. The unpacked Electron application is much
larger because Chromium is the fixed floor.

Actionable app-owned size issues:

- `public/items` contains 857 PNGs (about 5.47 MiB).
- `public/game-data` contains 223 files (about 7.12 MiB), including several
  large rune and map images.
- The `asarUnpack` glob includes the entire `better-sqlite3` package. The
  unpacked tree contains the 9.1 MiB SQLite C source in addition to the 1.8 MiB
  native binary.
- The renderer enables node polyfills even though no renderer source currently
  references `Buffer` or Node modules.
- Four font files total about 0.48 MiB; subsetting may help, but is lower value
  than the native package and image work.

Recommendation: narrow native unpacking, exclude build-only native sources,
remove unneeded renderer polyfills, losslessly optimize or convert supported
images, and build an asset usage manifest. Keep offline fidelity and verify the
packaged runtime after every packaging change.

### P2: Proven dead code and stale tests can be removed

No production imports were found for these components:

- `AramStatBox.vue`
- `ChampionStatsTable.vue`
- `DriftChart.vue`
- `LeagueDropdown.vue`
- `MatchSheet.vue`
- `ChampionPoolTreemap.vue`
- `PlayCalendarChart.vue`
- `StyleDeltaChart.vue`
- `StatCard.vue`

`StyleRadar.vue` is only imported by the unused `MatchSheet.vue`. Some tests
still read `MatchSheet.vue` directly even though production explicitly no
longer renders it. Those tests preserve dead architecture and should be
replaced with tests for the current Review page.

A strict unused-symbol pass also identified small candidates such as
`localIsTeamOne`, the unused `family` argument in `MatchSync.storeLobby`, unused
label input, unused Grade imports, and unused predictive-insight reference
constants. Re-run this check after repairing the pinned dependency tree before
deleting anything.

### P2: Historical planning documents obscure the current contract

The repository contains many dated implementation plans and specs, including a
roughly 5,879-line remediation plan and multiple v2/v3 design documents. They
are useful history but poor current documentation.

Recommendation: keep a small authoritative documentation set:

- architecture and data flow
- current Grade/RVI methodology without product-version naming
- current schema/data dictionary
- LCU data-source and privacy policy
- UI token/component system
- release and recovery runbook

Move completed plans to a clearly marked archive or remove them after their
durable decisions are incorporated into current docs. Do not mass-rewrite old
dated plans to pretend they were never versioned.

## Terms that should not be blindly removed

Some “legacy” or version strings are legitimate and should remain unless the
product behavior changes:

- Riot's `LEGACY` challenge category
- League Classic queue fallback identifiers
- `Match-V5` and LCU endpoint paths containing API versions
- database `user_version` and one supported migration bridge
- old user-data-directory adoption if current installs still need it
- evidence provenance such as unknown historical/legacy source quality
- app release version in `package.json`

The cleanup target is obsolete Recall algorithm/product versioning and temporary
compatibility code, not third-party API names or truthful provenance.

## Recommended target architecture

```text
LCU / Live Client / optional Match-V5
                |
                v
      content-addressed raw evidence
                |
                v
    source-specific mappers + manifests
                |
                v
  normalized matches / participants / teams
                |
                +----> canonical Grade recipe ----> Grade results
                |
                +----> canonical RVI recipe ------> metric observations
                |
                +----> labels / review / reports

Electron main process: lifecycle + short IPC
Worker process/thread: long SQLite reads, rebuilds, analytics, compression
Renderer: feature folders + shared UI primitives + generated theme tokens
```

Raw evidence is immutable. Normalized facts are remappable. Derived artifacts
are rebuildable. Only one current recipe is selected. The UI never needs to
know an algorithm version.

## Audit conclusion

The codebase does not need a rewrite. It needs a controlled consolidation:
freeze behavior, remove the unwired/compatibility branches, make recipe identity
opaque and singular, normalize the storage model, move heavy work off the main
thread, and finish the UI-system migration already underway. The accompanying
roadmap defines the order and gates required to do that without changing user
results.
