<script setup lang="ts">
import { computed, ref, watch } from "vue"
import GradeBadge from "./GradeBadge.vue"
import StyleRadar from "./StyleRadar.vue"
import ScrollArea from "./ui/ScrollArea.vue"
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
  gradeFromScore,
  modeLabel,
} from "../helpers/format"
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

    // A champion may be played in either place, so the breakdown follows
    // wherever it has actually been played most.
    const [aram, rift] = await Promise.all([
      api.getStyleReport({ ...filter, modeFamily: "aram" }, "aram"),
      api.getStyleReport({ ...filter, modeFamily: "sr" }, "sr"),
    ])

    const aramGames = aram.career?.games ?? 0
    const riftGames = rift.career?.games ?? 0
    family.value = riftGames > aramGames ? "sr" : "aram"

    championStyle.value = (family.value === "sr" ? rift : aram).career

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
const averageGrade = computed(() => gradeFromScore(summary.value?.avgGradeScore))
const hasGames = computed(() => (summary.value?.games ?? 0) > 0)

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
  <div class="backdrop" @click.self="closeChampion()">
    <div class="sheet card">
      <header class="sheet-head">
        <img :src="championIconUrl(championId)" :alt="name" class="portrait" />
        <div>
          <h2 class="name">{{ name }}</h2>
          <p v-if="summary && hasGames" class="muted line">
            {{ summary.games }} games · {{ summary.wins }}W {{ summary.losses }}L
            · {{ formatPercent(summary.winRate) }} win rate
          </p>
          <p v-else class="muted line">No recorded games yet</p>
        </div>
        <GradeBadge v-if="averageGrade" :grade="averageGrade" size="lg" />
        <button class="close" title="Close" @click="closeChampion()">×</button>
      </header>

      <p v-if="loading" class="muted note">Reading your games…</p>

      <template v-else-if="hasGames">
        <div class="kpis">
          <div class="kpi">
            <span class="muted kpi-label">KDA</span>
            <span class="numeric kpi-value">
              {{ formatDecimal(summary!.kda, 2) }}
            </span>
          </div>
          <div v-if="detail" class="kpi">
            <span class="muted kpi-label">Damage / min</span>
            <span class="numeric kpi-value">
              {{ formatCompact(detail.damagePerMin) }}
            </span>
          </div>
          <div v-if="detail" class="kpi">
            <span class="muted kpi-label">Gold / min</span>
            <span class="numeric kpi-value">
              {{ formatCompact(detail.goldPerMin) }}
            </span>
          </div>
          <div v-if="detail" class="kpi">
            <span class="muted kpi-label">Deaths / game</span>
            <span class="numeric kpi-value">
              {{ formatDecimal(detail.avgDeaths, 1) }}
            </span>
          </div>
        </div>

        <div class="body">
          <div class="chart-side">
            <StyleRadar
              v-if="championStyle && overallStyle"
              :axes="championStyle.axes"
              :recent="overallStyle.axes"
              :primary-label="name"
              secondary-label="You, overall"
            />
            <p class="muted footnote">
              Gold is {{ name }}. Blue is how you play
              {{ family === "sr" ? "Summoner's Rift" : "ARAM" }} overall.
            </p>
          </div>

          <div class="reading-side">
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
          </div>
        </div>

        <div class="split">
          <div v-if="best.length" class="block">
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
          </div>

          <div v-if="worst.length" class="block">
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
          </div>
        </div>
      </template>

      <p v-else class="muted note">
        Recall has not recorded a game on {{ name }} yet.
      </p>

      <div v-if="needs.length" class="block">
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
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(3, 8, 18, 0.72);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-6) var(--space-5);
  z-index: 50;
  overflow-y: auto;
}

.sheet {
  width: min(980px, 100%);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5) var(--space-5);
}

.sheet-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.portrait {
  width: 52px;
  height: 52px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-strong);
}

.name {
  font-family: var(--font-display);
  font-size: 20px;
  margin: 0;
  color: var(--gold-bright);
  letter-spacing: 0.6px;
}

.line {
  margin: 2px 0 0;
  font-size: 12px;
}

.close {
  margin-left: auto;
  align-self: flex-start;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

.close:hover {
  color: var(--text-primary);
}

.note {
  font-size: 12px;
  margin: 0;
}

.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--space-3);
}

.kpi {
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.kpi-label {
  font-size: 10px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.kpi-value {
  font-size: 18px;
  color: var(--text-primary);
}

.body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 0.9fr);
  gap: var(--space-5);
  align-items: start;
}

.footnote {
  font-size: 11px;
  margin: var(--space-2) 0 0;
  text-align: center;
}

.reading-side {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.block-title {
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin: 0 0 var(--space-2);
}

.delta-list,
.game-list,
.need-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: 12px;
}

.delta-list li,
.need-list li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
}

.axis-label,
.need-name {
  color: var(--text-secondary);
}

.delta.up {
  color: var(--win);
}

.delta.down {
  color: var(--loss);
}

.grades {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.grade-row {
  display: grid;
  grid-template-columns: 38px 1fr 28px;
  align-items: center;
  gap: var(--space-2);
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
  gap: var(--space-5);
}

.game-list li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

@media (max-width: 900px) {
  .body {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
