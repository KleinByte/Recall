# The Dial UI language

Status: canonical visual and token reference
Source component: `src/components/MomentumGauge.vue`
Token source: `src/design/dial-tokens.css`

## Outcome

Use The Dial as Recall's north star when updating the rest of the product. The
language should feel like a precise Hextech instrument: dark glass and ink hold
the data, warm metal establishes structure, and colored energy communicates
state. It should not become a blanket application of glow, gold borders, or
ornament.

The desired balance is approximately:

- 80% ink, navy, and quiet content surfaces;
- 15% warm metal for framing, hierarchy, and selected structure;
- 5% energy or semantic color for live state, focus, and meaningful emphasis.

## Design principles

### Instrument, not dashboard chrome

Every ornamental line must explain containment, hierarchy, progress, or state.
The Dial's cells show accumulated charge; its metal frame contains the system;
its crystal is the focal readout. Other screens should preserve that causal
relationship. Decorative geometry without a job is noise.

### Material hierarchy

Recall has three visual materials:

1. **Ink well** — the page background and deepest recesses.
2. **Dark glass** — cards, tables, chart wells, and interactive surfaces.
3. **Warm metal** — frames, rules, active rails, and important labels.

Cyan is energy, not a fourth surface. It marks focus, activity, live data, or a
high-information focal point.

### Quiet by default, vivid on consequence

Default surfaces should be low-contrast and stable. Glow and animation appear
when something changes, reaches a threshold, is selected, or needs attention.
Persistent bloom is reserved for a single focal element in a region.

### Faceted outside, readable inside

Large focal containers may use 8–16px chamfers and bevels. Dense inner controls
use the existing 6–10px radii for clarity and efficient layout. Do not chamfer
every row, button, badge, and tooltip.

## Token architecture

Use semantic `--instrument-*` tokens in product UI. The `--dial-*` primitive
tokens are implementation values and palette references. This separation lets
the palette evolve without rewriting component intent.

### Core semantic tokens

| Token | Purpose |
| --- | --- |
| `--instrument-surface` | Primary dark-glass panel fill |
| `--instrument-surface-energized` | Sparse focal energy behind a readout |
| `--instrument-frame` | Metallic frame for hero or instrument panels |
| `--instrument-lattice` | Very quiet 60° engraved texture |
| `--instrument-lattice-reverse` | Paired lattice direction |
| `--instrument-border-soft` | Internal rules and inactive geometry |
| `--instrument-border` | Normal structural rule |
| `--instrument-border-strong` | Selected or focal structural edge |
| `--instrument-title` | Warm, high-priority heading color |
| `--instrument-energy` | Active/focused Hextech energy |
| `--instrument-energy-glow` | Energy bloom color; never body text |
| `--instrument-shadow-raised` | Hero-panel elevation |
| `--instrument-shadow-energy` | Small active crystal or focus bloom |
| `--instrument-chamfer-sm` | Compact focal geometry |
| `--instrument-chamfer-md` | Hero-panel geometry |

### Palette roles

| Family | Role | Rules |
| --- | --- | --- |
| Ink / navy | Background, glass, wells | Carries most of every screen |
| Metal | Frames, dividers, selected hierarchy | Avoid as large solid fills |
| Energy | Focus, live state, active visualization | One focal energy source per region |
| Score spectrum | Ordered quantitative performance | Only for continuous low-to-high measures |
| Tier palette | Achievements and overdrive states | Never substitute for ordinary status colors |

### Score spectrum

The Dial's score ramp is continuous and deliberately crosses multiple hues:

`#4a0717` → `#8f1428` → `#d2494d` → `#17608f` → `#159194` →
`#18a66e` → `#9c8130` → `#e7bd55`

Use it for ordered performance scores such as momentum, percentile, or model
confidence when higher is unambiguously better. Do not use it for categorical
teams, roles, or unrelated series. Charts that compare teams should retain
stable team colors rather than moving through this ramp.

### Achievement tiers

| Tier | Base | Bright |
| --- | --- | --- |
| Gold | `#d3a238` | `#ffe08a` |
| Emerald | `#0fa76f` | `#67ecb5` |
| Diamond | `#1ea9d6` | `#8ceaff` |
| Master | `#9254d6` | `#e0a4ff` |

Tier color is earned state. It may recolor a focal gem, progress endpoint, or
small achievement frame. It should not recolor an entire page or ordinary
card.

## Typography

Recall's type hierarchy remains deliberately narrow:

| Role | Family | Typical treatment |
| --- | --- | --- |
| Display values | `--font-display` | 22–34px, tabular numbers where relevant |
| Section and control headings | `--font-heading` | 11–16px, 0.8–2.4px tracking |
| Body and dense data | `--font-body` | 11–14px, sentence case |

Uppercase is for instrument labels, tabs, compact metadata, and short section
titles. Body copy, explanations, player names, and long actions remain sentence
case. Never use wide tracking below 11px or on multi-line prose.

## Spacing, shape, and depth

- Continue using the 4px spacing scale in `tokens.css`.
- Use 12–16px internal padding for normal cards and 16–24px for focal panels.
- Use a 16px chamfer only on hero/instrument panels with enough breathing room.
- Use 6px radius for controls and compact cells; 10px for ordinary cards.
- Prefer a one-pixel engraved rule to multiple nested borders.
- `--instrument-shadow-raised` is for focal panels. Ordinary cards continue to
  use `--shadow-card`.
- Texture opacity should remain at or below 3%; texture must disappear before
  it competes with text.

## Component recipes

### Instrument panel

Use for one primary status or visualization, such as The Dial, a live-game
state, or a major progression summary.

- Metallic outer frame using `--instrument-frame`.
- One inset dark-glass layer using `--instrument-surface`.
- Optional paired lattice at 3% opacity.
- Centered or strongly aligned focal readout.
- A single energy source tied to current state.
- Chamfered exterior; simple inner content geometry.

Do not place multiple instrument panels side by side unless one is clearly
primary and the others are visually quieter.

### Standard card

Use the existing `.card` primitive. To move it toward the Dial language:

- deepen its fill before increasing its border contrast;
- use warm metal for its title or active edge, not every text element;
- add a single engraved divider when hierarchy needs reinforcement;
- use square or subtly rounded chart wells inside the card;
- avoid glow unless the card contains a live or selected state.

### Tab rail

- Tabs and content share one continuous container edge.
- The rail uses dark glass; the active tab uses a metal underline or edge.
- Inactive labels are muted, not separately boxed.
- Cyan is reserved for live/focused tabs; gold indicates selected hierarchy.
- On narrow windows the rail scrolls horizontally instead of compressing text.

### Buttons and controls

- Default: dark glass, soft metal border, gold label.
- Hover: one surface step lighter and a stronger metal edge.
- Active/selected: gold structural edge; do not add persistent bloom.
- Focus: a clear two-pixel outline. Energy cyan is acceptable when focus is the
  only energized state in the region; otherwise use gold.
- Destructive actions retain semantic red and must not be restyled as gold.

### Data visualization

- Put charts in a recessed ink well with quiet grid lines.
- Use no more than one luminous primary series plus stable secondary series.
- Direct labels and tooltips should carry exact values; glow never substitutes
  for labeling.
- Use tabular numerals for axes, scores, and comparisons.
- The score spectrum is quantitative; team and category palettes stay stable.

### Badges and status

- Badges are compact evidence labels, not miniature cards.
- Use a quiet fill and one semantic edge or glyph.
- Tier colors mean achievements only.
- Win/loss, warning, and error retain their established semantic meaning.

## Motion

Motion follows an energy model:

1. **Charge** — a value changes over roughly 450–650ms.
2. **Ignite** — a threshold crossing gets one 550–950ms entrance response.
3. **Sustain** — only a high-value live/overdrive state may use slow ambient
   motion.
4. **Cool** — persistent effects visibly settle when the state ends.

Use `--instrument-motion-fast` for controls,
`--instrument-motion-state` for value changes,
`--instrument-motion-material` for glass/metal transitions, and
`--instrument-motion-ambient` for rare sheen passes. Every animation requires
a `prefers-reduced-motion` static state. Avoid layout movement, continuous card
floating, and simultaneous ambient effects across a page.

## Responsive behavior

- Preserve hierarchy before preserving side-by-side layout.
- Focal readout comes before supporting explanation at narrow widths.
- Two-column insight layouts should stack before either child drops below its
  readable minimum.
- Tab labels remain full and horizontally scroll when necessary.
- Dense tables may scroll inside an attached content surface; page-level cards
  must not overflow the app shell.
- Remove texture and secondary ornament before reducing type below the defined
  scale.

## Accessibility guardrails

- Never use glow as the only state indicator.
- Pair color with text, position, iconography, or shape.
- Body text uses `--text-primary` or `--text-secondary`; muted text is not used
  for essential instructions or small values.
- Focus indicators remain visible against both ink and energized surfaces.
- Meter, progress, and chart components expose numeric values and labels to
  assistive technology.
- Reduced-motion mode removes shake, orbit, shimmer, and staggered delay.

## Adoption sequence

When updating an existing surface, apply the language in this order:

1. Correct layout, hierarchy, and responsive containment.
2. Map surfaces and borders to semantic tokens.
3. Normalize typography and spacing.
4. Establish selected, focus, and semantic states.
5. Add one meaningful geometric motif if the surface warrants it.
6. Add motion only when it explains a state change.

This order is intentional: a broken layout with a metallic frame is still a
broken layout.

## Review checklist

- Does each metal line communicate structure or selection?
- Is there at most one persistent energy focal point per region?
- Is semantic color still unambiguous without the surrounding decoration?
- Does the surface remain readable with all animation disabled?
- Does it stack or scroll cleanly at narrow widths?
- Are score-spectrum and tier colors used only for their defined meanings?
- Could any glow, texture, bevel, or border be removed without losing meaning?
  If yes, remove it.
