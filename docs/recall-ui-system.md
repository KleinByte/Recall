# Recall UI system

Status: canonical application UI specification
Visual source: `docs/dial-ui-design-token-spec.md`
Implementation roots: `src/design/tokens.css`, `src/design/theme.ts`, and
`src/components/ui/`

## Purpose

Recall uses one shared visual system so the application can be retuned without
editing feature components one at a time. The Dashboard is the reference for
material, density, hierarchy, and control treatment. Feature code owns content
and semantic state; the UI system owns surfaces, borders, typography, spacing,
focus, controls, and responsive containment.

The target balance remains 80% ink and dark glass, 15% warm structural metal,
and 5% semantic energy. Consistency does not mean every screen becomes an
ornamented instrument.

## Architecture

The dependency direction is deliberately one-way:

```text
dial-tokens.css -> tokens.css -> components/ui -> feature pages
                         \----> design/theme.ts -> canvas charts
```

Feature code must not import `dial-tokens.css` directly. A visual retune starts
in the semantic roles in `tokens.css`; only a true palette change should reach
the Dial foundations.

### Layer 1: foundations

Foundation tokens are raw values: ink, navy, metal, energy, status colors,
spacing, typefaces, radii, shadows, and motion. They are private implementation
details. Product components must not introduce new raw colors for ordinary UI.

The `--dial-*` palette is the visual foundation. `src/design/theme.ts` mirrors
the subset needed by canvas-rendered charts, because canvas cannot resolve CSS
custom properties reliably.

### Layer 2: semantic roles

Feature and UI components consume `--ui-*` tokens:

| Family | Examples | Responsibility |
| --- | --- | --- |
| Canvas | `--ui-canvas`, `--ui-shell`, `--ui-sidebar` | Application depth and large backgrounds |
| Surface | `--ui-surface-panel`, `--ui-surface-raised`, `--ui-surface-inset`, `--ui-surface-hover` | Material hierarchy |
| Text | `--ui-text`, `--ui-text-subtle`, `--ui-text-muted`, `--ui-text-heading` | Readability and emphasis |
| Structure | `--ui-border`, `--ui-border-emphasis`, `--ui-divider` | Frames, rules, and selection |
| State | `--ui-positive`, `--ui-negative`, `--ui-warning`, `--ui-live` | Meaningful state only |
| Control | `--ui-control-*`, `--ui-focus-ring` | Buttons, inputs, selects, and tabs |
| Geometry | `--ui-space-*`, `--ui-radius-*`, `--ui-shadow-*` | Rhythm, shape, and elevation |

Legacy variables such as `--surface-1`, `--gold`, and `--border-subtle` remain
temporary aliases. New components use `--ui-*` names. Removing an alias is a
separate migration and must follow a repository-wide usage check.

### Layer 3: components

Reusable components live in `src/components/ui/` and are exported by its
`index.ts` barrel.

| Component | Contract | Use |
| --- | --- | --- |
| `PageHeader` | title, eyebrow, description, actions/default slots | Standard page identity and actions |
| `Surface` | semantic element, material variant, padding density | Toolbars, grouped filters, inset and raised regions |
| `Panel` | title, metadata, actions, material variant, optional scrolling | Titled content and charts |
| `Button` | primary/secondary/ghost/danger, size, active state | All ordinary actions |
| `Field` | label, hint, error, control slot | Form and filter alignment |
| `Tabs` | options plus `v-model`, attached/compact variants | Page and content navigation |
| `EmptyState` | title, description, icon and actions slots | Loading, disconnected, and no-data states |
| `StatTile` | label, value, hint, semantic tone, density | Repeated compact metrics |
| `MiniBar` / `ScrollArea` | bounded progress and scrolling | Dense supporting content |

Native controls may retain the compatibility classes `.league-button`,
`.league-select`, and `.league-input`; those classes are implemented by the
same component tokens. New work should prefer library components when their
contract fits.

## Material variants

- `panel`: quiet dark glass for most content.
- `toolbar`: connected inset surface for filters and local controls.
- `inset`: recessed well for charts, tables, and dense readouts.
- `raised`: stronger edge and shadow for modal or primary contextual content.
- `instrument`: rare faceted focal frame; only one primary instrument per
  region.

Ordinary panels use no persistent glow. Active tabs use a metal edge. Cyan is
reserved for focus, live state, or positive energy—not generic selection.

## Density and layout

- Page spacing and component padding come from the shared 4px scale.
- Standard controls are 34–36px tall; compact controls are 28–30px.
- Repeated one- or two-value cards should become a connected readout, list, or
  table before growing into a grid of large cards.
- Filter groups wrap by meaning, not one control at a time. At narrow widths,
  controls fill their row.
- Tabs remain attached to their content and scroll horizontally when needed.
- Page-level horizontal overflow is never acceptable. Dense tables and maps
  may own an internal scroller.

## State and accessibility

- Color is paired with text, icon, border, or position.
- Every interactive control receives the shared two-pixel focus ring.
- Destructive actions remain red and are never visually promoted as gold.
- Muted text is supporting information, not the only essential instruction.
- Touch targets remain at least 34px except dense table-only actions.
- Reduced-motion mode disables ornamental and ambient motion.

## Intentional specialty visuals

These components keep their distinct visual identity while consuming shared
surrounding tokens where practical:

- `MomentumGauge`: the canonical Dial and primary instrument.
- `TempoGauge`: live-game instrumentation.
- `GradeBadge`, rank crests, challenge tiers, and augment rarity: earned or
  domain-specific identity.
- `MatchDeathMap`, team scoreboards, rune boards, and charts: stable game/team
  semantics and source imagery.
- `RecallMark`, `UpdateRecallAnimation`, post-game and update arrival moments:
  brand transitions.

Specialty status does not exempt a component's ordinary buttons, popovers,
outer surface, focus treatment, or responsive containment from the system.

## Authoring rules

1. Start a reachable page with `PageHeader`, unless its opening region is an
   explicitly documented specialty hero.
2. Choose a shared component by behavior first. Do not reproduce a button,
   tab strip, field label, empty state, or dialog shell in page CSS.
3. Use a semantic `--ui-*` role in feature CSS. Foundation values and raw
   colors belong only in token files, canvas bridges, source imagery, or an
   approved domain-specific visual.
4. Prefer one connected `Surface` containing several compact `StatTile`s over
   multiple large cards that each carry a single short value.
5. Put responsive rules on the `recall-content` container. Use viewport media
   queries only for teleported overlays or actual window chrome.
6. Preserve blue/red team meaning and win/loss meaning; never reuse those
   colors for ordinary selection or decoration.

The standard page skeleton is:

```vue
<div class="page">
  <PageHeader title="Page" eyebrow="Context" description="What this view answers">
    <template #actions>...</template>
  </PageHeader>
  <Surface variant="toolbar" padding="compact">...</Surface>
  <Tabs v-model="view" :options="views" label="Page view" />
  <Panel title="Evidence">...</Panel>
</div>
```

## Adoption map

| Area | Shared system | Preserved specialty |
| --- | --- | --- |
| App shell | title bar controls, sidebar states, notifications, update/post-game surfaces | Recall mark and arrival animation |
| Dashboard | supporting panels, telemetry readouts, filters, ranked-history controls | Momentum Dial and primary hero |
| Review | page and content tabs, ordinary panels, filters, responsive layout | grade/context evidence, scoreboard, timeline, maps, rune board |
| Live | page header, empty state, connected readouts, containment | tempo gauge and team/resource semantics |
| Challenges / Matches / Champions | headers, toolbars, fields, buttons, stat boards, empty states, table frames | tier and mastery identity |
| Skill / Progress / Settings | headers, panels, tabs, fields, forms, status/empty states | analytical charts, rank graphs, trust evidence |

## Change protocol

- Change semantic values rather than aliases. Aliases exist to keep older
  specialty code adjustable while it is incrementally simplified.
- Add a token only when at least two consumers share a role, or when a single
  primitive needs to expose a deliberate system-level decision.
- Add a component variant only when behavior or hierarchy changes; spacing-only
  differences should use the existing density or padding contract.
- Any new primitive requires keyboard focus, disabled-state, reduced-motion,
  narrow-container, TypeScript, and source-contract coverage.
- A migration is complete when page-level raw palette values are gone from
  ordinary chrome and the page remains usable at 480px, 760px, and desktop
  content widths.

## Migration plan

1. Publish semantic tokens and legacy aliases.
2. Implement and document the shared component contracts.
3. Move the app shell, navigation, page headers, filters, tabs, controls,
   panels, tables, and empty states to the system.
4. Retheme shared charts through `src/design/theme.ts` while preserving series
   semantics.
5. Leave specialty visuals intact and replace only their generic chrome.
6. Add source-level contract tests, run TypeScript and the full test suite,
   build the Electron renderer, and visually inspect representative desktop,
   tablet, and phone layouts.

## Acceptance criteria

- Changing the semantic surface, border, text, control, or spacing tokens
  updates every ordinary application screen.
- Every top-level page uses either `PageHeader` or an explicitly documented
  specialty hero.
- Ordinary filters, tabs, buttons, inputs, panels, tables, and empty states no
  longer define independent palettes.
- Dashboard density and hierarchy remain the reference, not an exception.
- Specialty visuals retain meaning and do not multiply ornament across a page.
- No page-level horizontal overflow at 480px, 760px, or the desktop app width.
- Keyboard focus remains visible and reduced-motion behavior remains intact.
