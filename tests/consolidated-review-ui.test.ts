import fs from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => fs.readFileSync(path, "utf8")

describe("consolidated match review UI", () => {
  it("routes match clicks into Review and exposes title-bar history", () => {
    const app = read("src/App.vue")
    const navigation = read("src/helpers/navigation.ts")
    const titlebar = read("src/components/WindowTitleBar.vue")

    expect(app).not.toContain("<MatchSheet")
    expect(navigation).toContain("reviewGameId?: number")
    expect(navigation).toContain("export function goBack()")
    expect(navigation).toContain("export function goForward()")
    expect(navigation).toMatch(/openMatch[\s\S]*reviewMatch\(match\.gameId\)/)
    expect(titlebar).toContain('aria-label="Page history"')
    expect(titlebar).toContain(":disabled=\"!canGoBack\"")
    expect(titlebar).toContain(":disabled=\"!canGoForward\"")
    expect(titlebar).toContain('event.key === "ArrowLeft"')
    expect(titlebar).toContain('event.key === "ArrowRight"')
    expect(titlebar).toContain('title="Back (Alt+Left)"')
  })

  it("uses one tabbed match destination with the requested review surfaces", () => {
    const review = read("src/pages/ReviewPage.vue")
    const rviProfile = read("src/components/skill/PerformanceProfile.vue")

    expect(review).toContain("<MatchReviewHero")
    expect(review).toContain('type MatchTab = "overview" | "stats" | "timeline" | "probability"')
    expect(review).toContain("<ReviewScoreboard")
    expect(review).toContain("<MatchStatsTable")
    expect(review).toContain("<RviPerformanceProfile")
    expect(rviProfile).toContain("<PerformanceRadar")
    expect(review).toContain("<WinProbabilityChart")
    expect(review).toContain("<MatchDeathMap")
    expect(review).toContain("Team gold advantage")
    expect(review).toContain('{ value: "rvi", label: "RVI" }')
    expect(review).toMatch(/getRviProfile\([\s\S]*?family, "match"\)/)
    expect(review).toContain("hasGameRviEvidence")
    expect(review).toContain("Match RVI evidence is unavailable")
    expect(rviProfile).toContain("Formula and evidence")
    expect(review).toContain('label: "Grade & context"')
    expect(review).toContain('class="match-content-shell"')
    expect(review).toContain('class="match-tab-surface"')
    expect(review).toContain('<section class="insight-shell card"')
    expect(review).not.toContain('<section v-if="matchTab === \'overview\'" class="insight-shell card"')
    expect(review).not.toContain('matchTab === \'overview\' && insightTab')
    expect(review.indexOf('class="insight-shell card"')).toBeLessThan(
      review.indexOf('class="match-tabs"'),
    )
    expect(review).not.toContain('id: "gold"')
    expect(review).toContain('v-if="matchTab === \'timeline\'" class="card match-tab-panel"')
    expect(review).toContain('class="gold-chart-wrap"')
    expect(review).not.toContain("Every build, role, rune page, and contribution at a glance")
    expect(review).not.toContain("Complete lobby")
  })

  it("offers mode-aware, champion-filtered death positions beside the gold curve", () => {
    const deathMap = read("src/components/MatchDeathMap.vue")
    const coordinates = read("src/helpers/map-coordinate.ts")

    expect(deathMap).toContain("reviewMapId(props.match.modeFamily)")
    expect(deathMap).toContain("mapPositionPercent")
    expect(coordinates).toContain('if (modeFamily === "classic") return 453')
    expect(coordinates).toContain("14_881")
    expect(deathMap).toContain("selectedParticipantId")
    expect(deathMap).toContain('event.type !== "CHAMPION_KILL"')
    expect(fs.statSync("public/game-data/ui/map11.png").size).toBeGreaterThan(100_000)
    expect(fs.statSync("public/game-data/ui/map12.png").size).toBeGreaterThan(100_000)
    expect(fs.statSync("public/game-data/ui/map453.png").size).toBeGreaterThan(100_000)
  })

  it("plays positioned timeline frames on a synchronized review map", () => {
    const review = read("src/pages/ReviewPage.vue")
    const playback = read("src/components/MatchPlaybackMap.vue")

    expect(review).toContain("<MatchPlaybackMap")
    expect(review).toContain('type TimelineMapView = "deaths" | "playback"')
    expect(review).toContain('label: "Deaths"')
    expect(review).toContain('label: "Playback"')
    expect(review).toContain("v-if=\"timelineMapView === 'deaths'\"")
    expect(review).toContain('class="timeline-visuals"')
    expect(review).toContain('@pointerdown="beginTimelineScrub"')
    expect(review).toContain('@click="selectTimelineTimestamp(marker.event.timestamp)"')
    expect(review).toContain(':frames="review.timeline.summary.frames"')
    expect(review).toContain('v-model:timestamp="timelineCursorTimestamp"')
    expect(playback).toContain("playbackPositionsAt")
    expect(playback).toContain("playbackWorldMarkers")
    expect(playback).toContain("requestAnimationFrame")
    expect(playback).toContain("[1, 2, 4, 10]")
    expect(playback).toContain("between periodic observations")
    expect(playback).toContain('type="range"')
    expect(playback).toContain("prefers-reduced-motion")
  })

  it("returns teams and labels as part of the unified review payload", () => {
    const service = read("electron/main/review/review-service.ts")
    const types = read("src/types/review.ts")

    expect(service).toContain("teams: detail.teams")
    expect(service).toContain("labels: this.matches.getPerformanceLabels")
    expect(types).toContain("teams: TeamRow[]")
    expect(types).toContain("labels: PerformanceLabel[]")
  })

  it("keeps interactive rune pages in the Blitz-inspired scoreboard", () => {
    const scoreboard = read("src/components/ReviewScoreboard.vue")

    expect(scoreboard).toContain("<RunePage")
    expect(scoreboard).toContain(":classic=\"match.modeFamily === 'classic'\"")
    expect(scoreboard).toContain("team-bans")
    expect(scoreboard).toContain("damage-cell")
  })
})
