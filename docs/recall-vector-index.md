# Recall Vector Index (RVI)

RVI is a local, recipe-bound Recall profile. It summarizes repeatable patterns in the matches Recall can actually measure; it is not MMR, rank, a global population rating, or a claim that profiles from two Recall installations are directly comparable.

## One Grade/RVI evidence contract

Grade and the match radar are two views of one calculation. Calibrated measurements form the applicable radar arms; position and primary archetype set each arm's responsibility; the responsibility-weighted arm composite is then calibrated once more against the frozen reference to produce the authoritative 0–100 RoleFit and letter. RVI reads those stored arm and metric observations rather than independently grading the match.

The career RVI headline has a different, explicit meaning: it is the equal mean of the available career arms. Its career-only **Consistency & Versatility** arm never enters an individual match Grade. The selected RVI recipe is immutable and names the exact Grade recipe, calibration snapshot, metric registry, vector policy, and timeline policy it accepts. Observations from another recipe are rejected rather than mixed into the profile.

RVI also retains an inspectable metric-observation layer for each eligible participant and match. The stored observation row can include:

- the native raw value, unit, numerator, denominator, and opportunity count;
- separate raw and calibrated-score evidence states;
- the source, source quality, and derivation identity;
- the comparison scope and number of independent reference matches; and
- the exact recipe and calibration identities.

The immutable recipe registry supplies the observation's label, description, formula, direction, capability arm, responsibility tier, declared arm weight, and resulting Grade influence.

This separation matters. A raw statistic can be known even when the frozen reference is too small to assign it a percentile. The UI can still explain the raw evidence while showing its calibrated score as unavailable.

## Evidence, partial profiles, and coverage

An observed zero remains zero. Unavailable, no-opportunity, invalid, not-applicable, and legacy-unknown values remain distinct; they never become observed zero. Missing **core** evidence withholds the Grade. Secondary measurements are opportunity-aware: observed secondary evidence joins the arm at its declared recipe weight. When secondary evidence is unavailable or has no opportunity, its declared mass inherits the observed core bundle for arithmetic only; the arm's immutable denominator stays fixed, optional absence cannot change the core-only score, and coverage still discloses that the evidence was not observed.

Metric detail is grouped as **Core**, **Secondary**, **Diagnostic**, or **Unavailable / not applicable**. Core and secondary measurements can score their arm; diagnostics remain inspectable with zero arm and Grade weight. A partially measured match can retain its supported evidence without copying a career value into a missing match arm or turning missing evidence into zero.

For the default equal-match profile weighting:

```text
neutralBundleScore = sum(observed core/initiative percentile * declaredMetricWeight)
                     / sum(observed core/initiative declaredMetricWeight)
matchArm = (sum(observed scoredMetricPercentile * declaredMetricWeight)
            + unavailableSecondaryWeight * neutralBundleScore)
           / sum(all declaredMetricWeight)
rawMatchComposite = sum(matchArm * applicableResponsibilityWeight)
                    / sum(applicableResponsibilityWeight)
RoleFit = frozenReferenceECDF(rawMatchComposite)
careerArm = mean(observed matchArm scores)
careerRVI = mean(available careerArm scores)
coverage = observedEligibleGames / eligibleGames
nEff = (sum(matchWeight) ^ 2) / sum(matchWeight ^ 2)
```

An arm exists only when its applicable core evidence is observed. Diagnostics cannot move it. Confidence is reported separately: Learning below 10 effective games, Provisional from 10 through 29, and Established at 30 or more. A deterministic 2,000-replicate match bootstrap still describes the stored RoleFit sample; it never changes a score.

## Seven match arms and one career arm

Summoner's Rift grades use seven match arms. ARAM and ARAM Mayhem use exactly four: Combat, Positioning & Survival, Control & Utility, and Economy. Objectives & Macro, Vision & Setup, and Initiative & Pressure are structurally not applicable to an Abyss match Grade rather than displayed as missing responsibilities.

| Capability arm | Scored basis |
| --- | --- |
| Combat | Damage share, damage pace and efficiency, kill participation, and retained fight outcomes when supported |
| Positioning & Survival | Death pace, time dead, isolation and numbers context, and recorded teamfight survival |
| Control & Utility | Crowd-control pace, ally healing/shielding, and measurable protection share |
| Economy | Gold and CS pace plus exact opposing-position gold, CS, and XP phase deltas when supported |
| Objectives & Macro | Neutral-objective and structure damage, overall objective participation, and structure participation |
| Vision & Setup | Vision-score pace; ward and setup measurements remain inspectable diagnostics unless the recipe declares otherwise |
| Initiative & Pressure | Early takedowns, roaming, early structure pressure, and early objective involvement when supported |
| Consistency & Versatility (career only) | A repeatability floor plus demonstrated position, archetype, and champion breadth after at least 20 measured games |

The registry also retains narrower diagnostics—such as individual objective subtypes and team-context conversions—where assigning direct individual Grade credit would overstate what the evidence proves. Timeline-derived fight, roam, proximity, setup, and positioning measurements are explicit proxies and receive observed evidence only when their required events, frames, coordinates, identities, and opportunities are available. A registry entry is not proof that a particular match supplied that evidence.

## Frozen per-installation reference

Metric percentiles come from an immutable calibration snapshot built from complete matches stored in the same Recall installation. A friend who installs Recall builds a reference from the complete matches in their own local database; their games are not graded against the developer's or another user's dataset.

Calibration is separated by tracked mode and rules key. It starts at the mode scope, uses position and primary-archetype child cohorts where available, shrinks sparse child cohorts toward their parent, excludes the match being scored, and treats a complete match as the independent cluster rather than counting its ten participants as ten independent matches. A mode/rules scope needs at least ten independent complete matches before it can be frozen.

New games in an already frozen scope use the selected snapshot without mutating it, so playing one more game does not silently rewrite earlier grades. A newly represented scope remains **Calibrating** until an explicit recalibration includes it. Manual recalibration creates new Grade and RVI recipe identities and rebuilds stored derived results together.

Because each installation has a different local reference population, RoleFit and RVI are stable within that installation and recipe, but they are not advertised as cross-user absolute scores.

## Scopes and sample descriptors

Recall exposes Overall, Position, and the two most-played Primary Archetype scopes from exact-recipe observations. Champion-position scope cards are intentionally omitted. A recent view uses the newest measured window without changing the career aggregate or frozen calibration.

The career-only Range arm requires at least 20 measured RoleFit observations. Its consistency half combines the lower quartile with a MAD-based repeatability score. Its versatility half combines performance floors and Hill-diversity breadth across eligible categories; Summoner's Rift uses position, archetype, and champion domains, while Abyss profiles use archetype and champion domains. Raw consistency and diversity summaries remain available as evidence for that arm.

## Telemetry boundaries

Live Client snapshots do not provide player map coordinates, ability casts, CC targets, engage order, or a reliable account of intent. Recall therefore does not manufacture frontline time, peel quality, ability-reset conversion, or unsafe-exposure precision from them.

Retained post-game timeline events and frames can support narrower event/position proxies. Missing positions, identities, ward categories, events, opportunities, or coordinates make the affected observation unavailable or not applicable. A timeline-derived metric influences an arm only when the immutable recipe gives it a non-zero weight and its evidence is observed; otherwise it remains a labeled diagnostic.

RVI uses retained local facts. It never schedules Riot Web requests; optional Match-V5 data is read only when the user-started history import already retained it.

## Recipe upgrades and frozen storage

Recall accepts only the current immutable Grade/RVI recipe pair or an explicitly declared identity alias whose formulas and evidence contracts are exactly identical. An existing valid alias keeps its original calibration row, frozen epochs, results, and deterministic confidence intervals; an identity cleanup alone does not rebuild today’s cohort or change historical numbers.

An incompatible recipe or incomplete linked metric inventory requires a verified backup and a coordinated derived-data rebuild. Raw matches, scoreboards, retained source payloads and timelines, reviews, notes, tags, and settings are preserved. An explicit recalibration—or a future formula change—creates new immutable identities and can intentionally perform another protected rebuild.
