# Recall UI-system migration plan

Status: implemented for the reachable desktop application

Companion specification: `docs/recall-ui-system.md`
Visual foundation: `docs/dial-ui-design-token-spec.md`

## Goal

Make the Dashboard's material, density, hierarchy, and controls the default
language of Recall, while keeping game evidence and earned identity legible.
The finished system must allow an application-wide retune through semantic
tokens and shared components instead of page-by-page CSS edits.

## Scope decisions

- Migrate every page reachable from the desktop sidebar and the shared shell
  around those pages.
- Retheme canvas charts through a TypeScript palette bridge.
- Preserve the Momentum Dial, tempo instrumentation, game maps, scoreboard and
  team colors, rune boards, grades, ranks, challenge tiers, augment rarity,
  and Recall transition artwork.
- Keep legacy token names as aliases while specialty visuals still consume
  them; they point to the same semantic system and therefore remain globally
  adjustable.
- Defer unreachable legacy views until they re-enter navigation. They may use
  compatibility aliases but should adopt shared primitives before shipping.

## Execution

| Phase | Work | Exit condition | Status |
| --- | --- | --- | --- |
| 1. Inventory | Trace routes, shared chrome, controls, responsive failures, and special visuals | Reachable-screen and exception map exists | Complete |
| 2. Specify | Define layers, roles, component contracts, density, responsiveness, and authoring rules | Canonical spec is reviewable | Complete |
| 3. Foundations | Publish `--ui-*` roles, legacy aliases, and the canvas theme bridge | Ordinary visuals can be changed centrally | Complete |
| 4. Components | Build headers, surfaces, panels, buttons, fields, tabs, stat tiles, empty states, scrolling, and dialogs | Repeated behavior has one implementation | Complete |
| 5. Shell | Migrate title bar, sidebar, notifications, pagination, update, and post-game chrome | Navigation and global arrivals share the system | Complete |
| 6. Pages | Migrate Dashboard support panels and all other reachable pages | Page headers, controls, panels, tables, and empty states use the system | Complete |
| 7. Charts | Replace generic chart literals with the semantic TypeScript palette | Canvas plots retune with the UI roles | Complete |
| 8. Verify | Contract tests, TypeScript, full test suite, production build, and responsive visual inspection | No regressions or page-level overflow at target widths | In verification |

## Verification matrix

- Desktop expanded navigation: application minimum width and 1440px content.
- Desktop collapsed navigation: content gains width without layout jumps.
- Narrow content: 760px and 480px containers for filters, tabs, tables, forms,
  review panels, live metrics, and map/chart containment.
- Keyboard: visible focus, tab order, dialog focus containment, Escape close,
  disabled actions, and horizontal tab access.
- Motion: system remains understandable with reduced motion enabled.
- Semantics: team blue/red, win/loss, ranks, grades, and tiers keep their
  established meaning.

## Future-change checklist

1. Can the change be expressed by an existing semantic token?
2. Can an existing primitive provide the behavior?
3. Is a new visual truly domain-specific, or ordinary chrome in disguise?
4. Does it work in a narrow content container rather than only a narrow
   browser viewport?
5. Does it add raw palette values outside the foundation or canvas bridge?
6. Are focus, reduced motion, tests, and the exception list still accurate?
