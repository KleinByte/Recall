# Recall refactor roadmap

Date: 2026-08-12

Companion audit: [codebase-audit-2026-08-12.md](./codebase-audit-2026-08-12.md)

## Outcome

The target is a smaller, modular Recall with one canonical Grade/RVI system,
one authoritative database representation per concept, complete and honest LCU
capture, background execution for long work, and a renderer built from shared
tokens and components. Current user-visible calculations, labels, data, and
workflows remain unchanged unless a separate product decision explicitly
approves a change.

## Non-negotiable invariants

- The same match evidence produces the same Grade letter, Recall Score,
  compatibility score, component values, RVI metrics, and eligibility status.
- Existing raw payload hashes and normalized source facts are not discarded by
  a derived-data cleanup.
- Missing, unavailable, no-opportunity, not-applicable, invalid, and observed
  zero remain distinct.
- ARAM, Mayhem, League Classic, and Rift scopes remain separate where they are
  separate today.
- Opponent data and augments already captured remain available.
- Optional Match-V5 use remains explicit; normal tracking remains local-first.
- Schema changes create and verify a backup before destructive work.
- Renderer refactors preserve screenshots, keyboard behavior, focus,
  accessibility names, and loading/error behavior.

## Phase 0: Establish the safety baseline

Priority: immediate. Do not start destructive cleanup before this phase passes.

1. Repair the pinned local toolchain and dependency install.
2. Run the full current verification suite and save the result.
3. Create a sanitized representative database fixture containing:
   - Rift, ARAM, Mayhem, and League Classic matches
   - complete and partial lobbies
   - observed zero and unavailable evidence
   - raw LCU summaries/details/timelines
   - live snapshots/events
   - augments for owner and opponents
   - current Grade and RVI artifacts
4. Export a golden behavior manifest from that fixture:
   - per-match Grade/Recall/RVI output
   - aggregate dashboard/champion/skill results
   - match counts and source-payload hashes
   - schema/table/index inventory
5. Capture Playwright screenshots for every top-level page and the review tabs.
6. Record performance and size baselines:
   - startup-to-first-render
   - IPC p50/p95 for major queries
   - Grade rebuild duration and longest main-thread stall
   - database bytes per 100 matches and per live-captured match
   - renderer, ASAR, installer, and unpacked sizes

Exit gate: the baseline is reproducible on a clean checkout and can detect any
front-facing or data change.

## Phase 1: Remove proven dead code and stop adding compatibility debt

Risk: low.

1. Delete the unreferenced Vue components identified in the audit, including
   the dead `MatchSheet`/`StyleRadar` branch.
2. Replace tests that read dead component source with current behavior tests.
3. Enable `noUnusedLocals` and `noUnusedParameters` for application code,
   fixing or explicitly naming intentionally unused callback arguments.
4. Remove verified unused imports, constants, arguments, and comments.
5. Add repository hygiene checks that reject:
   - new `v3`/`v4` Recall algorithm names outside an explicit allowlist
   - new `legacy`/`compatibility` code without an owner and removal condition
   - unreferenced UI components
6. Decide whether the unwired version-22 history/remediation design will ever be
   shipped. Given the local-first hobby-project goal, the default recommendation
   is to delete the unwired coordinator/services and their empty tables rather
   than replace the working simple backfill path with a larger system.

Exit gate: production behavior and golden manifests are identical; dead-code
checks pass.

## Phase 2: Canonicalize Grade and RVI without changing formulas

Risk: high. Keep this phase isolated from UI and formula work.

1. Freeze exact current recipe fixtures before renaming anything.
2. Rename source modules and public types around domain concepts:
   - `MatchGradeRecipe`, `RviRecipe`, `GradingService`
   - `CURRENT_GRADE_RECIPE`, `CURRENT_RVI_RECIPE`
   - no `v3` in filenames, symbols, comments, UI text, or error messages
3. Keep one immutable `recipe_id`, recipe hash, and calibration ID. Remove
   `algorithm_version` from application DTOs and query APIs.
4. Replace per-algorithm selection tables with singleton current selections, or
   one `derived_recipe_state` row containing the selected Grade/RVI recipe IDs.
5. Remove compatibility writers and their runtime guards.
6. Replace hard-coded version predicates with exact selected-recipe joins.
7. Preserve the current formula/threshold definition byte-for-byte where
   possible. If serialization names must change, compare semantic recipe
   manifests and all golden outputs rather than accepting numerical tolerance.
8. Update current methodology docs. Archive dated v3 plans; do not rewrite
   historical documents in place.

Exit gate: every golden Grade/RVI value is exact; the renderer receives no
algorithm version; no active Recall code or UI uses `v3`.

## Phase 3: Consolidate the schema and storage lifecycle

Risk: high.

### 3.1 Support policy

Support one bridge from the latest released schema (currently v26) to the new
canonical schema. For new installs, create the canonical schema directly from
a baseline SQL file. Older databases should be backed up and either upgraded
through the last compatible release or explicitly reinitialized/imported. This
is the practical way to stop carrying 26 hobby-project migrations forever
without silently abandoning current users.

### 3.2 Grade/RVI tables

1. Make canonical Grade results and breakdowns the sole authority.
2. Remove `match_grade_breakdowns` and other pre-canonical artifact tables.
3. Remove Grade cache columns from `matches` and `match_participants` unless a
   measured query requires a denormalized owner-current view.
4. If denormalization is required, maintain one explicit materialized current
   owner-grade table, not copied fields on two aggregates.
5. Key RVI observations by recipe ID, participant, match, and metric; remove
   the redundant algorithm key.

### 3.3 Labels and timelines

1. Keep one label evaluation and label result model; drop unused versioned
   label tables.
2. Make `match_timeline_sources` the authoritative compact timeline store.
3. Remove `match_timeline_cache` after all readers use source selection
   directly.
4. Keep raw timeline bytes only in the raw evidence store; do not duplicate raw
   JSON in compatibility cache columns.

### 3.4 Raw evidence and retention

Use two layers:

- `source_payloads(payload_hash, encoding, payload, byte_count, created_at)`
- `source_captures(owner, source, source_match_id, kind, payload_hash,
  mapper_id, fetched_at, mapping_status, ...)`

Identical bytes are stored once. Captures preserve when and where they were
observed. Add policies for:

- repeated identical history pages: keep first/last observation, not a new blob
- per-match summary/detail/timeline: retain indefinitely by default
- live snapshots/events: retain raw until compact output is verified, then
  prune according to a user-visible storage policy
- derived observations: always rebuildable and safe to replace

### 3.5 Schema verification

After migration, verify foreign keys, integrity check, payload hashes, match and
participant counts, owner uniqueness, current-recipe completeness, and golden
query outputs before deleting the backup.

Exit gate: one table path per concept, no compatibility cache refresh, bounded
history-page growth, and exact data parity.

## Phase 4: Expand local player and collection capture

Risk: medium. This phase adds data but should not alter current features.

1. Add a generic raw LCU capture service for non-match endpoints.
2. Capture session/account profile responses and normalize:
   - PUUID and summoner ID
   - Riot ID/display name
   - profile icon
   - summoner level
   - region/platform
   - observation timestamp and source payload hash
3. Capture champion inventory as raw evidence. Normalize ownership only after
   verifying actual payload fields; store owned champion IDs/count and free
   rotation state separately from the static champion catalog.
4. Inspect the connected client's local OpenAPI/Swagger schema for inventory
   and skin endpoints. Capture representative fixtures before defining a skin
   schema. If available and stable, store owned skin IDs/count, ownership state,
   and last-observed time; do not store large skin artwork in SQLite.
5. Replace the Champions-page “owned” label with a proven ownership count, or
   relabel it until ownership is known.
6. Extend source manifests to all scoreboard fields and record unknown fields
   by payload/patch so mapper drift is visible.
7. Add a data-coverage dashboard for developers: source, field/category,
   applicable matches, observed, unavailable, invalid, ignored, and unknown.
8. Confirm opponent augments for Mayhem across LCU fixtures and expose coverage
   rather than assuming every post-game payload includes them.
9. Keep augment selection time nullable unless a verified source supplies it.

Exit gate: account level and verified collection totals survive restarts;
existing match and grading outputs remain exact; unknown LCU fields are visible
for future mapping.

## Phase 5: Modularize Electron and move long work off the main thread

Risk: medium-high.

1. Reduce `electron/main/index.ts` to bootstrapping and dependency composition.
2. Extract lifecycle controllers and feature IPC routers listed in the audit.
3. Introduce typed command/query boundaries:
   - commands mutate through the write coordinator
   - queries return renderer DTOs and never expose repository rows directly
4. Split large repositories into writer and query modules by feature.
5. Create a long-work worker for:
   - reference rebuild and all-match regrade
   - RVI observation rebuild
   - expensive insight/skill reports
   - raw compression/decompression batches
   - export hashing and large file operations
6. Give the worker a separate SQLite connection. Use WAL, busy timeouts,
   bounded batches, cancellation tokens, progress events, and shutdown drain.
7. Keep latency-sensitive post-game capture durable first. Schedule derived
   grading/analytics after the raw transaction commits.
8. Add event-loop delay and IPC latency instrumentation in development builds.

Exit gate: window/tray/LCU events remain responsive during a full rebuild and a
large export; crash recovery leaves raw data intact.

## Phase 6: Finish the renderer component and theme system

Risk: medium.

### 6.1 One theme source

1. Define theme tokens in one typed data file.
2. Generate CSS custom properties and TypeScript chart/canvas constants from
   that source.
3. Separate primitive palette tokens from semantic UI roles.
4. Complete semantic scales for typography, spacing, radius, elevation,
   control sizes, motion, breakpoints, and chart styling.

### 6.2 Shared primitives

Complete and document primitives for buttons, fields, selects, dialogs, tabs,
panels, stat tiles, tables, badges, toolbars, empty/error/loading states, stack,
cluster, and responsive grid. Use variants rather than page-specific copies.

### 6.3 Feature migration order

Migrate in small visual-equivalence slices:

1. Review page
2. Performance Profile / Skill page
3. Dashboard
4. Progress
5. Live Game
6. remaining pages and overlays

For Review, first extract view-model composables, then tab panels, then shared
styles. For Performance Profile, split overview, arms, context, measurement
detail, and disclosure panels before consolidating its 1,000+ style lines.

### 6.4 Enforcement

Add lint/hygiene rules that reject new raw color literals and repeated spacing/
font values outside token, chart geometry, SVG, map-coordinate, and breakpoint
allowlists. Remove old token aliases only after usage reaches zero.

Exit gate: changing the typed theme source updates CSS and charts; no active
component uses legacy palette aliases or global `.league-*` controls; approved
screenshots are unchanged.

## Phase 7: Reduce package size and documentation surface

Risk: low-medium.

1. Narrow the `better-sqlite3` unpack/exclusion rules and verify native loading
   from a packaged smoke build.
2. Remove renderer node polyfills if the clean build confirms they are unused.
3. Generate an asset usage report from templates, scripts, JSON catalogs, and
   runtime URL builders.
4. Losslessly optimize maps/icons and evaluate WebP for images where Electron
   rendering is visually identical.
5. Keep offline assets needed for current features; avoid bundling build-time
   source or duplicated website artwork in the desktop package.
6. Set budgets for renderer entry, total renderer JS, app-specific ASAR,
   unpacked native app files, and static assets.
7. Consolidate current documentation and archive/remove completed plans as
   described in the audit.

Exit gate: packaged smoke and update checks pass; size is measurably lower; the
current architecture and data contract can be understood without reading dated
implementation plans.

## Hot-file execution order

| Order | File/area | Refactor goal |
|---:|---|---|
| 1 | `match-grading-service.ts` + Grade/RVI recipe/store modules | Freeze behavior, remove version/cutover branching, separate rebuild job from per-match grading |
| 2 | `migrations.ts` and current schema | Produce canonical baseline and one v26 bridge; remove empty/duplicate structures |
| 3 | `index.ts` | Extract controllers and IPC routers; define worker boundary |
| 4 | `matches-repo.ts` / `participants-repo.ts` | Separate ingestion, queries, labels, augments, and compatibility removal |
| 5 | `match-source-repo.ts` / timeline stores | Content-address payloads, stop history-page duplication, remove compatibility cache |
| 6 | `ReviewPage.vue` | Extract composables and tab components with screenshot parity |
| 7 | `PerformanceProfile.vue` | Split panels and move repeatable styles to primitives/tokens |
| 8 | `insights-repo.ts` / `skill-report.ts` | Feature query modules and worker execution |
| 9 | remaining renderer hotspots | Continue component/token migration by measured reuse |

## Pull-request strategy

Keep changes reviewable and bisectable:

- PR 1: baseline fixtures, measurements, and toolchain repair
- PR 2: dead code and unused symbols
- PR 3: Grade/RVI naming-only refactor
- PR 4: canonical Grade/RVI schema bridge
- PR 5: source-payload deduplication and retention
- PR 6: timeline/label/history table consolidation
- PR 7: account/inventory capture
- PR 8: Electron controllers and IPC routers
- PR 9: analytics worker
- PRs 10+: one renderer feature migration each
- final PR: packaging and documentation cleanup

Never combine formula changes, schema consolidation, worker migration, and UI
recomposition in the same PR.

## Definition of done

- No active Recall Grade/RVI source, schema, DTO, error, or UI name contains a
  product-facing algorithm version.
- One selected Grade recipe and one linked RVI recipe are authoritative.
- Golden Grade/RVI and aggregate outputs are exact.
- The schema contains no unwired or duplicate compatibility tables.
- Raw evidence is content-addressed and repeated page growth is bounded.
- Summoner level and verified ownership/collection totals are persisted.
- All long rebuild/export/analytics work is off the Electron main event loop.
- `index.ts`, repositories, and renderer pages have feature-focused boundaries.
- Theme values have one source and active UI uses shared semantic tokens.
- Dead components and stale source-reading tests are gone.
- Packaged app size is lower without losing offline fidelity.
- Full verification, migration rehearsal, integrity checks, packaged smoke, and
  visual regression checks pass on a clean pinned environment.

## Implementation status — 2026-08-12

Completed in the first two tranches:

- Safety baseline, exact Grade/RVI characterization, pinned toolchain repair,
  and copied-database migration rehearsal.
- Proven dead-code deletion and unused-symbol enforcement.
- Canonical product naming with exact immutable recipe compatibility for data
  already stored under the prior identity.
- Account-profile history, bounded history-page observations, abandoned-table
  removal, compact metric recipe keys, compressed snapshot/calibration bodies,
  and authoritative timeline-source storage through schema v32.
- A dedicated analysis worker for reference rebuild/freeze, Skill Report, RVI
  profile, and match-summary export workloads.
- Review and Dashboard feature extraction, one generated color source, and a
  smaller verified native package.

Still open:

- Champion and skin ownership capture, pending real multi-account LCU fixtures.
- A one-shot completion contract for historical live-position repair.
- More Electron router/controller extraction and repository query boundaries.
- Performance Profile, Progress, Live Game, and remaining renderer token/
  component migration.
- Syntax-aware reachability checks for exported TypeScript and pages, asset
  usage/optimization, and the longer-term canonical fresh-install schema plus
  single supported released-schema bridge.
