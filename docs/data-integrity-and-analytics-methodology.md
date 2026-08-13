# Data integrity and analytics methodology

Recall is client-first and works without a Riot API key. Routine sync uses the authenticated local League Client. Optional historical import is a user-started, resumable Match-V5 job limited to match lists, match details, and timelines; it never calls Account-V1 and never determines whether local operation is healthy.

## Evidence and eligibility

Recall preserves distinct evidence states for observed, unavailable, no opportunity, invalid, not applicable, and legacy-unknown facts. Observed zero is data. A known no-opportunity state may receive an explicitly declared neutral metric percentile and counts as covered; unavailable, invalid, and unknown data never silently become zero or observed evidence. Missing applicable core evidence withholds the match Grade. An arm keeps its immutable declared denominator: missing or no-opportunity secondary weight inherits the observed core bundle for arithmetic only, so absence cannot improve or reduce the core-only score. Coverage still records that the secondary evidence was not observed.

Stored matches are evaluated once for analytics, grading, and timeline eligibility. Duration is normalized to seconds and games shorter than 300 seconds are reported separately. Bot/tutorial, unmatched, unsupported, terminated, progression-ineligible, incomplete-lobby, and missing-source cases remain stored with reasons. A gradable lobby has exactly 10 unique participants, two teams of five, and exactly one owner; Arena and unknown future shapes remain mode-specific unknown.

## Derived analytics

- Recall Grade calibrates measurements into seven match arms: Combat, Positioning & Survival, Control & Utility, Economy, Objectives & Macro, Vision & Setup, and Initiative & Pressure. Within each tracked mode and rules scope, a frozen snapshot uses hierarchical mid-ECDF cohorts (mode, position, then primary archetype), then calibrates the responsibility-weighted arm composite. Sparse child cohorts shrink toward their parent. Calibration excludes the match being scored and counts a complete match as one independent cluster.
- Position determines opportunity and the champion's detailed archetype determines CORE, SECONDARY, or DIAGNOSTIC responsibility tiers. The authoritative 0–100 RoleFit score and letter come from the frozen final-composite percentile. The current-lobby percentile is stored separately for context and cannot set the letter.
- Every attempt, participant result, and breakdown records the exact Grade recipe and calibration identity. The selected RVI recipe separately names that exact Grade recipe and calibration plus its metric registry, arm policy, and timeline policy. Incomplete or source-unverifiable lobbies receive a reasoned non-ready attempt rather than a fabricated score.
- Champion ranking uses the selected mode scope's stored career games. At least five graded games are required for the main list; one to four are shown only as early signals. Ordering uses the authoritative average Recall Score, while thin/fair/solid labels disclose sample support.
- RVI aggregates only observations from the selected linked Grade/RVI recipes. Summoner's Rift match Grade uses seven applicable arms; ARAM and ARAM Mayhem use exactly Combat, Positioning & Survival, Control & Utility, and Economy. Career RVI is the equal mean of the available career arms, including the career-only Consistency & Versatility arm after at least 20 measured games. Stored RoleFit still retains coverage, effective sample size, confidence, and a deterministic 2,000-replicate bootstrap interval. See [Recall Vector Index](recall-vector-index.md).
- Skill Report condition findings compare a selected group with its true complement. Each arm needs eight games. The arithmetic-mean difference uses 2,000 deterministic 90-minute-session bootstrap draws, a two-sided bootstrap p-value, and Benjamini-Hochberg FDR at `q=0.10`.
- Review highlights use median/MAD robust effects with metric-specific floors. Recommendation direction compares a fixed latest ten with the preceding ten and requires interval evidence.

Analytical sessions use a 90-minute gap from the previous valid game end to the next start. Dashboard Momentum uses 30 minutes and is named separately. Calendar windows preserve the configured IANA timezone and local calendar boundaries through daylight-saving changes.

### Detailed metric observations

The metric registry defines scoreboard, retained-summary, and timeline measurements. Registration means the formula and evidence contract are known; it does not mean every source or match can supply the observation. The durable per-match row keeps raw evidence separate from calibrated score evidence and can retain the native unit, numerator, denominator, opportunity count, source quality, comparison scope, reference-match count, derivation identity, recipe, and calibration.

This lets Recall show partial evidence honestly. A known raw value can remain inspectable when a percentile cannot be calibrated. An unavailable score does not become zero or copy a career value. The RVI detail view groups observations as Core, Secondary, Diagnostic, or Unavailable / not applicable and discloses the raw value, formula, coverage, reference scope, share of its arm, and resulting Grade influence.

Core and secondary measurements with a declared arm weight participate when observed. Missing core evidence withholds the Grade. Missing or no-opportunity secondary evidence remains unavailable in the observation inventory and coverage, but its declared arithmetic mass inherits the observed core bundle (or, for an arm without a core metric, its observed secondary bundle). This fixed-denominator neutral-bundle rule prevents missing optional evidence from moving an otherwise supported score. Diagnostics have zero arm and Grade weight. Timeline observations are narrow retained-data proxies, not inferred intent. Takedown clusters are not a record of every fight, objective proximity requires a nearby retained frame, opposing-position phase deltas require an exact resolved matchup, and objective setup requires complete positioned ward-event evidence. Missing coordinates, identities, teams, opponents, events, or opportunities withhold only the affected observations.

## Provenance and repair

Raw local and optional Match-V5 payloads are stored as deterministic canonical gzip JSON with a SHA-256 of the uncompressed canonical bytes. Scoreboard capture manifests retain captured and missing categories plus unknown source names; raw payload mapping separately records pending, mapped, unmappable, or error state. Query-time champion ranking, RVI profile aggregates, and report values are invalidated by a local data revision rather than persisted as durable summaries. Their underlying Grade results and detailed metric observations are immutable, recipe-bound derived records. A Grade result also records its taxonomy, position resolver, core-fact contract, evidence policy, cluster policy, and frozen calibration snapshot; its linked RVI recipe records the accepted Grade recipe plus metric-registry, vector, and timeline identities.

Historical repair is explicit, preflighted, backup-gated, resumable, and idempotent. Legacy normalized zeroes cannot prove that a source field existed. Recall promotes old grade-core facts only when a retained, checksummed full-scoreboard payload decodes to exactly ten complete participants, every value agrees with the normalized lobby, and the independently stored duration agrees. Promotion is transactional and monotonic: LCU evidence cannot downgrade already verified Match-V5 provenance. Local repair performs no Web calls; optional Match-V5 repair is a separate user choice.

## Data Trust and lifecycle

Data Trust reports client health and optional Match-V5 history independently. “Client data healthy / Match-V5 history not configured” is healthy. Grade coverage uses current eligible grades divided only by gradable matches. Timeline and source coverage disclose missing signal categories rather than presenting one ambiguous completeness percentage.

Managed backup manifests record a content hash, schema, reason, release-sequence protection, and verified integrity. Retention reporting never proposes manual, pre-clear, currently protected, newest healthy, corrupt/unverified, or legacy-unclassified artifacts for automatic deletion.

The Match summary CSV is a summary, not a full backup. A full Recall backup is a lossless three-file `.recall-backup` directory containing the database, validated restorable settings, and a canonical checksummed manifest. It contains raw source bodies and player identifiers, but never the Riot API key, active-account pointer, or machine/cache settings.

Clear active history is recoverable: Recall first creates a protected verified pre-clear backup, then deletes only the selected account's active database rows in one transaction and disables collection. Existing backups, full exports, and CSV files remain. Removing the API key is a separate action. Recall makes no secure-erasure or redacted-export claim.

## Recipe compatibility and frozen reference

All readers resolve the same exact linked Grade/RVI selection. Recall accepts the canonical immutable recipe pair or an explicitly declared identity alias only when its arithmetic and evidence contracts match exactly. A valid alias retains its original calibration foreign key, frozen epochs, historical results, and deterministic confidence intervals; an identity-only rename never recalibrates against today’s cohort.

For an incompatible recipe, stale derived artifacts, or an incomplete linked inventory, Recall performs a read-only preflight, creates a verified database backup, purges only affected derived Grade/RVI artifacts, and rebuilds through the shared coordinator. Raw matches, scoreboards, source payloads and timelines, reviews, annotations, and settings remain intact. Runtime grows with the number of stored matches.

Each installation builds its own reference from its locally stored complete matches. Another installation does not receive or use that dataset. New games in a supported frozen scope are graded against the selected snapshot and never mutate it. A newly represented mode remains **Calibrating** until the user explicitly recalibrates. Manual recalibration creates a new immutable snapshot and linked Grade/RVI recipe pair, then atomically regrades the stored history behind the database maintenance gate.
