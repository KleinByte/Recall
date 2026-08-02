# Live Resources, Win Confidence, and Tempo

## Product goal

Recall should answer three questions without pretending the local game feed is
more precise than it is:

1. How much total gold did each team hold throughout a completed match?
2. Which team currently leads the live resource race?
3. Is the local team playing a clean, lead-building stretch or losing tempo?

## Data truth

### Completed matches

Riot/LCU timeline participant frames expose `totalGold`. Recall sums participant
frames by team and plots Blue and Red as independent series. These values are
exact when timeline status is ready.

### Live matches

Live Client Data exposes score, CS, level, visible inventory, and only the local
player's unspent gold. It does not expose every player's exact total gold.
Recall therefore displays **estimated team gold** and never labels it exact.

The estimate is symmetric for allies and enemies:

- starting and passive income;
- creep score at a conservative blended gold value;
- kills and assists at conservative base values;
- visible non-consumable inventory value as a lower bound.

No local-player-only unspent gold is added to team totals because that would
bias the allied estimate.

## Live analysis contract

Every successful live snapshot may contain:

```text
analysis
  resources
    allyGold
    enemyGold
    difference
    quality: building | fair | strong
    source: estimated
  winConfidence
    percent: 8..92
    label: Strongly favored | Favored | Even | Under pressure | Long shot
    factors[]
  tempo
    score: 0..100
    label: Surging | Building | Stable | Slipping | Collapsing
    direction: up | steady | down
    leadDelta
    factors[]
```

The win percentage is a live-state heuristic, not a trained betting model. It
uses estimated gold difference, kill difference, objective control, alive
advantage, and elapsed time. It is pulled toward 50% early and capped at 8–92%
to avoid false certainty.

## Tempo semantics

Tempo is recent execution, not the same thing as win probability.

- Starts at 50 while a baseline is built.
- Rises when the resource difference improves, the team wins takedown or
  objective windows, and no new allied deaths occur.
- Falls when the lead shrinks, the team concedes takedowns/objectives, or a
  prior lead reverses sharply.
- Uses a smoothed moving score so two-second feed updates do not make the gauge
  flicker.
- Resets between games and degrades to unavailable when the local feed cannot
  identify both teams.

Tempo cannot see positioning errors, missed skillshots, or bad cooldown usage;
its "mistake" signals are observable outcome proxies.

## UX

### Live Game

- A resource panel shows both estimated totals, their difference, estimate
  quality, a split lead bar, and win confidence.
- A dedicated `Tempo` gauge sits beside it. Its cooler cyan/gold visual language
  differs from Dashboard's streak-oriented Dial and has no overdrive effects.
- Short factor text explains why each score moved.
- The live scoreboard remains the primary surface below the analysis panels.

### Full Review

- The Timeline chart plots Blue total gold and Red total gold independently.
- A legend shows final totals and final difference.
- Event markers attach to the closest team line when a team is known.
- Time and gold axes remain readable at compact widths.

## Failure and privacy behavior

- No network service or auth token is added; all live analysis stays local.
- Missing enemy rosters suppress analysis rather than guessing a side.
- Existing live snapshots remain readable because `analysis` is optional.
- Timeline-unavailable matches keep the existing honest unavailable state.

## Acceptance criteria

- Pure calculation tests cover neutral, favorable, throw, and missing-team
  states.
- Timeline geometry tests cover separate team lines and absolute gold scaling.
- Renderer/main TypeScript checks pass.
- Full Vitest suite and production build pass.
- Browser visual QA confirms desktop and compact layouts, asset loading, labels,
  and reduced-motion behavior.
