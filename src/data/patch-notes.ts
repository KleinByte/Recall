import packageJson from "../../package.json"
import type { PatchNoteRelease } from "../types/patch-notes"

/**
 * Shipped releases, newest first.
 *
 * Add the next entry in the same commit that bumps package.json. The test
 * suite requires the running version to have notes, so a release cannot
 * accidentally ship an empty "what's new" dialog.
 */
export const patchNotes: readonly PatchNoteRelease[] = [
  {
    version: "2.0.31",
    releasedAt: "2026-08-04",
    title: "Match playback, evolving form",
    summary:
      "Recall now replays match events on the map, gives The Dial a clearer progression through sustained form, and presents personal records and performance evidence with stronger chronological context.",
    sections: [
      {
        title: "Review the match as it unfolded",
        items: [
          "Timeline playback now moves through kills, deaths, levels, items, objectives, and map positions instead of leaving the match as a static event list.",
          "Summoner's Rift and ARAM reviews keep champion activity aligned with the selected moment while retaining the complete gold and event evidence.",
          "Review layouts remain readable at narrower window sizes while Grade and Context stay attached to the match telemetry above them.",
        ],
      },
      {
        title: "The Dial responds to the run",
        items: [
          "The Dial now changes its color, material, title, and effects as strong play develops into Overdrive and an extended Flow State.",
          "Momentum presentation uses the shared Recall token system while preserving the gauge's special reactive identity.",
        ],
      },
      {
        title: "Records and history you can trust",
        items: [
          "Personal records remain tied to their champion, mode, date, result, and source review so a new best always keeps its context.",
          "Grade Journey now orders matches chronologically even when imported or synthetic input arrives out of sequence.",
        ],
      },
    ],
  },
  {
    version: "2.0.30",
    releasedAt: "2026-08-04",
    title: "Connected telemetry, cleaner proof",
    summary:
      "Recall now carries the Dashboard's connected telemetry language into Match Review and Skill, keeps dense record views steady, and restores packaged navigation artwork.",
    sections: [
      {
        title: "A consistent performance language",
        items: [
          "Dashboard and Skill now share the same connected telemetry board instead of presenting isolated stacks of horizontal metrics.",
          "Match Review presents KDA, damage, gold, creep score, and lobby placement in the same compact command-deck language.",
          "Review labels, achievements, and personal-record callouts are denser so the evidence stays readable without taking over the page.",
        ],
      },
      {
        title: "Stable records and navigation",
        items: [
          "Progress record categories keep a stable ledger height and scroll internally, so switching between Performance, Combat, and Economy no longer shifts the page.",
          "Packaged sidebar artwork now resolves through production-safe asset URLs instead of falling back to missing-image placeholders.",
        ],
      },
    ],
  },
  {
    version: "2.0.29",
    releasedAt: "2026-08-04",
    title: "A sharper command deck",
    summary:
      "Recall's redesigned interface is now consistent from navigation through deep analysis, with denser responsive layouts, clearer records, and match evidence that remains usable at compact window sizes.",
    sections: [
      {
        title: "Dashboard and navigation",
        items: [
          "The Dashboard now uses a connected telemetry deck, a more focused performance layout, responsive champion rows, and a rebuilt rank-history control.",
          "The sidebar uses destination-specific League artwork, a clearer grouped hierarchy, compact navigation states, and a proper flat Settings glyph.",
          "Shared components and semantic tokens now carry the same Recall visual language across every primary page while preserving special game-specific visuals.",
        ],
      },
      {
        title: "Review evidence that scales",
        items: [
          "Match Review keeps RVI and grade context above its attached Overview, Stats, Timeline, and Win Probability workspace without overlapping at narrow widths.",
          "Gold advantage, event tracks, death maps, champion portraits, and Summoner's Rift, ARAM, and League Classic map coordinates are clearer and more accurate.",
          "Crowded game labels and personal records expand in place instead of forcing sideways scrolling, and Recall notifications now include an explicit Clear action.",
        ],
      },
      {
        title: "Champion, Skill, and Progress clarity",
        items: [
          "Champion details now open with connected performance telemetry and scroll through the complete breakdown without clipping lower sections.",
          "Skill Overview begins with the same compact telemetry language as the Dashboard.",
          "Progress records now use a compact mode selector, category browser, and review-linked ledger; capped kill participation is no longer treated as a meaningful personal best.",
        ],
      },
    ],
  },
  {
    version: "2.0.28",
    releasedAt: "2026-08-04",
    title: "One visual system, clearer match evidence",
    summary:
      "Recall now carries the Dashboard's visual language throughout the app, keeps dense screens stable as the window narrows, and makes timeline deaths and map evidence easier to inspect.",
    sections: [
      {
        title: "A shared Recall interface",
        items: [
          "Every reachable page now shares semantic design tokens and reusable headers, panels, controls, tabs, fields, dialogs, readouts, and empty states.",
          "Chart palettes use the same semantic roles as the interface, so future visual retunes can be made centrally without flattening game-specific meaning.",
          "The Momentum Dial, live Tempo gauge, grades, ranks, tiers, runes, maps, and team colors keep their distinct evidence-driven identity.",
        ],
      },
      {
        title: "Responsive review and navigation",
        items: [
          "Review profile and grade context stay above attached Overview, Stats, Timeline, and Win Probability content instead of shifting into detached card fragments.",
          "Filters, telemetry, tables, dialogs, notifications, and analytical layouts now respond to the actual content column behind the sidebar, including compact window sizes.",
        ],
      },
      {
        title: "Timelines and death maps",
        items: [
          "Gold-over-time plotting follows team totals instead of misleading personal deltas, with clearer tracks for kills, deaths, levels, items, and objectives.",
          "ARAM, Summoner's Rift, and League Classic reviews map champion deaths with map-aware coordinates, readable markers, champion filtering, and correctly fitted portraits.",
        ],
      },
    ],
  },
  {
    version: "2.0.27",
    releasedAt: "2026-08-03",
    title: "Records worth ringing in",
    summary:
      "Personal records now arrive inside Recall, compact text is easier to read throughout the app, and every launch begins with a polished return animation.",
    sections: [
      {
        title: "A home for new records",
        items: [
          "New personal records now light up a notification bell in Recall's titlebar instead of appearing as a Windows notification.",
          "The notification center keeps recent record moments together and opens the match review that earned each one.",
        ],
      },
      {
        title: "Comfortable reading",
        items: [
          "The smallest labels, captions, table values, and supporting copy are now two pixels larger across Recall without enlarging the primary interface.",
        ],
      },
      {
        title: "B-ing back",
        items: [
          "Recall now opens with the animated recall-complete choreography and transitions cleanly into the app.",
          "Release publishing now creates one verified GitHub release containing the complete signed updater set.",
        ],
      },
    ],
  },
  {
    version: "2.0.26",
    releasedAt: "2026-08-03",
    title: "A quieter Skill overview",
    summary:
      "Rank over time is temporarily tucked away from the Skill overview while Recall prepares a better home for it, and signed updates now carry the correct verified publisher identity.",
    sections: [
      {
        title: "Skill page focus",
        items: [
          "Rank over time is hidden for now without removing its implementation or recorded history.",
        ],
      },
      {
        title: "Signed update identity",
        items: [
          "Release validation now rejects the publisher-name placeholder before it can create another installer that existing clients cannot verify.",
        ],
      },
    ],
  },
  {
    version: "2.0.25",
    releasedAt: "2026-08-03",
    title: "Cleaner match rosters, dependable updates",
    summary:
      "Match history brings both teams together for faster scanning, while the release pipeline now confirms that every updater file is truly available before calling a release complete.",
    sections: [
      {
        title: "Rosters that read as one matchup",
        items: [
          "The allied roster now sits farther from your final build and closer to the opposing roster, keeping items and player names visually distinct while making both teams easier to compare.",
        ],
      },
      {
        title: "Updates that finish the job",
        items: [
          "Release publishing now explicitly uploads and verifies the Windows installer, update manifest, and differential update map before reporting success.",
        ],
      },
    ],
  },
  {
    version: "2.0.24",
    releasedAt: "2026-08-03",
    title: "Grades that mean something, dials that feel right",
    summary:
      "The grade model is rebuilt around rank-and-magnitude comparisons with class-aware expectations and regrades your history automatically, while the momentum dial and live Tempo gauge learn to celebrate streaks properly and stop panicking over even trades.",
    sections: [
      {
        title: "Grade algorithm v2",
        items: [
          "Grades now blend where you ranked in the lobby with how far ahead or behind you were, so a close second no longer scores like a distant one.",
          "Damage and objective expectations bend to your champion's class — supports are no longer punished for a tank's damage share, and frontliners get credit for soaking damage.",
          "Older matches are regraded automatically in the background whenever the algorithm improves, so your whole history stays comparable.",
        ],
      },
      {
        title: "A momentum dial with conviction",
        items: [
          "Any active three-win streak now pins the dial at 100 and lights the overdrive animations — a streak is a streak.",
          "Losses are weighed by how you played: an S-grade loss barely nudges the dial, while a D-grade loss drops it hard.",
        ],
      },
      {
        title: "Live Tempo finds its nerve",
        items: [
          "Even trades no longer sink the gauge — only uncompensated deaths count against you, and ARAM's faster death pace is baked into expectations.",
          "Multikill celebrations hold the redline longer the bigger the kill, then glide down instead of cliff-dropping.",
          "Tempo rises quickly but bleeds off slowly, reserving fast drops for genuine throws and heavy counter-swings.",
        ],
      },
    ],
  },
  {
    version: "2.0.18",
    releasedAt: "2026-08-03",
    title: "A clearer identity, fairer comparisons",
    summary:
      "Recall carries its full recall-platform mark across the desktop, while RVI now judges each champion against expectations shaped by their Riot class instead of one universal ceiling.",
    sections: [
      {
        title: "The full Recall identity",
        items: [
          "The gold R, blue recall beam, and platform rings now identify Recall in the titlebar, taskbar, notification area, installer, and browser favicon.",
          "The in-app titlebar adds a subtle animated recall pulse with a reduced-motion fallback, while the left navigation keeps the standalone R as the first letter of RECALL.",
          "Windows receives a sharpened multi-resolution icon set so the mark remains recognizable from small tray icons through installer artwork.",
        ],
      },
      {
        title: "Champion-class-aware RVI",
        items: [
          "Damage, gold, farming, vision, crowd control, objective pressure, survivability, and ally support are measured against benchmarks shaped by the champion's primary Riot class.",
          "Live client class tags take priority, with a bundled Data Dragon catalog keeping the model class-aware while offline and covering League Classic champion IDs.",
          "RVI advances to algorithm version 2 so stored reports refresh under the fairer class-aware model.",
        ],
      },
      {
        title: "Model resilience",
        items: [
          "Adaptability no longer treats missing recent performance vectors as zero balance, preventing incomplete evidence from unfairly pulling the score down.",
          "A repeatable champion-class sync command keeps the bundled offline catalog current as Riot's roster changes.",
        ],
      },
    ],
  },
  {
    version: "2.0.17",
    releasedAt: "2026-08-03",
    title: "Form you can read, champions you can rank",
    summary:
      "Recent form becomes an explorable grade trend instead of a row of letters, and the Champions page is rebuilt around headline numbers, filters, and a table that shows its shape at a glance.",
    sections: [
      {
        title: "Recent form tells the story",
        items: [
          "A thin grade trend line now runs above the win-loss strip, drawn against a fixed range so a steady run reads as steady instead of being stretched into false drama.",
          "Hovering any result opens a detail card with the champion, queue, grade, KDA, damage, CS and gold per minute, and game length.",
          "Clicking a result jumps straight to that game's review, and every square is reachable by keyboard.",
        ],
      },
      {
        title: "A Champions page with hierarchy",
        items: [
          "Headline tiles summarize the whole collection: champions played, pool win rate, average grade, and challenges outstanding.",
          "Filter chips split the roster into played, untouched, and challenge-bearing champions, each showing its own count alongside search.",
          "Rows gained position numbers, larger portraits, mastery level chips, win-rate bars, and confidence pips, while unplayed champions recede so your real pool reads first.",
        ],
      },
      {
        title: "Polish",
        items: [
          "Champion rows open with Enter or Space, sortable columns advertise themselves before you hover, and the table keeps its header in view inside a contained card.",
          "Riot grade, challenge names, mastery, and position columns fall away in that order as the window narrows rather than crushing together.",
          "The recent-form win rate uses the intended cyan accent again after referencing a colour that was never defined.",
        ],
      },
    ],
  },
  {
    version: "2.0.16",
    releasedAt: "2026-08-02",
    title: "One review, and Tempo that feels the fight",
    summary:
      "Recall unifies match analysis into one tabbed review, makes live Tempo react to the moments that swing a game, and gives ARAM Mayhem augments a polished, champion-aware home.",
    sections: [
      {
        title: "One complete match review",
        items: [
          "Match Overview and Full Review are now one destination with Overview, Performance, Scoreboard, Stats, Timeline, and Win Probability tabs instead of duplicated pages.",
          "The scoreboard follows a compact team-table layout, ARAM games receive their own Poro treatment, and the Stats table fits all ten champions on common desktop screens.",
          "Timeline kills read instantly as killer, League takedown mark, and victim, while the interactive gold timeline keeps score and resource context together.",
        ],
      },
      {
        title: "Live Tempo swings with the game",
        items: [
          "Tempo now shares The Dial's visual language while prioritizing won teamfights, objective secures, killing sprees, shutdowns, and multikills over routine gold movement.",
          "Double, triple, quadra, and pentakills drive Tempo to 100 with gold, green, blue, and purple surge states; enemy swing events can collapse it just as decisively.",
          "The live screen has cleaner spacing, aligned team and resource panels, and champion-specific ARAM Mayhem augment recommendations based on your own Recall history.",
        ],
      },
      {
        title: "Navigation and fidelity",
        items: [
          "Back and forward controls preserve where you were inside Recall, including the selected review tab.",
          "Match history, filters, and summary statistics share one restrained maximum width, with readable player names and item names instead of internal IDs.",
          "Modern and Classic rune pages use their authentic layouts, remain visible inside review rows, and keep detailed rune performance available without breaking the scoreboard.",
        ],
      },
    ],
  },
  {
    version: "2.0.15",
    releasedAt: "2026-08-02",
    title: "A review you can actually read",
    summary:
      "Recall rebuilds match history and Full Review around compact, visual comparisons while repairing every packaged rune, spell, and app-icon path.",
    sections: [
      {
        title: "Compact match history",
        items: [
          "Match rows are substantially shorter, preserve full Riot IDs, and keep performance, build, and both rosters readable without acres of empty space.",
          "Summoner-spell, rune, augment, and Recall artwork now resolve through the packaged app base instead of broken absolute file URLs.",
          "Player setup now presents position, spells, and an explorable rune page as one coherent loadout instead of raw internal IDs and disconnected cards.",
        ],
      },
      {
        title: "A visual Full Review",
        items: [
          "The grade explanation now pairs a lobby-percentile dial with component meters and visual strength, opportunity, and trend callouts.",
          "Prior-game comparisons use a centered improvement axis, explicit current and baseline values, and a confidence-aware summary instead of an empty text block.",
          "The scoreboard is denser, shows complete player names and working rune pages, and turns expanded lane matchups into a scan-friendly comparison sheet rather than a row of cards.",
        ],
      },
    ],
  },
  {
    version: "2.0.14",
    releasedAt: "2026-08-02",
    title: "Rune pages and a sharper review",
    summary:
      "Recall makes match history denser, turns every modern player's runes into an explorable in-client-style page, and makes the gold timeline readable at a glance.",
    sections: [
      {
        title: "Dense, dependable match history",
        items: [
          "Match cards use substantially less padding and vertical space while preserving builds, performance, both teams, and readable Riot IDs.",
          "All modern and League Classic summoner-spell art is bundled with Recall, including the separate Jade spell IDs that Data Dragon does not carry.",
          "Recall now starts hidden in the Windows notification area by default, with a Settings toggle for people who prefer manual startup.",
        ],
      },
      {
        title: "Real rune pages",
        items: [
          "Every modern scoreboard player shows their selected runes; hover, focus, or click opens the full primary and secondary trees with unselected choices dimmed.",
          "Per-rune end-of-game counters explain damage, healing, gold, activations, and other effects using Riot's own metric descriptions.",
          "Recall bundles all 50 League Classic rune definitions and their art. Historical Classic pages remain explicitly unavailable when Riot omits the selections instead of being guessed.",
        ],
      },
      {
        title: "Review and timeline polish",
        items: [
          "Expanded lane comparisons now use compact paired stat tiles instead of oversized bars, and the full scoreboard has clearer hierarchy and interaction states.",
          "Kill events show killer champion, a takedown mark, and victim champion; named live events replace the misleading generic Mayhem copy.",
          "Hover or keyboard-focus the gold chart to inspect time, both teams' gold, the current lead, and kill score at any point in the match.",
        ],
      },
    ],
  },
  {
    version: "2.0.13",
    releasedAt: "2026-08-02",
    title: "See the game before opening it",
    summary:
      "Recall brings richer match cards, deeper scoreboards, live resource confidence, Tempo, and both teams' gold curves into one sharper review experience.",
    sections: [
      {
        title: "Richer match review",
        items: [
          "Match cards now surface the champion, result, role, build, KDA, CS, kill participation, teams, and standout labels without requiring a separate detail view.",
          "Full reviews include complete lobby context, and Riot's recognizable position artwork replaces the generic role symbols.",
          "The match timeline plots Blue and Red team gold independently, keeps objective markers aligned to the relevant team, and summarizes the final resource difference.",
        ],
      },
      {
        title: "Live resource control",
        items: [
          "The live companion estimates both teams' resources from symmetric League Client signals and explains which side currently holds the advantage.",
          "Win confidence combines the resource edge with takedowns, objectives, surviving players, and game time while staying explicitly labeled as an estimate.",
          "The new Tempo gauge reacts to recent lead growth, clean execution, objective swings, deaths, and throws so momentum changes are visible while the game unfolds.",
        ],
      },
    ],
  },
  {
    version: "2.0.12",
    releasedAt: "2026-08-02",
    title: "League Classic joins Recall",
    summary:
      "League Classic is now a first-class game mode with its own Recall grades, records, RVI profile, filters, and analysis instead of being filed under Other.",
    sections: [
      {
        title: "Complete Classic support",
        items: [
          "Current Jade queues and previously recorded Classic games are recognized and kept separate from modern Summoner's Rift, while Classic Co-op vs. AI remains outside performance statistics.",
          "Complete 5v5 Classic lobbies receive lane-aware Recall grades, role comparisons, performance labels, timelines, playstyle measurements, and RVI analysis.",
          "League Classic now appears throughout Matches, Skill, Progress records, dashboard profiles, champion breakdowns, live recommendations, reviews, and practice experiments.",
        ],
      },
    ],
  },
  {
    version: "2.0.11",
    releasedAt: "2026-08-02",
    title: "Enemy roles restored",
    summary:
      "Recall now carries Riot's in-game position for both teams into match history, so enemy players stay in the correct matchup row.",
    sections: [
      {
        title: "Complete role resolution",
        items: [
          "The canonical position exposed for every player by Riot's live game data now fills both allied and enemy post-game roles.",
          "Matches already captured by Recall are repaired from their saved live snapshots, while recent games are recaptured and regraded with the recovered positions.",
          "Position updates are treated as meaningful live-state changes, ensuring the final assignment is saved even when it changes shortly after loading into the game.",
        ],
      },
    ],
  },
  {
    version: "2.0.10",
    releasedAt: "2026-08-02",
    title: "Roles that hold up, and League Classic item art",
    summary:
      "Recall now keeps Riot's post-game position, champion-select assignment, filters, and grades in agreement—and recognizes every League Classic item without needing the network.",
    sections: [
      {
        title: "Role accuracy",
        items: [
          "Riot's estimate of the position actually played now leads, while the position assigned in champion select remains a fallback when post-game evidence is missing.",
          "Invalid or short-game role hints no longer turn an entire lobby into supports, and role-aware filters, comparisons, and grades now share the same answer.",
          "Dodged drafts and abandoned pick intents are cleared before they can attach the wrong assignment to a later match.",
        ],
      },
      {
        title: "League Classic",
        items: [
          "All 416 items Riot marks for League Classic are cataloged from Data Dragon, including dedicated classics such as Atma's Impaler, Frozen Mallet, and Ionic Spark.",
          "The 151 Classic-specific icons are bundled with Recall, so match history and item findings keep their names and artwork offline.",
        ],
      },
    ],
  },
  {
    version: "2.0.9",
    releasedAt: "2026-08-01",
    title: "Roles read the way you played them",
    summary:
      "Recall now believes the position Riot states over the lane it guesses, which stops top laners being filed as junglers and empties the seats nobody actually played.",
    sections: [
      {
        title: "Correct positions",
        items: [
          "The League Client reports most of a team as JUNGLE while naming the real position in a separate field. Recall reads that field first, matching how the Skill page has always filtered.",
          "A duo hint arriving without a lane no longer counts as support. Short games come back with all ten players marked that way, and Recall now says it does not know rather than guessing.",
          "No two players on a team can hold the same position, so when the classification contests one, neither player is seated there and both keep their place on the scoreboard.",
        ],
      },
    ],
  },
  {
    version: "2.0.8",
    releasedAt: "2026-08-01",
    title: "Every player's role, and lane matchups in review",
    summary:
      "Recall captures the position champion select assigned, keeps it beside Riot's own classification, and rebuilds the match and review scoreboards around it.",
    sections: [
      {
        title: "Role tracking",
        items: [
          "Champion select states the position the client assigned, but only for your team and only while it is on screen, so Recall captures it there and holds it until the game it belongs to can be named.",
          "The assignment is stored beside Riot's lane and role rather than replacing them, so nothing Riot reported is thrown away.",
        ],
      },
      {
        title: "Scoreboards",
        items: [
          "The matches list gains an aligned header with role, CS and its per-minute pace, damage, and your rank among the ten.",
          "Full review lays the scoreboard out as lane matchups, with your opponent mirrored on the opposite side and any number of rows open at once.",
          "Opening a matchup compares both players across every recorded statistic.",
        ],
      },
    ],
  },
  {
    version: "2.0.7",
    releasedAt: "2026-08-01",
    title: "Momentum and richer match timelines",
    summary:
      "Recall adds The Dial and makes Mayhem, objective, item, and ability events immediately recognizable in match review.",
    sections: [
      {
        title: "Readable match events",
        items: [
          "Mayhem takedowns recover the acting champion when the League Client omits its participant ID, with an honest victim fallback when the event is ambiguous.",
          "Towers, inhibitors, Baron, dragons, Herald, Void Grubs, and other objectives now use recognizable League Client artwork.",
          "Skill rank-ups use each champion's Q, W, E, or R artwork from Data Dragon, while mode-specific item icons gain a League Client fallback.",
        ],
      },
      {
        title: "The Dial",
        items: [
          "A League-themed ECharts gauge now sits beside Recent Form and blends recent grades, wins, losses, and streak direction into a 0–100 reading.",
          "Three perfect wins puts you Dialed In; a fifth pushes The Dial into Flow State with its strongest effects.",
          "The paired panels stay proportional across desktop and compact layouts, and all gauge motion respects reduced-motion preferences.",
        ],
      },
    ],
  },
  {
    version: "2.0.6",
    releasedAt: "2026-08-01",
    title: "Accurate timeline event counts",
    summary:
      "Recall now rejects duplicated and synthetic League Client timeline events before they can inflate vision measurements or game labels.",
    sections: [
      {
        title: "Trustworthy vision evidence",
        items: [
          "Repeated local-client timeline events are counted once across labels, RVI measurements, and analysis.",
          "Synthetic undefined ward events are excluded, while real trinket and control-ward placements remain available.",
          "Deep Vision is checked against the match's recorded ward total and now explains how many placements qualified out of the full total.",
        ],
      },
    ],
  },
  {
    version: "2.0.5",
    releasedAt: "2026-08-01",
    title: "Your performance, mapped and measured",
    summary:
      "Recall introduces the Recall Vector Index, a dedicated Analyze workspace, and more reliable local-client data capture with a broad performance and stability pass.",
    sections: [
      {
        title: "Recall Vector Index",
        items: [
          "RVI measures eight transparent performance vectors with sample stabilization, evidence coverage, recent movement, and mode-specific Rift or ARAM measurements.",
          "Your RVI shape becomes a recognizable playstyle such as Playmaker, Vanguard, Macro Player, Guardian, or All-Rounder instead of merely repeating the highest categories.",
          "Expand any vector to inspect every available measurement, its score, sample, comparison, and influence on the result.",
        ],
      },
      {
        title: "A new Analyze workspace",
        items: [
          "Explore death density directly over Summoner's Rift as either a continuous heat overlay or individual death dots, with useful location and timing details.",
          "Review performance form, session endurance, match signatures, champion efficiency quadrants, and champion learning curves in one responsive workspace.",
          "Skill filters now include a searchable champion grid, while chart sizing, contrast, disclosure controls, and small-screen layouts are clearer throughout.",
        ],
      },
      {
        title: "Faster and more dependable",
        items: [
          "Recent match timelines now come from the local League Client and are cached in Recall; Riot developer access remains reserved for optional history imports.",
          "IPC subscriptions, chart instances, resize observers, refresh bursts, and League Client discovery now have stricter ownership and cleanup to prevent listener and memory growth.",
          "Numeric chart formatting tolerates incomplete data, and timeline or chart gaps no longer turn missing evidence into misleading zeroes.",
        ],
      },
    ],
  },
  {
    version: "2.0.4",
    releasedAt: "2026-07-31",
    title: "Your playstyle has a name",
    summary:
      "Recall now turns each radar shape into a readable playstyle identity and gives your best-performing champions a fuller dashboard spotlight.",
    sections: [
      {
        title: "Playstyle identities",
        items: [
          "Your strongest radar tendencies now combine into identities such as Duelist, Vanguard, Map Controller, Playmaker, and Battle Medic.",
          "Summoner's Rift and ARAM use mode-specific identities that reflect the measurements available on each map.",
          "Balanced profiles and small samples receive honest All-Rounder, Flexible, or Developing Identity readings instead of a forced archetype.",
        ],
      },
      {
        title: "A fuller dashboard",
        items: [
          "Playstyle now matches Rank over time in height, keeping the dashboard's main comparison row aligned.",
          "Champions in form now shows sample confidence, games, win rate, KDA, and a larger Recall grade for each leading pick.",
          "The richer champion cards remain contained and readable when the dashboard narrows.",
        ],
      },
    ],
  },
  {
    version: "2.0.3",
    releasedAt: "2026-07-31",
    title: "A sharper Recall, inside and out",
    summary:
      "Recall gains deeper timeline-aware game stories, focused ranked progression views, and a polished desktop identity built around its new R.",
    sections: [
      {
        title: "More meaningful game labels",
        items: [
          "Timeline position and event evidence now unlocks more specific labels, including early enemy-jungle invades.",
          "Performance labels use original Recall names instead of terminology associated with other companion apps.",
          "Supported recent games are enriched automatically when a valid Riot API key is available and remain fully usable without one.",
        ],
      },
      {
        title: "Ranked growth in context",
        items: [
          "Dashboard ranked history stays focused on the active season and switches queues from one compact panel.",
          "Skill can compare individual seasons or all recorded seasons from the earliest known LP through today.",
          "Dashboard columns now keep ranked history and recent games balanced against the more compact playstyle and champion panels.",
        ],
      },
      {
        title: "A new desktop identity",
        items: [
          "The supplied gold-and-cyan R now anchors Recall's wordmark, favicon, taskbar icon, and notification-area icon.",
          "A frameless Recall title bar keeps native window behavior while adding branded controls and the running version number.",
          "The Windows icon includes dedicated sizes from 16 through 256 pixels for crisp rendering across desktop surfaces.",
        ],
      },
    ],
  },
  {
    version: "2.0.2",
    releasedAt: "2026-07-31",
    title: "Every standout game gets a story",
    summary:
      "Recall now turns supported Match-V5 evidence into concise post-game labels without making a Riot API key a requirement for recording your history.",
    sections: [
      {
        title: "Evidence-backed game labels",
        items: [
          "See up to six high-signal labels such as Pentakill, Damage Crown, Deathless, Visionary, and Objective Thief on supported games.",
          "Open a game to read the exact statistic or lobby comparison behind every awarded label.",
          "Overlapping labels are suppressed so one performance story does not crowd out the rest of the game.",
        ],
      },
      {
        title: "Optional Riot enrichment",
        items: [
          "A missing or rejected Riot API key never prevents Recall from recording a finished game from the League Client.",
          "Supported Match-V5 games now refresh their full lobby and labels as they enter Recall, while unavailable records are skipped safely.",
        ],
      },
    ],
  },
  {
    version: "2.0.0",
    releasedAt: "2026-07-31",
    title: "Recall Grade, rebuilt around your games",
    summary:
      "Recall 2.0 turns your recorded matches into a clearer performance story, with a more durable champion catalog and an expanded visual language for Skill.",
    sections: [
      {
        title: "A new Skill story",
        items: [
          "Recall Grade now leads Skill with form, consistency, coverage, and a match-by-match Grade Journey.",
          "Explore Grade DNA, play rhythm, weekday ranges, game-length patterns, and champion-pool performance in dedicated visualizations.",
          "Mode and queue scopes make it easier to compare Summoner's Rift, ARAM, Mayhem, and narrower Rift queues without mixing their data.",
        ],
      },
      {
        title: "Charts built for review",
        items: [
          "Interactive charts now cover calendars, scatter plots, heatmaps, treemaps, trends, and evidence instead of flattening every pattern into a list.",
          "Detailed tables and findings remain available beneath the visual summaries when you need the underlying match data.",
        ],
      },
      {
        title: "More durable context",
        items: [
          "Recall preserves a growing local champion catalog so names and analysis remain useful when the League Client is unavailable.",
          "The app brand and navigation now share a dedicated Recall mark for a more consistent identity across the interface.",
        ],
      },
    ],
  },
  {
    version: "1.1.9",
    releasedAt: "2026-07-31",
    title: "Updates that stay out of your way",
    summary:
      "Recall now keeps an eye on new releases while you play, then lets you install them from inside the app when they are ready.",
    sections: [
      {
        title: "Background updates",
        items: [
          "Recall checks for new versions every six hours while it is running.",
          "A ready-to-install update appears as a clear in-app notification on every page.",
          "Restarting to update now installs quietly and relaunches Recall without the normal installer wizard.",
        ],
      },
    ],
  },
  {
    version: "1.1.8",
    releasedAt: "2026-07-31",
    title: "Insights that explain themselves",
    summary:
      "Recall makes your strongest performance patterns easier to compare, while its navigation now gives the main view more room when you need it.",
    sections: [
      {
        title: "Clearer performance signals",
        items: [
          "Item-based findings now show the item's real name and icon everywhere in Skill Insights.",
          "Comparable findings across each Insights section now include relative-effect charts.",
          "Effect charts grow to fit their labels, keeping larger finding groups readable.",
        ],
      },
      {
        title: "A roomier Recall",
        items: [
          "The Recall mark is larger and easier to spot in the app sidebar.",
          "Collapse the sidebar into a tooltip-backed icon rail and Recall will remember your choice.",
        ],
      },
    ],
  },
  {
    version: "1.1.7",
    releasedAt: "2026-07-31",
    title: "Clearer skill insights, anywhere",
    summary:
      "Recall now keeps its key game data readable without the League Client and makes your performance patterns far easier to scan.",
    sections: [
      {
        title: "Offline-ready details",
        items: [
          "Item icons now load correctly in packaged Recall builds.",
          "Champion names remain available from bundled data when the League Client is closed.",
          "The champion pool now names and shows your five most-played champions.",
        ],
      },
      {
        title: "Skill visualizations",
        items: [
          "Game length, time of day, and weekday patterns now combine game volume with recorded win rate.",
          "Playstyle radar labels and adjacent measurements are easier to read at a glance.",
          "The Windows app icon has been rebuilt with tighter taskbar-focused framing.",
        ],
      },
    ],
  },
  {
    version: "1.1.4",
    releasedAt: "2026-07-30",
    title: "Stats that reflect real games",
    summary:
      "Recall now keeps bot games out of your performance history and makes new releases easier to catch up on.",
    sections: [
      {
        title: "Match integrity",
        items: [
          "Bot games no longer count toward personal records, champion stats, insights, or reviews.",
          "Previously imported bot matches are excluded from your tracked history.",
          "Legacy challenges stay hidden unless you select them from the challenge filters.",
        ],
      },
      {
        title: "Application updates",
        items: [
          "Patch notes now open once after installing a new Recall version.",
          "Browse the full patch notes archive at any time from Settings.",
        ],
      },
    ],
  },
  {
    version: "1.1.3",
    releasedAt: "2026-07-30",
    title: "Better challenge browsing",
    summary:
      "Challenge hunting is faster, clearer, and no longer pulls you away from what you were doing.",
    sections: [
      {
        title: "Challenges",
        items: [
          "Open challenge details from the dashboard without leaving the page.",
          "Completed challenges are hidden by default, with a filter when you want to see them.",
          "Sort challenges by closest to the next tier, level, name, category, or last update.",
        ],
      },
    ],
  },
  {
    version: "1.1.2",
    releasedAt: "2026-07-29",
    title: "Live companion overhaul",
    summary:
      "The Live Game screen now gives you a much stronger read on the lobby and the match as it unfolds.",
    sections: [
      {
        title: "Live Game",
        items: [
          "Expanded the live companion with richer player, champion, and team context.",
          "Improved the in-game layout so useful information stays readable at a glance.",
          "Polished the post-game timeline and review handoff.",
        ],
      },
    ],
  },
  {
    version: "1.1.1",
    releasedAt: "2026-07-29",
    title: "More trustworthy match reviews",
    summary:
      "Match details and timelines now preserve more of what actually happened in game.",
    sections: [
      {
        title: "Match data",
        items: [
          "Added richer participant stats and item, rune, spell, and augment details.",
          "Improved timeline event mapping for more accurate reviews.",
          "Added a historical detail re-import for matches recorded by older versions.",
        ],
      },
    ],
  },
  {
    version: "1.1.0",
    releasedAt: "2026-07-29",
    title: "A personal review platform",
    summary:
      "Recall grew from a match tracker into a place to review games and deliberately improve.",
    sections: [
      {
        title: "Review",
        items: [
          "Review match timelines, key moments, and performance after each game.",
          "Create practice experiments and track whether they helped.",
          "Get champion recommendations based on your own match history.",
        ],
      },
      {
        title: "Data safety",
        items: [
          "Added managed database backups, integrity checks, and safe restore tools.",
          "Improved update snapshots so your history stays protected between releases.",
        ],
      },
    ],
  },
]

export const currentAppVersion = packageJson.version

export function patchNotesForVersion(
  version: string,
): PatchNoteRelease | undefined {
  return patchNotes.find((release) => release.version === version)
}

export function hasUnseenPatchNotes(
  seenVersion: string | undefined,
  version = currentAppVersion,
) {
  return seenVersion !== version && patchNotesForVersion(version) !== undefined
}
