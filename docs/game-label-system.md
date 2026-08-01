# Game label system

Recall awards a small, evidence-backed set of labels instead of displaying
every matching rule. Labels are separate from user-authored review tags.

## Data contract

- The local League Client remains the durable source that tells Recall a game
  finished. Its API is unsupported by Riot and is treated as nullable and
  versioned.
- Full recent scoreboards and timelines come from the authenticated local
  League Client. They never require a developer key. Recall captures the
  client's rolling window promptly because these unsupported endpoints may age
  games out or change shape between client versions.
- Match-V5 is reserved for the explicit full-history import in Settings. It is
  not used by normal post-game sync, label evaluation, review, or timeline
  loading.
- Recall combines locally captured summary and timeline labels. Every stored
  label includes its source, confidence, priority, exact tooltip, and
  machine-readable evidence.
- Evaluations are versioned and persisted even when no label is earned. Raising
  the evaluator version makes old games eligible for safe recomputation.
- At most six labels survive priority sorting and suppression. Overlapping
  stories such as Pentakill/Quadra/Triple or Deathless/Hard to Kill do not pile
  up.

Official references:

- [League Client API endpoint catalog](https://lcu.kebs.dev/)
- [Riot League developer documentation](https://developer.riotgames.com/docs/lol)
- [Riot API reference (Match-V5)](https://developer.riotgames.com/apis#match-v5)
- [Riot developer portal and personal-key limits](https://developer.riotgames.com/docs/portal)

## Enabled from the local match summary

These labels use explicit final totals or transparent arithmetic over the full
lobby. “Strong” means the underlying totals are exact but the interpretation
is a Recall heuristic.

| Evidence family | Labels | Confidence |
| --- | --- | --- |
| Multikills and kills | Pentakill, Quadra Threat, Threefold, Double-Digit Menace, Unbroken Momentum, First Blood, Solo Advantage | Exact |
| Survival | Deathless, Hard to Kill, Gray Screen Regular | Exact |
| Damage | Damage Crown, Heavy Hitter, Untouchable Artillery, Glass Cannon, Punching Up, Damage Sponge, Wet Noodle, True Damage Menace | Exact totals; share/efficiency interpretations are strong |
| Economy | Farm Machine, Low-Economy Hero, All Bark, No Bite | Exact totals; share interpretations are strong |
| Vision | Visionary, Sweeper, Control Freak, No Pink Budget | Exact totals; “Visionary” is strong |
| Objectives | Objective Force, Demolition Crew, Tower Taker, No Structure Damage, Plate Collector, Objective Thief, First Tower | Exact |
| Teamplay and utility | Assist Machine, Always There, Out of the Action, Crowd Controller, Field Medic, Team Medic, Shield Wall | Exact totals; participation interpretation is strong |

## Enabled from the local League Client timeline

The endpoint supplies periodic participant frames. Client builds observed by
Recall have exposed champion-kill and structure events; other event families
are treated as optional and never inferred when absent. The evaluator can
consume richer events if a future client build supplies them without changing
the storage contract.

Timeline frames normally provide coarse periodic participant positions, while
some discrete events include timestamps and positions. These are implementable
only with wording that matches the evidence quality.

| Evidence family | Labels | Confidence |
| --- | --- | --- |
| Kill events | First Blood Assist, Early Predator, Shutdown Collector, Bounty Hunter, Merciless, Marked Target, Late Bloomer | Exact |
| Event positions | Invader, Gank Machine, Every Lane Wins, Camping Permit, Roam Reward | Strong; uses broad map zones |
| Role-opponent frames | Lane Kingdom, Jungle Gap, Early Lead, Lead Lost, Comeback Lane, XP Gap, Level Lead, Level Down | Strong; nearest-minute snapshot disclosed |
| Jungle-CS frames | Counter Jungler, Jungle Invaded | Inferred; counts jungle-CS gains observed in opposing jungle territory |
| Ward events, when supplied | Deep Vision | Strong; broad enemy-side geometry |
| Objective events and positions, when supplied | Objective Master, Dragon Slayer, Objective Presence | Exact participation or inferred proximity, as shown in the tooltip |
| Team-gold frames | Comeback King, Lead Thrower | Exact observed frame lead/deficit |
| Structure events | Plate Collector, Tower Taker, First Tower Pressure, Inhibitor Breaker, Splitpush Threat | Exact participation; Splitpush Threat uses broad side-lane geometry |
| Death events and frames | Caught Out, Overextended, Shopping With a Fortune | Inferred; nearest-snapshot limitation disclosed |

Timeline labels should use `source = timeline`, never replace exact summary
labels with a lower-confidence duplicate, and must disclose snapshot distance
or time in their evidence.

## Disabled because Riot data cannot establish them reliably

These concepts require telemetry absent from the Match-V5 summary and too
sparse or incomplete in the timeline. They must not be awarded merely because
a correlated aggregate happens to be present.

| Missing telemetry | Labels that remain disabled |
| --- | --- |
| Ability casts and hit results | Skillshot Sniper, Ultimate Whiff, Combo Breaker |
| Summoner-spell casts and cooldown state | Flash Down, Died With Flash Available, Cleanse Unused |
| Recall start/completion | Bad Recall, Reset Master |
| Continuous movement, brush entry, and full vision state | Facecheck Fatality, Successful Flank, Blind Wanderer, Seen Coming |
| Minion positions, health, and last-hit opportunities | Freeze Frame, Wave Crash, Missed Free CS, Cannon Criminal |
| Continuous health and damage events | Low-Health Escape, Melted Instantly, Target Confusion, Focus Fire |
| Moment-level shielding/healing attribution | Ally Saved, Clutch Shield, Guardian Angel |
| Reliable teamfight boundaries and intent | Bad Engage, No Follow-Up, Late Arrival, Final Fight Hero |
| Turret aggro and continuous positions | Diving Permit, Diving Violation |

The evaluator source file is the executable catalog. A new label is acceptable
only when its tooltip can be reconstructed from the stored `evidence_json` and
the required local-client fields are captured by the mapper.
