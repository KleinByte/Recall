<script setup lang="ts">
import { computed, ref, watch } from "vue"
import GradeBadge from "./GradeBadge.vue"
import StyleRadar from "./StyleRadar.vue"
import {
  Button as UiButton,
  Dialog as UiDialog,
  EmptyState,
  ScrollArea,
  Surface,
  TelemetryGrid,
} from "./ui"
import { api } from "../helpers/api"
import { closeChampion } from "../helpers/navigation"
import {
  championIconUrl,
  championNameById,
  formatCompact,
  formatDecimal,
  formatPercent,
  formatRelativeDate,
  GRADE_ORDER,
  modeLabel,
} from "../helpers/format"
import { recallGradeFromRoleFitScore } from "../shared/recall-grade"
import type { Champion } from "../types/lol"
import type {
  ChampionNeed,
  GradeCount,
  MatchRow,
  ModeFamily,
  StatsSummary,
  StyleAxis,
  StyleProfile,
} from "../types/stats"

const props = defineProps<{
  championId: number
  champions: Champion[] | null
}>()

/** A gap this size against your own average is worth pointing out. */
const NOTABLE_GAP = 0.04

const summary = ref<StatsSummary | null>(null)
const grades = ref<GradeCount[]>([])
const championStyle = ref<StyleProfile | undefined>(undefined)
const overallStyle = ref<StyleProfile | undefined>(undefined)
const best = ref<MatchRow[]>([])
const worst = ref<MatchRow[]>([])
const needs = ref<ChampionNeed[]>([])
const family = ref<ModeFamily>("aram")
const loading = ref(true)

async function load(championId: number) {
  loading.value = true
  try {
    const filter = { championIds: [championId] }

    // A champion may be played in any supported family, so the breakdown follows
    // wherever it has actually been played most.
    const [aram, rift, classic] = await Promise.all([
      api.getStyleReport({ ...filter, modeFamily: "aram" }, "aram"),
      api.getStyleReport({ ...filter, modeFamily: "sr" }, "sr"),
      api.getStyleReport({ ...filter, modeFamily: "classic" }, "classic"),
    ])

    const styles = [
      { family: "aram" as const, report: aram },
      { family: "sr" as const, report: rift },
      { family: "classic" as const, report: classic },
    ]
    const selected = styles.reduce((best, entry) =>
      (entry.report.career?.games ?? 0) > (best.report.career?.games ?? 0) ? entry : best,
    )
    family.value = selected.family
    championStyle.value = selected.report.career

    const [nextSummary, nextGrades, overall, bestGames, worstGames, championNeeds] =
      await Promise.all([
        api.getSummary(filter),
        api.getGradeDistribution(filter),
        api.getStyleReport({ modeFamily: family.value }, family.value),
        api.listMatches(
          { ...filter, sortBy: "grade", sortDir: "desc" },
          1,
          3,
        ),
        api.listMatches({ ...filter, sortBy: "grade", sortDir: "asc" }, 1, 3),
        api.getChampionNeeds([championId]),
      ])

    summary.value = nextSummary
    grades.value = nextGrades
    overallStyle.value = overall.career
    best.value = bestGames.rows.filter((row) => row.grade)
    worst.value = worstGames.rows.filter((row) => row.grade)
    needs.value = championNeeds[championId] ?? []
  } catch {
    summary.value = null
  } finally {
    loading.value = false
  }
}

watch(() => props.championId, load, { immediate: true })

const name = computed(() => championNameById(props.champions, props.championId))
const detail = computed(() => championStyle.value?.detail)
const averageGrade = computed(() => recallGradeFromRoleFitScore(summary.value?.avgRoleFitScore))
const hasGames = computed(() => (summary.value?.games ?? 0) > 0)

type TelemetryReading = {
  label: string
  value: string
  hint?: string
  tone?: "neutral" | "win" | "loss"
}

const telemetryReadings = computed<TelemetryReading[]>(() => {
  if (!summary.value) return []
  return [
    {
      label: "Games",
      value: summary.value.games.toString(),
      hint: `${summary.value.wins}W · ${summary.value.losses}L`,
    },
    {
      label: "Win rate",
      value: formatPercent(summary.value.winRate),
      tone: summary.value.winRate >= 0.5 ? "win" : "loss",
    },
    {
      label: "Avg RoleFit",
      value: summary.value.avgRoleFitScore?.toFixed(1) ?? "–",
      hint: `${averageGrade.value ?? "No grade"} · ${summary.value.gradedGames} graded`,
    },
    { label: "KDA", value: formatDecimal(summary.value.kda, 2) },
    ...(detail.value ? [
      { label: "Damage / min", value: formatCompact(detail.value.damagePerMin) },
      { label: "Gold / min", value: formatCompact(detail.value.goldPerMin) },
      { label: "Deaths / game", value: formatDecimal(detail.value.avgDeaths, 1) },
    ] : []),
  ]
})

/**
 * How this champion differs from the way you play everything else.
 *
 * Comparing against your own average is the only honest yardstick available,
 * and it answers the useful question: is this champion pulling your game in a
 * direction, and is that on purpose?
 */
const differences = computed(() => {
  const mine = championStyle.value?.axes
  const baseline = overallStyle.value?.axes
  if (!mine || !baseline) return []

  return mine
    .map((axis: StyleAxis) => {
      const other = baseline.find((entry) => entry.key === axis.key)
      return { ...axis, delta: axis.value - (other?.value ?? axis.value) }
    })
    .filter((axis) => Math.abs(axis.delta) >= NOTABLE_GAP)
    .sort((a, b) => b.delta - a.delta)
})

const strengths = computed(() => differences.value.filter((a) => a.delta > 0))
const weaknesses = computed(() =>
  differences.value.filter((a) => a.delta < 0).reverse(),
)

const gradeBars = computed(() => {
  const byGrade = new Map(grades.value.map((entry) => [entry.grade, entry.count]))
  const highest = Math.max(1, ...grades.value.map((entry) => entry.count))

  return GRADE_ORDER.filter((grade) => byGrade.has(grade)).map((grade) => ({
    grade,
    count: byGrade.get(grade)!,
    share: (byGrade.get(grade)! / highest) * 100,
  }))
})
</script>

<template>
  <UiDialog
    labelled-by="champion-detail-title"
    size="wide"
    align="top"
    padding="none"
    @close="closeChampion()"
  >
    <div class="sheet">
      <header class="sheet-head">
        <img :src="championIconUrl(championId)" :alt="name" class="portrait" />
        <div>
          <h2 id="champion-detail-title" class="name">{{ name }}</h2>
          <p v-if="summary && hasGames" class="muted line">
            {{ summary.games }} games · {{ summary.wins }}W {{ summary.losses }}L
            · {{ formatPercent(summary.winRate) }} win rate
          </p>
          <p v-else class="muted line">No recorded games yet</p>
        </div>
        <GradeBadge v-if="averageGrade" :grade="averageGrade" size="lg" />
        <UiButton
          class="close"
          variant="ghost"
          icon-only
          size="compact"
          title="Close champion details"
          aria-label="Close champion details"
          @click="closeChampion()"
        >×</UiButton>
      </header>

      <EmptyState
        v-if="loading"
        compact
        title="Reading your games"
        :description="`Recall is assembling your ${name} profile.`"
      />

      <template v-else-if="hasGames">
        <TelemetryGrid label="Champion telemetry" :readings="telemetryReadings" />

        <div class="body">
          <Surface as="section" variant="inset" padding="compact" class="chart-side">
            <StyleRadar
              v-if="championStyle && overallStyle"
              :axes="championStyle.axes"
              :recent="overallStyle.axes"
              :primary-label="name"
              secondary-label="You, overall"
            />
            <p class="muted footnote">
              Gold is {{ name }}. Blue is how you play
              {{ family === "sr" ? "Summoner's Rift" : family === "classic" ? "League Classic" : "ARAM" }} overall.
            </p>
          </Surface>

          <Surface as="section" variant="quiet" padding="compact" class="reading-side">
            <div v-if="strengths.length" class="block">
              <h3 class="block-title">Better than your usual</h3>
              <ul class="delta-list">
                <li v-for="axis in strengths" :key="axis.key">
                  <span class="axis-label">{{ axis.label }}</span>
                  <span class="numeric delta up">
                    +{{ Math.round(axis.delta * 100) }}
                  </span>
                </li>
              </ul>
            </div>

            <div v-if="weaknesses.length" class="block">
              <h3 class="block-title">Where you slip</h3>
              <ul class="delta-list">
                <li v-for="axis in weaknesses" :key="axis.key">
                  <span class="axis-label">{{ axis.label }}</span>
                  <span class="numeric delta down">
                    {{ Math.round(axis.delta * 100) }}
                  </span>
                </li>
              </ul>
            </div>

            <p v-if="!differences.length" class="muted note">
              You play this champion much as you play everything else.
            </p>

            <div v-if="gradeBars.length" class="block">
              <h3 class="block-title">Grades</h3>
              <div class="grades">
                <div v-for="bar in gradeBars" :key="bar.grade" class="grade-row">
                  <GradeBadge :grade="bar.grade" />
                  <span class="track">
                    <span class="fill" :style="{ width: `${bar.share}%` }" />
                  </span>
                  <span class="muted numeric count">{{ bar.count }}</span>
                </div>
              </div>
            </div>
          </Surface>
        </div>

        <div class="split">
          <Surface v-if="best.length" as="section" variant="inset" padding="compact" class="block game-block">
            <h3 class="block-title">Your best games</h3>
            <ul class="game-list">
              <li v-for="game in best" :key="game.gameId">
                <GradeBadge :grade="game.grade" />
                <span class="numeric">
                  {{ game.kills }}/{{ game.deaths }}/{{ game.assists }}
                </span>
                <span class="muted">{{ modeLabel(game.mode) }}</span>
                <span class="muted">{{ formatRelativeDate(game.playedAt) }}</span>
              </li>
            </ul>
          </Surface>

          <Surface v-if="worst.length" as="section" variant="inset" padding="compact" class="block game-block">
            <h3 class="block-title">Your worst games</h3>
            <ul class="game-list">
              <li v-for="game in worst" :key="game.gameId">
                <GradeBadge :grade="game.grade" />
                <span class="numeric">
                  {{ game.kills }}/{{ game.deaths }}/{{ game.assists }}
                </span>
                <span class="muted">{{ modeLabel(game.mode) }}</span>
                <span class="muted">{{ formatRelativeDate(game.playedAt) }}</span>
              </li>
            </ul>
          </Surface>
        </div>
      </template>

      <EmptyState
        v-else
        compact
        title="No recorded games yet"
        :description="`Recall has not recorded a game on ${name} yet.`"
      />

      <Surface v-if="needs.length" as="section" variant="inset" padding="compact" class="block needs-block">
        <h3 class="block-title">
          Challenges {{ name }} still counts towards ({{ needs.length }})
        </h3>
        <ScrollArea max-height="180px">
          <ul class="need-list">
            <li v-for="need in needs" :key="need.challengeId">
              <span class="need-name">{{ need.name }}</span>
              <span class="muted numeric">
                {{ formatCompact(need.currentValue) }}
                <template v-if="need.nextThreshold">
                  / {{ formatCompact(need.nextThreshold) }}
                </template>
              </span>
            </li>
          </ul>
        </ScrollArea>
      </Surface>
    </div>
  </UiDialog>
</template>

<style scoped>
.sheet {
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  gap: var(--ui-space-4);
  padding: var(--ui-space-5);
  overflow-y: auto;
  container: champion-detail / inline-size;
}

.sheet > * {
  flex: 0 0 auto;
}

.sheet-head {
  display: flex;
  align-items: center;
  gap: var(--ui-space-3);
  padding-bottom: var(--ui-space-3);
  border-bottom: 1px solid var(--ui-divider);
}

.portrait {
  width: 52px;
  height: 52px;
  border-radius: var(--ui-radius-md);
  border: 1px solid var(--ui-border-emphasis);
}

.name {
  font-family: var(--ui-font-display);
  font-size: 20px;
  margin: 0;
  color: var(--ui-text-heading);
  letter-spacing: 0.6px;
}

.line {
  margin: 2px 0 0;
  font-size: 12px;
}

.close {
  margin-left: auto;
  align-self: flex-start;
  font-size: 24px;
  line-height: 1;
}

.note {
  font-size: 12px;
  margin: 0;
}

.body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 0.9fr);
  gap: var(--ui-space-4);
  align-items: start;
}

.footnote {
  font-size: 11px;
  margin: var(--ui-space-2) 0 0;
  text-align: center;
}

.reading-side {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-4);
  box-shadow: none;
}

.block-title {
  font-family: var(--ui-font-heading);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--ui-text-subtle);
  margin: 0 0 var(--ui-space-2);
}

.delta-list,
.game-list,
.need-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
  font-size: 12px;
}

.delta-list li,
.need-list li {
  display: flex;
  justify-content: space-between;
  gap: var(--ui-space-3);
}

.axis-label,
.need-name {
  color: var(--ui-text-subtle);
}

.delta.up {
  color: var(--ui-positive);
}

.delta.down {
  color: var(--ui-negative);
}

.grades {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-2);
}

.grade-row {
  display: grid;
  grid-template-columns: 38px 1fr 28px;
  align-items: center;
  gap: var(--ui-space-2);
}

/* Only the difference from the global bar primitive. */
.track {
  height: 5px;
}

.count {
  text-align: right;
  font-size: 11px;
}

.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--ui-space-4);
}

.game-list li {
  display: flex;
  align-items: center;
  gap: var(--ui-space-3);
}

@container champion-detail (max-width: 720px) {
  .body {
    grid-template-columns: minmax(0, 1fr);
  }

  .sheet-head { align-items: flex-start; flex-wrap: wrap; }
  .sheet-head .close { margin-left: auto; }
}

@container champion-detail (max-width: 480px) {
  .sheet { padding: var(--ui-space-4); }
  .portrait { width: 44px; height: 44px; }
  .game-list li { display: grid; grid-template-columns: 34px 1fr; gap: var(--ui-space-2); }
  .game-list li > :nth-child(n + 3) { grid-column: 2; }
}
</style>
