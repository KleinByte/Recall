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
