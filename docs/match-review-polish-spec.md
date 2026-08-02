# Match and Review Polish — v2.0.14

## Outcome

Make match history dense enough to scan, turn Review into a high-fidelity post-game surface, and preserve the League data needed to explain rune and timeline performance.

## Requirements

### Match history

- Keep a desktop card near 120–135px tall with smaller portraits, items, gaps, and padding.
- Keep both five-player rosters on one row at normal desktop widths.
- Give player names a real minimum width and display the Riot game name before the tag line.
- Render modern and League Classic summoner spells from bundled CommunityDragon assets; never emit a broken image URL.

### Runes

- Persist every modern selection, including stat shards and Riot's `var1`–`var3` end-of-game counters.
- Show selected runes inline for every scoreboard player.
- On hover, focus, or click, reveal an in-client-style primary/secondary rune page with unselected choices dimmed and selected choices highlighted.
- Translate counters with Riot's end-of-game descriptions (for example damage, healing, gold, or activations), not generic labels where metadata exists.
- Bundle all League Classic rune definitions and art. Render Classic pages by Mark, Seal, Glyph, and Quintessence when selections are available.
- State the upstream limitation honestly: Riot's historical Classic match payload does not include selected rune pages. Recall must not infer or fabricate them.

### Review scoreboard

- Replace champion-mastery UI with rune loadouts.
- Replace full-width comparison bars with compact paired stat tiles.
- Improve hierarchy, density, hover states, team identity, and responsive behavior.

### Timeline

- Never label an unattributed kill as “Mayhem takedown.” Use “Unknown killer” only when Riot did not identify the actor.
- Preserve killer and victim names from Live Client events and resolve them to participants when possible.
- Show killer champion → League takedown icon → victim champion in each kill row.
- Make the team-gold plot pointer and keyboard interactive. The cursor reports time, both gold totals, gold lead, and kill score.

### Startup

- Register the packaged Windows app to launch at login by default.
- Login launches pass `--hidden`, so Recall records in the tray without opening over the desktop.
- Manual launches and second-instance launches reveal the window normally.
- Expose a Settings toggle and keep Electron's login-item state synchronized.

## Data and compatibility

- Schema v19 adds `rune_selections_json`; existing rows fall back to their six stored perk IDs.
- Participant capture version increments so recent matches can be enriched again.
- Timeline mapper version increments because event identity now includes actor/victim names.
- All new fields are optional at IPC boundaries, so older databases and partial client responses remain valid.

## Acceptance checks

- Typecheck, unit tests, renderer build, and Windows installer build pass.
- Match cards and Review are visually checked at desktop and narrow widths.
- Rune popovers are usable by mouse and keyboard.
- Gold tooltip is correct at start, middle, and end of a fixture timeline.
- A Classic spell ID resolves to a bundled non-empty PNG.
- Packaged startup uses the hidden argument and the Settings toggle updates login registration.
