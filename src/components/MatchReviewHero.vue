<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import { faMedal, faTrophy } from "@fortawesome/free-solid-svg-icons"
import GradeBadge from "./GradeBadge.vue"
import TelemetryGrid from "./ui/TelemetryGrid.vue"
import { labelIcon } from "../helpers/label-icons"
import { lobbyStandings } from "../helpers/match-detail"
import { positionForPlayer, positionIconUrl, positionLabel } from "../helpers/roles"
import {
  championIconUrl,
  championNameById,
  formatCompact,
  formatDecimal,
  formatDuration,
  formatRelativeDate,
  formatRecordValue,
  modeLabel,
} from "../helpers/format"
import type { Champion } from "../types/lol"
import type { MatchReview } from "../types/review"

const props = defineProps<{
  review: MatchReview
  champions: Champion[] | null
}>()

defineEmits<{ (event: "bookmark"): void }>()

const owner = computed(() => props.review.scoreboard.find((row) => row.isPlayer === 1))
const standings = computed(() => lobbyStandings(props.review.scoreboard))
const standing = computed(() => owner.value
  ? standings.value.get(owner.value.participantId)
  : undefined)
const role = computed(() => owner.value
  ? positionForPlayer(owner.value)
  : undefined)
const kda = computed(() => props.review.match.deaths === 0
  ? props.review.match.kills + props.review.match.assists
  : (props.review.match.kills + props.review.match.assists) / props.review.match.deaths)
const patch = computed(() => props.review.match.gameVersion.split(".").slice(0, 2).join("."))
const showAllRecords = ref(false)
const showAllLabels = ref(false)
const visibleRecords = computed(() => showAllRecords.value
  ? props.review.records
  : props.review.records.slice(0, 6))
const visibleLabels = computed(() => showAllLabels.value
  ? props.review.labels
  : props.review.labels.slice(0, 6))
const matchTelemetry = computed(() => [
  {
    label: "KDA",
    value: `${props.review.match.kills}/${props.review.match.deaths}/${props.review.match.assists}`,
    hint: `${formatDecimal(kda.value, 2)} ratio`,
    tone: props.review.match.win ? "win" as const : "loss" as const,
  },
  {
    label: "Damage",
    value: formatCompact(props.review.match.damageToChampions),
    hint: "to champions",
  },
  {
    label: "Gold",
    value: formatCompact(props.review.match.goldEarned),
    hint: "earned",
  },
  {
    label: "Creep score",
    value: (props.review.match.totalMinionsKilled + props.review.match.neutralMinions).toString(),
    hint: `${formatDecimal(props.review.match.csPerMin ?? 0, 1)} per minute`,
  },
  {
    label: "Lobby place",
    value: standing.value?.place ? `#${standing.value.place}` : "—",
    hint: standing.value
      ? `of ${standing.value.of} by Recall grade`
      : "Complete grades unavailable",
  },
])

watch(() => props.review.match.gameId, () => {
  showAllRecords.value = false
  showAllLabels.value = false
})

const evidence = (label: MatchReview["labels"][number]) =>
  Object.entries(label.evidence).map(([key, value]) => `${key}: ${value}`).join(", ")
</script>

<template>
  <section class="match-hero" :class="review.match.win ? 'won' : 'lost'">
    <header class="hero-main">
      <img
        class="portrait"
        :src="championIconUrl(review.match.championId)"
        :alt="championNameById(champions, review.match.championId)"
      />
      <div class="identity">
        <div class="eyebrow">
          <span :class="review.match.win ? 'win-text' : 'loss-text'">{{ review.match.win ? "Victory" : "Defeat" }}</span>
          <span>{{ review.match.queueName ?? modeLabel(review.match.mode) }}</span>
          <span>{{ formatRelativeDate(review.match.playedAt) }}</span>
          <span>Patch {{ patch }}</span>
        </div>
        <h1>{{ championNameById(champions, review.match.championId) }}</h1>
        <p>
          {{ formatDuration(review.match.durationSecs) }}
          <template v-if="role">
            <span class="separator">·</span>
            <img :src="positionIconUrl(role)" alt="" /> {{ positionLabel(role) }}
          </template>
        </p>
      </div>

      <span v-if="standing?.place === 1" class="mvp-badge">
        <FontAwesomeIcon :icon="faMedal" aria-hidden="true" /> MVP
      </span>
      <GradeBadge :grade="review.match.grade" size="lg" />
      <button
        class="league-button bookmark"
        :aria-pressed="review.annotation.bookmarked"
        @click="$emit('bookmark')"
      >
        {{ review.annotation.bookmarked ? "★ Bookmarked" : "☆ Bookmark" }}
      </button>
    </header>

    <TelemetryGrid
      class="hero-kpis"
      label="Match telemetry"
      :columns="5"
      :readings="matchTelemetry"
    />

    <div v-if="review.records.length" class="record-holders" aria-label="Personal records held by this game">
      <div class="record-heading">
        <FontAwesomeIcon :icon="faTrophy" aria-hidden="true" />
        <span><strong>Current personal records</strong><small>{{ review.records.length }} held in this mode</small></span>
      </div>
      <div class="record-chips">
        <span v-for="record in visibleRecords" :key="record.key" :title="`${record.category} record`">
          <small>Personal best</small>
          <strong>{{ record.label }}</strong>
          <b>{{ formatRecordValue(record) }}</b>
        </span>
        <button
          v-if="review.records.length > 6"
          type="button"
          class="reveal-card"
          :aria-expanded="showAllRecords"
          @click="showAllRecords = !showAllRecords"
        >
          {{ showAllRecords ? "Show fewer" : `+${review.records.length - 6} more records` }}
        </button>
      </div>
    </div>

    <div v-if="review.labels.length" class="hero-labels" aria-label="Game labels">
      <article
        v-for="label in visibleLabels"
        :key="label.id"
        :class="label.polarity"
        :title="`${label.tooltip} Evidence: ${evidence(label)}`"
      >
        <span class="label-icon"><FontAwesomeIcon :icon="labelIcon(label.id)" aria-hidden="true" /></span>
        <span><strong>{{ label.name }}</strong><small>{{ label.tooltip }}</small></span>
      </article>
      <button
        v-if="review.labels.length > 6"
        type="button"
        class="reveal-card label-reveal"
        :aria-expanded="showAllLabels"
        @click="showAllLabels = !showAllLabels"
      >
        {{ showAllLabels ? "Show fewer" : `+${review.labels.length - 6} more labels` }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.match-hero { overflow: hidden; border: 1px solid var(--border-subtle); border-left: 4px solid var(--border-strong); border-radius: var(--radius-lg); background: radial-gradient(circle at 8% 0, rgba(200,170,109,.07), transparent 30%), linear-gradient(145deg, var(--surface-2), var(--surface-1)); box-shadow: var(--shadow-card); }
.match-hero.won { border-left-color: var(--win); }.match-hero.lost { border-left-color: var(--loss); }
.hero-main { display: flex; align-items: center; gap: 14px; min-height: 88px; padding: 13px 16px; border-bottom: 1px solid var(--border-subtle); }
.portrait { width: 66px; height: 66px; flex: 0 0 66px; border: 2px solid var(--border-strong); border-radius: 50%; object-fit: cover; box-shadow: 0 0 20px rgba(0,0,0,.35); }
.identity { min-width: 230px; flex: 1; }.identity .eyebrow { display: flex; gap: 8px; flex-wrap: wrap; color: var(--text-muted); font-size: 11px; letter-spacing: .55px; text-transform: uppercase; }.identity .eyebrow span + span::before { content: "·"; margin-right: 8px; }.identity h1 { margin: 4px 0 2px; color: var(--gold-bright); font: 24px var(--font-display); letter-spacing: .5px; }.identity p { display: flex; align-items: center; gap: 5px; margin: 0; color: var(--text-secondary); font-size: 11px; }.identity p img { width: 14px; height: 14px; opacity: .82; }.separator { color: var(--text-muted); }
.mvp-badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; border: 1px solid var(--gold); border-radius: 6px; background: rgba(200,170,109,.13); color: var(--gold-bright); font: 12px var(--font-heading); }
.bookmark { padding: 7px 10px; white-space: nowrap; }
.hero-kpis { margin: 0; border-width: 0 0 1px; border-radius: 0; }
.record-holders { display: flex; align-items: center; gap: 10px; padding: 7px 11px; border-bottom: 1px solid rgba(200,170,109,.16); background: radial-gradient(circle at 7% 50%, rgba(10,200,220,.08), transparent 32%), linear-gradient(90deg, rgba(200,170,109,.06), rgba(1,10,19,.12)); }
.record-heading { display: flex; align-items: center; flex: 0 0 auto; gap: 7px; color: var(--gold-bright); }.record-heading > svg { width: 13px; height: 13px; color: var(--cyan); filter: drop-shadow(0 0 5px rgba(10,200,220,.38)); }.record-heading > span { display: flex; flex-direction: column; }.record-heading strong { font: var(--ui-text-label) var(--font-heading); letter-spacing: .6px; text-transform: uppercase; }.record-heading small { margin-top: 1px; color: var(--text-muted); font-size: var(--ui-text-micro); }
.record-chips { display: flex; flex: 1; flex-wrap: wrap; gap: 5px; min-width: 0; }.record-chips > span { display: grid; grid-template-columns: minmax(0, auto) auto; align-items: center; gap: 7px; min-width: 118px; max-width: 210px; min-height: 34px; padding: 4px 7px 4px 9px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--gold) 34%, var(--border-subtle)); border-radius: 5px; background: color-mix(in srgb, var(--gold) 6%, var(--surface-1)); box-shadow: inset 2px 0 var(--gold-dim); }.record-chips small { display: none; }.record-chips strong { overflow: hidden; color: var(--text-secondary); font-size: var(--ui-text-label); text-overflow: ellipsis; white-space: nowrap; }.record-chips b { color: var(--gold-bright); font: var(--ui-text-label) var(--font-heading); white-space: nowrap; }
.hero-labels { display: flex; flex-wrap: wrap; gap: 5px; padding: 7px 11px 8px; background: rgba(1,10,19,.1); }.hero-labels article { --label-tone: var(--gold); display: inline-flex; align-items: center; gap: 5px; min-width: 0; min-height: 30px; max-width: 230px; padding: 3px 8px 3px 5px; border: 1px solid color-mix(in srgb, var(--label-tone) 30%, var(--border-subtle)); border-radius: 999px; background: color-mix(in srgb, var(--label-tone) 6%, var(--surface-1)); color: var(--gold-bright); box-shadow: inset 2px 0 color-mix(in srgb, var(--label-tone) 64%, transparent); }.hero-labels article.negative { --label-tone: var(--loss); color: color-mix(in srgb, var(--loss) 80%, white); }.hero-labels article.mixed { --label-tone: var(--text-muted); color: var(--text-secondary); }.label-icon { display: grid; place-items: center; width: 20px; height: 20px; flex: 0 0 20px; border-radius: 50%; background: color-mix(in srgb, var(--label-tone) 9%, var(--surface-0)); color: currentColor; font-size: var(--ui-text-micro); }.hero-labels article > span:last-child { display: block; min-width: 0; }.hero-labels strong { display: block; overflow: hidden; color: currentColor; font: var(--ui-text-label) var(--font-heading); text-overflow: ellipsis; text-transform: uppercase; letter-spacing: .4px; white-space: nowrap; }.hero-labels small { display: none; }
.reveal-card { min-height: 34px; padding: 4px 8px; border: 1px dashed var(--border-strong); border-radius: 5px; background: color-mix(in srgb, var(--surface-2) 72%, transparent); color: var(--gold); font: var(--ui-text-label) var(--font-heading); letter-spacing: .4px; cursor: pointer; }.reveal-card:hover { border-color: var(--gold); background: color-mix(in srgb, var(--gold) 7%, var(--surface-2)); }.label-reveal { min-height: 30px; border-radius: 999px; }
@media (max-width: 880px) { .hero-main { align-items: flex-start; flex-wrap: wrap; }.hero-kpis :deep(.readings) { grid-template-columns: repeat(3, minmax(0, 1fr)); }.bookmark { margin-left: auto; }.record-holders { align-items: flex-start; flex-direction: column; } }
@media (max-width: 600px) { .hero-kpis :deep(.readings) { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
