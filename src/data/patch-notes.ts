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
