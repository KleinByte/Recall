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
    version: "2.0.2",
    releasedAt: "2026-07-31",
    title: "Every standout game gets a story",
    summary:
      "Recall now turns supported Match-V5 evidence into concise post-game labels without making a Riot API key a requirement for recording your history.",
    sections: [
      {
        title: "Evidence-backed game labels",
        items: [
          "See up to six high-signal labels such as Pentakill, Ouch, You Hurt, Deathless, Visionary, and Objective Thief on supported games.",
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
