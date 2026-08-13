# Recall refactor implementation report

Date: 2026-08-12

This report records the first two implementation tranches from the
[codebase audit](./codebase-audit-2026-08-12.md) and
[refactor roadmap](./refactor-roadmap-2026-08-12.md). The tranche deliberately
keeps Grade/RVI math, visible behavior, and normalized match facts unchanged.

## Safety baseline

- The repository consistently pins Node 22.23.1 and pnpm 9.15.9 in local,
  container, and CI configuration.
- The broken baseline was caused by an unreadable/corrupt local dependency
  tree, not a Vite or application configuration defect. A clean pinned install
  restored the toolchain without a lockfile change.
- Before production refactoring, the full baseline passed: 1,205 tests across
  134 files, TypeScript checking, and renderer/Electron builds.
- Three golden Grade/RVI characterization contracts now freeze recipe and
  calibration manifests, metric eligibility, exact Grade/Recall/RVI output,
  range semantics, and observed-zero versus unavailable evidence.

## Active database measurements

The active local database was inspected through a read-only SQLite connection.
No user database bytes were changed by the audit. It contained 203 matches and
2,146 participants in a 351,354,880-byte file (about 335 MiB), at schema v26.

| Area | Observed data | Consequence |
|---|---:|---|
| Raw source payloads | 2,261 rows | Raw evidence is useful and should remain durable. |
| Periodic history pages | 1,955 rows but only 21 unique hashes | Timestamped source IDs defeated primary-key deduplication. |
| History-page bodies | about 12.7 MiB compressed | A stable observation key now prevents identical polls from adding rows. |
| Metric observations | 61,380 rows; table about 42.0 MiB | Long recipe IDs repeated through three indexes are a high-value future normalization target. |
| Timeline sources | 507 rows; about 58.6 MiB | Multiple mapper generations retain overlapping timeline representations. |
| Timeline compatibility cache | 193 rows; about 40.5 MiB | Readers should move to one selected source before this cache is removed. |
| Live snapshots | 6,697 rows; about 58.3 MiB | Snapshot JSON was about 54.0 MiB; a gzip estimate was about 20% of that size. |
| Grade calibration snapshots | 5 rows; about 15.8 MiB | Raw JSON compressed to an estimated 6.6% of its current size. |

Every abandoned parallel-pipeline table removed by schema v28 was empty in the
active database. Active history backfill, match evidence, label, timeline,
export, and live-capture tables were not included in that removal.

## Implemented in this tranche

### Runtime and renderer cleanup

- Removed twelve production-unreachable Vue components, including the old
  MatchSheet/MatchDetail branch and its transitive children.
- Removed production-unreachable remediation/history coordinators, source-fact
  scaffolding, maintenance locks, old Champion Form, generic full-refresh code,
  test-only repository writers/deleters, and their isolated contract tests.
- Removed renderer API/navigation methods and Electron IPC handlers that only
  served that dead branch.
- Replaced tests that source-read the retired components with contracts for the
  live Review, scoreboard, match-stat, and skill UI.
- Added a repository dependency-graph check that rejects unreachable Vue
  components reachable from neither renderer entry nor another live module.
- Enabled TypeScript unused-local and unused-parameter errors in the renderer
  and Electron projects. Even after adding controllers, migrations, audit
  documentation, and regression coverage, the final working tree is roughly
  1,300 net lines smaller than the starting tree.
- Removed verified unused arguments, imports, constants, and stale version
  comments from active match and analysis paths.

### Grade and RVI safety and naming

- Added exact golden characterization fixtures before changing active names.
- Replaced product-facing v3 recipe/calibration identifiers with opaque,
  immutable canonical identities while retaining the same definitions and
  calculations.
- Centralized exact recipe selection across Matches, Insights, Review, Data
  Trust, and the grading service. An installation holding the one known prior
  immutable identity keeps its original calibration foreign key, epochs,
  outputs, and deterministic bootstrap seed; an identity rename alone cannot
  trigger recalibration.
- Renamed the remaining numeric storage discriminator as an internal canonical
  storage partition. The legacy `algorithm_version` column and internal
  repository fields remain only as a persistence bridge; feature selection
  uses exact recipe identities, and renderer DTOs expose neither that numeric
  partition nor retired recipe names.
- Removed the Skill Report version field, legacy performance-profile input,
  cached-normal-score presentation fields, and the unused version-based
  regrade entry point.
- Historical migration text and third-party API versions remain truthful.

### Database and capture lifecycle

- Schema v27 adds deduplicated account-profile observations for Riot ID,
  summoner ID, profile icon, summoner level, platform, and regional route.
- Session startup and periodic/post-game sync record a new profile row only
  when those fields change. Generation guards prevent a disconnected or
  replaced client session from writing account-scoped data after an await.
- Schema v28 drops abandoned, unwired history/remediation, source-capture,
  versioned-label, compaction, maintenance, and release-journal experiments.
- Deleted the corresponding unwired repositories/services. Existing database
  opening already creates and verifies a pre-migration backup before applying
  these schema migrations to a user database.
- Schema v29 gives content-addressed source rows first/last observation times
  and an observation count. Periodic LCU history evidence now uses a stable
  page identity: unchanged bytes increment provenance without storing another
  blob, while changed bodies remain separately recoverable.
- A copy-only rehearsal against the active schema-v26 database migrated to v29
  with 204 matches and 2,156 participants unchanged, `quick_check` equal to
  `ok`, and zero foreign-key violations. It compacted 1,986 history payload
  rows to 22 distinct bodies while preserving an observation count of 1,986.
  The explicit source database is opened read-only; only its temporary backup
  is migrated.
- Repaired the repository data-integrity CLI for schema v29 and added an
  integration test that runs the real command against a temporary current
  database.

### Modularity, theming, and packaging

- Review-page data loading and mutations moved behind a typed feature
  composable, and timeline filtering/scrubbing/geometry moved behind a second
  typed controller. The rendered template and scoped styles stayed unchanged;
  mounted wiring tests now cover the page-to-controller boundary.
- Extracted the Data Trust and managed-backup IPC group from the Electron
  composition root behind typed dependencies and ordering tests.
- Semantic UI/chart colors now originate from one checked source and generate
  the CSS and TypeScript bridges used by DOM, canvas, and SVG renderers.
- Removed unused renderer Node polyfills.
- Narrowed the unpacked `better-sqlite3` package to its runtime JavaScript,
  manifest/license, and native binary, excluding build-only SQLite C sources
  and headers. The previous unpacked native tree contained about 11.7 MiB;
  only about 1.8 MiB was the runtime binary.
- The packaged-runtime smoke check passed. Compared with the previous unpacked
  build, total output fell from 281.6 MiB to 271.7 MiB and the native unpacked
  tree fell from 11.73 MiB to 1.85 MiB, with offline assets unchanged.

## Final verification

- Repository reachability/naming hygiene and generated-theme drift checks pass.
- Both TypeScript projects pass with unused-symbol enforcement enabled.
- All 1,211 Vitest tests across 137 files pass, including exact Grade/RVI
  characterization and frozen-installation upgrade compatibility.
- Renderer, Electron main, and preload production builds pass.
- Both Electron end-to-end smoke tests pass against the real built app.
- Native SQLite loads in the Node test ABI and Electron ABI.
- A fresh unpacked package is 271.7 MiB. Its post-package verifier found only
  the expected runtime native files and executed a successful in-memory query
  through the packaged `better-sqlite3` binary.

## Second consolidation tranche

The next storage, responsiveness, and renderer slices were implemented after
the baseline above. They preserve the same normalized match facts and frozen
Grade/RVI behavior.

### Compact canonical storage

- Schema v30 stores the selected RVI recipe/calibration identity once behind a
  compact integer key. The physical metric-observation table no longer repeats
  long recipe strings in every row and index; a read-only view preserves the
  previous exact query contract. A copied schema-v29 rehearsal preserved all
  62,620 observations and reduced metric table/index trees from 158,830,592 to
  33,001,472 bytes (79.2%).
- Schema v31 stores immutable live-game and Grade calibration JSON bodies as
  deterministic gzip with explicit encoding, compressed/uncompressed byte
  lengths, and a SHA-256 of the original UTF-8 bytes. Corruption, trailing
  data, invalid UTF-8/JSON, and metadata mismatches fail closed. A copied
  rehearsal preserved 7,230 live snapshots and six calibration snapshots,
  reducing their text bodies from 87,891,125 to 13,673,585 bytes and their
  database trees from 93,483,008 to 20,451,328 bytes.
- Schema v32 makes `match_timeline_sources` the sole compact timeline
  authority. It promotes raw cache-only bodies into the content-addressed raw
  evidence store, retains one current candidate per source, prefers Match-V5
  over the local client, recomputes source metadata through one implementation,
  and removes `match_timeline_cache` only after byte/integrity checks pass.
- These rebuilds deliberately do not run `VACUUM`. Freed SQLite pages are
  immediately reusable without an additional long, disk-intensive rewrite.

### Main-process responsiveness

- A dedicated analysis worker now owns its own SQLite connection for Grade
  reference rebuilds, automatic reference freezing, Skill Report composition,
  RVI profile reads/calculation, and match-summary CSV generation/hashing.
- Long read jobs use a consistent SQLite snapshot, release it before CPU work,
  and reject results if the active account or stats revision changed while the
  job ran. Rebuild progress remains streamed to the renderer and shutdown
  drains/terminates the worker before closing the main connection.
- The production build emits the worker as a separate Electron entry, and the
  packaged-runtime verifier launches it in addition to executing a native
  SQLite query.

### Additional modularity and cleanup

- Dashboard recent-game and champion-form panels moved into feature
  components. `DashboardPage.vue` fell by roughly 25% while the extracted
  components use semantic UI tokens rather than new color literals.
- Removed more production-unreachable backend modules and test-only repository
  methods. Focused tests now seed fixtures through production APIs or local SQL
  rather than keeping callable compatibility writers alive.
- Account profile snapshots retain Riot ID, summoner ID, profile icon, level,
  platform, and route on change, with session-generation checks around async
  refreshes. Champion/skin ownership remains deferred until real LCU fixtures
  establish a truthful contract.

### Database safety note

While the second tranche was being developed, a separately running Recall
development instance noticed the new v30 code and performed the application's
normal guarded migration of the active profile. The managed pre-migration
backup remains intact at schema v29 with SHA-256
`0dbb8ac7532d2b966aabbe39dea130a77a571d033e13f9e90ace80533404dc3a`.
The resulting active schema-v30 database passed `quick_check`, has no pending
WAL bytes, and was not opened read-write by the rehearsal tools. All later
schema rehearsals use a read-only source and migrate only an OS-temporary copy.

## Deliberately deferred

These are the next high-value slices, not omissions to hide inside this mixed
cleanup change:

1. Make historical live-position repair explicitly one-shot. Its current
   startup repair can re-decode every retained live snapshot; a durable
   account/game completion marker is safer than silently limiting its window.
2. Capture champion/skin inventory only after recording real LCU endpoint
   fixtures and proving ownership fields; do not infer ownership from the
   static champion catalog.
3. Continue extracting the remaining Electron feature routers and lifecycle
   controllers so `index.ts` becomes a small composition root.
4. Continue component extraction and semantic-token migration one feature at a
   time, using visual and interaction equivalence gates.
5. Expand repository reachability enforcement beyond Vue components to pages
   and exported TypeScript symbols with syntax-aware analysis. The current
   lightweight component import graph remains deliberately narrow until then.

The first tranche intentionally removes only structures proven unreachable or
empty and adds only source-compatible capture. Larger storage rewrites remain
separate because they require copied-database rehearsal and before/after query
manifests.
