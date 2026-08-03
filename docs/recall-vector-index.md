# Recall Vector Index (RVI)

RVI is Recall's 0–100 performance profile. It scores the repeatable parts of how a player fights, survives, builds leads, controls the map, and adapts.

RVI is also Recall's player-identity surface. The existing named style classification—such as Map Controller, Vanguard, or Carry—is derived from the player's recorded tendencies and shown inside RVI instead of as a separate Playstyle system.

## Model contract

- RVI uses up to 240 graded matches; recent movement uses the latest 20.
- Same-role, team, and lobby percentiles anchor the model when available.
- Transparent pace/share scales add distinct scoreboard signals such as KDA, damage share, gold, CS, vision, objective damage, crowd control, and ally support.
- Pace/share scales are champion-class aware. Each champion's primary Riot class tag—assassin, fighter, mage, marksman, support, or tank—selects the benchmark the signal is measured against, so a tank's damage share is judged against a tank's ceiling rather than a marksman's, and a marksman's crowd control is judged against a marksman's ceiling rather than a tank's. Classes come from the live client catalog first, with a bundled Data Dragon snapshot covering offline and pre-connection use.
- Cached local-client timelines add duel, skirmish, teamfight, pick, solo/teamfight/gank safety, early roam, forward-kill, fight-frequency, structure, Dragon, Baron, Herald, objective secure/setup, Baron conversion, lane-lead, phase-farm, and phase-proficiency signals. Ward and neutral-objective signals appear only when the client supplied those events.
- Consistency adds performance floor, repeatability, and session fatigue resistance.
- Versatility adds effective champion breadth, context performance, vector depth, losing-game steadiness, and timeline phase proficiency.
- Scores stabilize toward 50 while the sample is small. Confidence is **Learning** below 10 measured games, **Provisional** from 10–29, and **Established** from 30 onward.
- Missing evidence is omitted and available weights are normalized. A signal's influence is also reduced when it covers fewer games than the rest of the vector. Missing never counts as zero.
- Any scoring-recipe change increments `RVI_ALGORITHM_VERSION`.

## Rift vectors

Fighting, Survivability, Objectives, Farming, Vision, Initiative, Consistency, and Versatility.

## ARAM and Mayhem vectors

Fighting, Survivability, Resources, Team Presence, Sustain, Fight Control, Consistency, and Versatility. Rift-only objective and vision vectors are intentionally replaced.

## Interpretation boundary

RVI describes performance in recorded matches. It is not MMR, rank, or a claim about immutable player skill. Every drilldown shows the score, effective influence, comparison scope, sample coverage, and evidence actually used.

## Measurement boundary

The category names supplied from GPI are useful product requirements, but they are not Mobalytics' proprietary formulas or telemetry. RVI implements every defensible equivalent available from Recall's match rows and cached client timelines. It does not invent scores for signals the client does not expose reliably:

- exact minion availability and missed-CS efficiency;
- support-item quest timing and gold split by income source;
- trinket recharge downtime;
- precise fight boundaries or positioning/decision quality beyond visible event participation and coordinates;
- a reliable failed-gank identity when lane assignment and intent cannot be proven.

Those measurements can be added later if Recall captures the required evidence. Their absence lowers displayed coverage; it never silently becomes a zero.
