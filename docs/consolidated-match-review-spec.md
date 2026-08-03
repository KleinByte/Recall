# Consolidated Match Review — v2.0.16 draft

## Outcome

Clicking a match anywhere in Recall opens one review destination. The separate
Match Overview sheet and its `Full review` handoff are removed from the active
application shell.

The combined review keeps the fast visual hierarchy of Match Overview, then
uses task-focused tabs so deep data never turns the page into one long stack.

## Navigation contract

- Recall maintains a browser-style history stack for top-level pages and
  individual match reviews.
- Back and forward controls live in the desktop title bar and expose disabled,
  hover, focus, and accessible-label states.
- Opening a match records both the Review page and game ID. Returning through
  history restores the exact reviewed match, not merely the generic Review
  page.
- A new navigation after going back discards the obsolete forward branch.
- Sidebar navigation, automatic Live Game focus, challenge links, dashboard
  match links, post-game links, sessions, and bookmarks all use the same stack.

## Persistent match header

The header stays visible above every match tab and contains:

- champion portrait, outcome, champion name, queue, date, duration, role;
- large Recall grade and bookmark control;
- KDA, champion damage, gold, creep score, and lobby place;
- recorded game labels with their evidence tooltips.

There is no `Full review` action because this page is already the complete
review.

## Match tabs

### Overview

The Overview tab contains two compact insight tabs:

1. **RVI profile** — the current match rendered through the same RVI radar used
   by Skill and Dashboard, compared with the player's prior mode profile when
   available.
2. **Grade & context** — performance model, visual grade explanation,
   strengths/opportunities, and comparisons with prior matching games.

The Blitz-inspired scoreboard follows the insight area. Teams are stacked in
Blue/Red sections. Each player row exposes champion/level, spells, interactive
runes, Riot ID, lobby placement, role, final build, KDA, CS, kill participation,
and champion damage with a common-scale bar. Team headers expose kills, major
objectives, total gold, total damage, and bans when captured.

Notes, tags, and matched practice experiments remain below the scoreboard.

### Stats

A dense comparison matrix keeps participants as columns and metrics as rows.
It groups Combat, Damage dealt, Damage taken and healing, Economy, Vision, and
Objectives. The owner column and row-leading values are highlighted without
changing the underlying numbers. Missing optional Match-V5 fields render as an
em dash.

### Timeline

The existing interactive Blue/Red team gold plot and event feed remain together
in one Timeline tab. Mouse or keyboard inspection shows time, both teams' gold,
kills, and the current lead. Filters, kill-feed champion icons,
item/ability/objective art, purchase path, source caveats, and turning points are
preserved below the graph.

### Win probability

The same timeline snapshots produce an explicitly labeled retrospective
estimate. Each point uses only evidence available at that timestamp: team gold,
completed champion kills, completed major objectives, and match maturity. The
curve is bounded away from false 0/100 certainty and never uses the final match
result as an input.

## Data contract

`MatchReview` carries the match, all participants, both team rows, recorded
labels, grade breakdown, personal baseline, annotation, and timeline state.
No second match-detail request is required by the combined page.

RVI is requested twice with existing APIs:

- a timestamp-narrowed scope for the reviewed match;
- the matching mode-family history for comparison.

If a match cannot produce a measured RVI profile, the Overview explains the
missing evidence and keeps Grade & context available.

## Responsive and accessibility requirements

- Main tabs remain horizontally scrollable instead of wrapping into tall rows.
- The scoreboard keeps its desktop information density and degrades to a
  horizontally scrollable table before hiding data.
- Stats is intentionally horizontally scrollable at narrow widths.
- Tabs implement `tablist`, `tab`, `tabpanel`, `aria-selected`, and labelled
  regions.
- Charts retain keyboard cursor movement and accessible summaries.
- Navigation and match rows are reachable and operable by keyboard.

## Acceptance checks

- Match clicks from Matches and Dashboard open Review directly.
- No rendered `Full review` button or active MatchSheet remains in App.
- Back/forward restores pages and reviewed game IDs.
- Overview renders header KPIs, labels, RVI/grade insight tabs, and both teams.
- Stats exposes all ten participants and grouped rows.
- Timeline combines the interactive gold graph and event feed; Win probability
  remains a distinct match tab.
- Runes remain interactive in the new scoreboard, including Classic mode.
- Typecheck, focused unit/UI tests, production build, and browser visual QA pass.
