# Match and Review Redesign v2

## Problem

Recall 2.0.14 added more match information but did not establish a strong visual hierarchy. Match cards remain too tall at wide desktop sizes, roster names can collapse to a single character, and packaged Electron builds resolve several dynamic public assets from `file:///C:/` instead of the application directory. Review presents useful analysis as low-emphasis prose, rune strips occupy a scoreboard row without a dependable visual fallback, and expanded matchups become a wall of interchangeable statistic cards.

## Research basis

- Vite embedded builds require relative public paths. Dynamic public URLs must be composed with `import.meta.env.BASE_URL` rather than a leading slash.
- OP.GG treats the lobby scoreboard as a compact summary and separates focused rune/build and detailed-stat views. Its rune view uses the recognizable full tree rather than a strip of unexplained icons.
- Mobalytics prioritizes lobby rank, high scores, build overview, personal achievements, team summary, and toggleable statistics. Coaching output is visually ranked and directional.

## Design principles

1. **Summary first:** a match card should answer result, champion, grade, KDA, farm, contribution, build, and lobby composition in one compact scan.
2. **Names are information:** reserve a real minimum width for each roster name; remove Riot tags only in the dense list, preserve the complete Riot ID in the tooltip and Review.
3. **One visual language:** gold means standout, cyan/green means positive, red means risk or regression, and neutral slate is contextual evidence.
4. **Progressive disclosure:** the scoreboard remains dense. Opening a role creates one coherent head-to-head comparison table, not a collection of unrelated cards.
5. **Honest data:** missing Classic rune selections get an explicit unavailable state and never six broken placeholders.
6. **Packaged first:** every bundled public asset must resolve under both the Vite development server and Electron `file://` production builds.

## Match-card specification

- Desktop target height: 126–142 px including header and label rail.
- Use a three-band layout: 28 px metadata header, 72–78 px information row, compact label rail.
- Player summary and build remain fixed-width; roster consumes the remaining width.
- Each team is a five-row list with champion, role, and a name column of at least 110 px at full desktop width.
- At constrained widths, hide secondary damage text before truncating the roster to initials.
- Summoner spells use bundled assets and display a styled neutral placeholder only for an unknown ID.

## Match overview expanded-details specification

- Replace the six equal Setup/stat cards with a grouped inspection surface.
- Top rail: identity, position, summoner spells, grade, final build, and rune page.
- Below it: a compact stat matrix grouped into Combat, Resources, Map impact, and Milestones.
- Remove raw lane/role tokens, numeric rune-style IDs, and dot-separated rune IDs.

## Full Review specification

### Grade story

- Lead with the overall grade and lobby percentile as a circular/arc-style score visual.
- Show grade components as compact labeled percentile meters with weight shown as supporting metadata.
- Transform Strength, Opportunity, and Personal trend into visual insight tiles:
  - icon and semantic color;
  - large percentile or directional delta;
  - short plain-language action/result label;
  - supporting context beneath it.

### Prior-game comparison

- Display current versus baseline as a set of diverging comparison rows.
- Each row shows current, prior average, signed delta, and a centered zero marker.
- Summarize how many metrics improved, declined, or stayed close.
- Confidence and sample size become a compact header badge instead of empty introductory copy.

### Scoreboard

- Keep five lane rows, but make each side a compact champion identity block with full readable Riot ID, KDA, CS, damage, grade, two spells, selected keystone/secondary style, and final items.
- The inline rune control uses meaningful style/keystone icons and a label. Unknown or missing data renders one deliberate empty state.
- Opening a lane reveals a single comparison table with category sections (Combat, Resources, Map impact, Survival). Every row is `left value | label | right value`, with the leading value emphasized. No statistic cards.
- Rune/build inspection remains available from each player without expanding every rune image into the scoreboard row.

## Asset contract

- All bundled URLs use `publicAssetUrl()`.
- Regression tests must assert relative production paths for spells, runes, rune styles, and Recall artwork.
- The production bundle must contain every catalog entry referenced by its generated JSON.
- Visual QA must verify zero broken images for bundled spells/runes in a production-base harness.

## Acceptance criteria

- No `/C:/game-data/...` or `/C:/recall-icon.png` requests in packaged Review/Matches.
- The supplied wide Matches viewport fits materially more content with readable team names.
- Review grade explanation communicates strength, opportunity, and personal trend without relying on the old three prose sentences.
- Prior-game comparison has visible direction and magnitude for every metric.
- Scoreboard rune controls are intact and full rune pages open without clipping.
- Expanded lane details read as one comparison table and contain no repeated stat cards.
- Typecheck, full automated suite, production build, packaged smoke test, and browser visual QA pass before release.

## 2.0.15 final legibility pass

The release candidate receives one final density and legibility pass without returning to the oversized 2.0.14 layout.

- Match Overview rune pages render in a viewport-level overlay. No scoreboard, detail panel, rounded container, or scroll region may clip the tree; the overlay flips above the trigger when there is not enough room below.
- Full Review uses a compact icon-first rune control inside scoreboard rows. It keeps the complete tree one click or hover away while leaving room for spells, six items, and the player identity.
- Match-history roster columns remain grouped toward the content, use 12px body text and 17px champion rows, and preserve unused space on the far right for future match signals. The teams do not stretch to opposite edges of an ultrawide card.
- Performance-model labels, explanations, baseline values, and expanded matchup values target a 9–11px minimum hierarchy. Seven- and eight-pixel explanatory copy is not acceptable.
- The typography increase is selective: match cards and Review panels remain compact, and scoreboard rows do not grow beyond their current 62px minimum solely because of this pass.
