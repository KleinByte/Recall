# Rune Page Fidelity — v2.0.16 draft

## Outcome

Make rune inspection look like the League surface it represents: a modern
primary/secondary tree for current League and a parchment 9/9/9/3 socket board
for League Classic. Keep Classic masteries visually distinct from champion
mastery and never manufacture selections that Riot did not return.

## Source of truth

- Riot's July 2026 Classic announcement defines the mode as Season-3 anchored,
  confirms separate Rune and Mastery pages, and says Classic runes use the old
  Tier-3 baseline.
- Recall's recorded League Classic match payloads currently contain no perk,
  rune, or mastery-allocation fields. Existing Classic participant rows have
  zero perk IDs and an empty `rune_selections_json` value.
- Modern Match-V5 and LCU detail payloads do provide the selected primary tree,
  secondary tree, stat shards, and end-of-game rune counters. Those remain the
  authoritative modern selection source.

## Rendering contract

### Modern League

- Present primary and secondary paths as two vertical trees.
- Show all path choices in their real slot rows; selected choices receive a
  path-colored ring and glow while unselected choices stay readable but dim.
- Show the three stat-shard rows beneath the secondary tree.
- Include a compact five-path selector strip and faint path watermark to match
  the hierarchy of the in-client rune editor.
- Keep end-of-game rune results below the page, using Riot's metadata labels.

### League Classic runes

- Use the parchment rune-board backdrop supplied by the user.
- Map rune counts into the historical sockets: 9 Marks, 9 Seals, 9 Glyphs,
  and 3 Quintessences.
- Repeat a rune into as many sockets as its captured `count` permits, capped by
  the capacity of that rune type. Do not duplicate a selection with no count.
- Preserve an empty board when no Classic selection was captured and explain
  the upstream limitation in a compact callout.
- Keep the rune result list below the visual board when match counters exist.

### League Classic masteries

- Treat Classic mastery allocations as a separate page, never as champion
  mastery level or points.
- Use a clean three-panel Offense / Defense / Utility backdrop derived from the
  user's reference, with all baked-in icons, points, and highlights removed.
- Until the LCU match payload exposes actual mastery allocations, render no
  selected nodes and label the page `Not captured by Riot`.
- The data boundary is deliberate: a neutral historical board is preferable to
  a plausible-looking but false 21/9/0 page.

## Interaction and layout

- The trigger opens on hover/focus and pins on click as before.
- The popover is teleported to `body`, clamped to the viewport, and sized up to
  760px for Classic so the board is not clipped.
- Classic pages expose a two-option Rune board / Masteries switch.
- All visual nodes retain native image titles or accessible labels.
- At narrow widths, both modern trees stack and the Classic boards scale down
  without horizontal scrolling.

## Assets

- `classic-rune-board.webp`: user-supplied neutral Classic rune-board image.
- `classic-masteries-empty.webp`: neutral three-tree background produced with
  OpenAI image editing from the supplied selected-mastery screenshot.
- Existing bundled rune and path icons remain the only node art; no CDN request
  is made at runtime.

## Acceptance checks

- Modern primary, secondary, and stat-shard rows contain the expected selected
  and unselected nodes.
- Classic placement exposes exactly 9 Mark, 9 Seal, 9 Glyph, and 3
  Quintessence sockets.
- A counted Classic selection fills sockets without exceeding capacity.
- A recorded Classic match with empty rune data shows a neutral rune board and
  a neutral mastery board, with no invented selections.
- Popovers fit at desktop and narrow widths and remain usable by mouse,
  keyboard, and touch.
- Typecheck, focused UI tests, full unit tests, and renderer build pass.
