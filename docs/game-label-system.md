# Game label system

Recall awards a small, evidence-backed set of labels instead of displaying
every matching rule. Labels are separate from user-authored review tags.

## Data contract

- The local League Client remains the durable source that tells Recall a game
  finished. Its API is unsupported by Riot and is treated as nullable and
  versioned.
- Match-V5 is optional enrichment. Recall makes no Riot request when no API key
  is configured. HTTP 401 or 403 quarantines that key for the current client
  session; the local match still records normally.
- A successful Match-V5 match summary refreshes the full scoreboard and awards
  labels. Every stored label includes its source, confidence, priority, exact
  tooltip, and machine-readable evidence.
- Evaluations are versioned and persisted even when no label is earned. Raising
  the evaluator version makes old games eligible for safe recomputation.
- At most six labels survive priority sorting and suppression. Overlapping
  stories such as Pentakill/Quadra/Triple or Deathless/Hard to Kill do not pile
  up.

Official references:

- [Riot League developer documentation](https://developer.riotgames.com/docs/lol)
- [Riot API reference (Match-V5)](https://developer.riotgames.com/apis#match-v5)
- [Riot developer portal and personal-key limits](https://developer.riotgames.com/docs/portal)

## Enabled from the Match-V5 match summary

These labels use explicit final totals or transparent arithmetic over the full
lobby. “Strong” means the underlying totals are exact but the interpretation
is a Recall heuristic.

| Evidence family | Labels | Confidence |
| --- | --- | --- |
| Multikills and kills | Pentakill, Quadra Threat, Triple Threat, Bringer of Carnage, Ready to Rumble, First Blood, Solo Advantage | Exact |
| Survival | Deathless, Hard to Kill, Gray Screen Regular | Exact |
| Damage | Ouch, You Hurt, Heavy Hitter, Untouchable Artillery, Glass Cannon, Punching Up, Damage Sponge, Wet Noodle, True Damage Menace | Exact totals; share/efficiency interpretations are strong |
| Economy | Farm Machine, Low-Economy Hero, All Bark, No Bite | Exact totals; share interpretations are strong |
| Vision | Visionary, Sweeper, Control Freak, No Pink Budget | Exact totals; “Visionary” is strong |
| Objectives | Objective Force, Demolition Crew, Tower Taker, No Structure Damage, Plate Collector, Objective Thief, First Tower | Exact |
| Teamplay and utility | Assist Machine, Always There, Out of the Action, Crowd Controller, Field Medic, Team Medic, Shield Wall | Exact totals; participation interpretation is strong |

## Possible later with Match-V5 timeline

Timeline frames normally provide coarse periodic participant positions, while
some discrete events include timestamps and positions. These are implementable
only with wording that matches the evidence quality.

| Label concept | Required evidence | Safe wording |
| --- | --- | --- |
| Early Predator | Champion-kill events before 10:00 | Exact event count |
| Plate Collector | Turret-plate events | Exact event count and timestamps |
| Objective Presence | Nearest position frame plus objective event | “Near the objective at the nearest snapshot” |
| Caught Out | Death event plus nearest teammate frames | “No teammate was nearby at the nearest snapshot” |
| Overextended | Death event and coarse map-side geometry | Explicitly call it inferred |
| Roam Reward | Assigned role, movement frames, early kill event | Explicitly call it inferred |
| Comeback King / Lead Thrower | Team-gold frames and final result | State the largest observed frame deficit/lead |
| Cross-Map Pressure | Structure/objective events and coarse positions | Explicitly call it inferred |

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
| Recall start/completion and unspent gold at the moment | Bad Recall, Reset Master, Shopping With a Fortune |
| Continuous movement, brush entry, and full vision state | Facecheck Fatality, Successful Flank, Blind Wanderer, Seen Coming |
| Minion positions, health, and last-hit opportunities | Freeze Frame, Wave Crash, Missed Free CS, Cannon Criminal |
| Continuous health and damage events | Low-Health Escape, Melted Instantly, Target Confusion, Focus Fire |
| Moment-level shielding/healing attribution | Ally Saved, Clutch Shield, Guardian Angel |
| Reliable teamfight boundaries and intent | Bad Engage, No Follow-Up, Late Arrival, Final Fight Hero |
| Turret aggro and continuous positions | Diving Permit, Diving Violation |

The evaluator source file is the executable catalog. A new label is acceptable
only when its tooltip can be reconstructed from the stored `evidence_json` and
the required Match-V5 fields are captured by the mapper.
