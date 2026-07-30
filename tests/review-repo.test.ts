import Database from "better-sqlite3-node"
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations } from "../electron/main/database/migrations.js"
import { MatchesRepository } from "../electron/main/database/matches-repo.js"
import { ReviewRepository } from "../electron/main/database/review-repo.js"
import { buildMatchRow } from "./fixtures/matches.js"

const PUUID = "test-puuid"
let db: Database.Database
let matches: MatchesRepository
let reviews: ReviewRepository

beforeEach(() => {
  db = new Database(":memory:")
  db.pragma("foreign_keys = ON")
  applyMigrations(db)
  matches = new MatchesRepository(db)
  reviews = new ReviewRepository(db)
  matches.insertMany([buildMatchRow({ gameId: 1 })])
})

describe("ReviewRepository", () => {
  it("normalizes reusable tags case-insensitively", () => {
    const first = reviews.createTag(PUUID, "  Good   engage  ")
    const second = reviews.createTag(PUUID, "good engage")
    expect(first.id).toBe(second.id)
    expect(first.name).toBe("Good engage")
    expect(reviews.listTags(PUUID)).toHaveLength(1)
  })

  it("saves notes, bookmarks, and up to twenty account-owned tags", () => {
    const tag = reviews.createTag(PUUID, "Review")
    const foreign = reviews.createTag("someone-else", "Foreign")
    const saved = reviews.saveAnnotation(1, PUUID, {
      note: "Watch the second fight.",
      bookmarked: true,
      tagIds: [tag.id, foreign.id],
    })
    expect(saved).toMatchObject({
      note: "Watch the second fight.",
      bookmarked: true,
    })
    expect(saved.tags.map((entry) => entry.name)).toEqual(["Review"])
  })

  it("attaches every matching active experiment and preserves outcomes", () => {
    const experiment = reviews.createExperiment(PUUID, {
      name: "Track deaths",
      hypothesis: "Fewer isolated deaths",
      championIds: [84],
      modes: ["aram"],
    })
    expect(reviews.attachMatchingExperiments(buildMatchRow({
      gameId: 1,
      playedAt: Date.now() + 1,
    }))).toBe(1)
    expect(reviews.setExperimentOutcome(
      1,
      PUUID,
      experiment.id,
      "mixed",
      "One avoidable death",
    )).toBe(true)
    expect(reviews.getAnnotation(1, PUUID).experimentOutcomes[0]).toMatchObject({
      outcome: "mixed",
      note: "One avoidable death",
    })
  })

  it("cascades all match-owned review records when a match is deleted", () => {
    const tag = reviews.createTag(PUUID, "Saved")
    reviews.saveAnnotation(1, PUUID, {
      note: "note",
      bookmarked: true,
      tagIds: [tag.id],
    })
    reviews.setBoundaryOverride(1, PUUID, "split")
    matches.deleteAll(PUUID)
    expect(db.prepare("SELECT COUNT(*) AS count FROM match_annotations").get())
      .toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM match_annotation_tags").get())
      .toEqual({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_boundary_overrides").get())
      .toEqual({ count: 0 })
    expect(reviews.listTags(PUUID)).toHaveLength(1)
  })
})
