<script setup lang="ts">
import { computed } from "vue"
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome"
import { faMedal, faTrophy } from "@fortawesome/free-solid-svg-icons"
import GradeBadge from "./GradeBadge.vue"
import StatTile from "./ui/StatTile.vue"
import { labelIcon } from "../helpers/label-icons"
import { lobbyStandings } from "../helpers/match-detail"
import { positionIconUrl, positionLabel, resolvePosition } from "../helpers/roles"
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
  ? resolvePosition(owner.value.lane, owner.value.role, owner.value.assignedPosition)
  : undefined)
const kda = computed(() => props.review.match.deaths === 0
  ? props.review.match.kills + props.review.match.assists
  : (props.review.match.kills + props.review.match.assists) / props.review.match.deaths)
const patch = computed(() => props.review.match.gameVersion.split(".").slice(0, 2).join("."))
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

    <div class="hero-kpis">
      <StatTile
        label="KDA"
        :value="`${review.match.kills}/${review.match.deaths}/${review.match.assists}`"
        :hint="`${formatDecimal(kda, 2)} ratio`"
        :tone="review.match.win ? 'win' : 'loss'"
      />
      <StatTile label="Damage" :value="formatCompact(review.match.damageToChampions)" />
      <StatTile label="Gold" :value="formatCompact(review.match.goldEarned)" />
      <StatTile
        label="Creep score"
        :value="(review.match.totalMinionsKilled + review.match.neutralMinions).toString()"
        :hint="`${formatDecimal(review.match.csPerMin ?? 0, 1)} per minute`"
      />
      <StatTile
        label="Lobby place"
        :value="standing?.place?.toString() ?? '—'"
        :hint="standing ? `of ${standing.of} by Recall grade` : 'Complete grades unavailable'"
      />
    </div>

    <div v-if="review.records.length" class="record-holders" aria-label="Personal records held by this game">
      <div class="record-heading">
        <FontAwesomeIcon :icon="faTrophy" aria-hidden="true" />
        <span><strong>Current personal records</strong><small>This game still holds {{ review.records.length }} {{ review.records.length === 1 ? "record" : "records" }} in its mode.</small></span>
      </div>
      <div class="record-chips">
        <span v-for="record in review.records" :key="record.key" :title="`${record.category} record`">
          <small>Personal best</small>
          <strong>{{ record.label }}</strong>
          <b>{{ formatRecordValue(record) }}</b>
        </span>
      </div>
    </div>

    <div v-if="review.labels.length" class="hero-labels" aria-label="Game labels">
      <article
        v-for="label in review.labels"
        :key="label.id"
        :class="label.polarity"
        :title="`${label.tooltip} Evidence: ${evidence(label)}`"
      >
        <span class="label-icon"><FontAwesomeIcon :icon="labelIcon(label.id)" aria-hidden="true" /></span>
        <span><strong>{{ label.name }}</strong><small>{{ label.tooltip }}</small></span>
      </article>
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
.hero-kpis { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 1px; padding: 0 12px; background: color-mix(in srgb, var(--surface-0) 55%, transparent); }
.record-holders { display: grid; grid-template-columns: minmax(210px, .72fr) minmax(0, 2.28fr); gap: 14px; padding: 11px 13px; border-top: 1px solid rgba(200,170,109,.24); border-bottom: 1px solid rgba(200,170,109,.16); background: radial-gradient(circle at 7% 50%, rgba(10,200,220,.1), transparent 32%), linear-gradient(90deg, rgba(200,170,109,.075), rgba(1,10,19,.16)); }
.record-heading { display: flex; align-items: center; gap: 10px; color: var(--gold-bright); }.record-heading > svg { width: 20px; height: 20px; padding: 8px; border: 1px solid rgba(10,200,220,.38); border-radius: 50%; background: rgba(10,200,220,.08); color: var(--cyan); filter: drop-shadow(0 0 7px rgba(10,200,220,.4)); }.record-heading > span { display: flex; flex-direction: column; }.record-heading strong { font: 12px var(--font-heading); letter-spacing: .75px; text-transform: uppercase; }.record-heading small { margin-top: 3px; color: var(--text-muted); font-size: 11px; line-height: 1.3; }
.record-chips { display: flex; gap: 8px; overflow-x: auto; padding: 1px 1px 3px; }.record-chips > span { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; flex: 0 0 184px; min-height: 49px; padding: 8px 10px 7px 12px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--gold) 42%, var(--border-subtle)); border-radius: 7px; background: linear-gradient(145deg, rgba(200,170,109,.1), rgba(1,10,19,.58)); box-shadow: inset 2px 0 var(--gold-dim), 0 4px 12px rgba(0,0,0,.12); }.record-chips small { grid-column: 1 / -1; color: var(--gold); font-size: 8px; letter-spacing: .75px; text-transform: uppercase; }.record-chips strong { align-self: end; overflow: hidden; color: var(--text-secondary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.record-chips b { align-self: end; margin-left: 9px; color: var(--gold-bright); font: 13px var(--font-heading); white-space: nowrap; }
.hero-labels { display: flex; gap: 8px; min-height: 66px; padding: 9px 13px 11px; overflow-x: auto; background: rgba(1,10,19,.12); }.hero-labels article { --label-tone: var(--gold); display: grid; grid-template-columns: 34px minmax(0,1fr); align-items: center; gap: 9px; flex: 0 0 210px; width: 210px; height: 54px; padding: 7px 10px 7px 8px; border: 1px solid color-mix(in srgb, var(--label-tone) 35%, var(--border-subtle)); border-radius: 8px; background: radial-gradient(circle at 0 50%, color-mix(in srgb, var(--label-tone) 13%, transparent), transparent 48%), linear-gradient(145deg, var(--surface-2), var(--surface-1)); color: var(--gold-bright); box-shadow: inset 2px 0 color-mix(in srgb, var(--label-tone) 72%, transparent), 0 4px 12px rgba(0,0,0,.12); }.hero-labels article.negative { --label-tone: var(--loss); color: color-mix(in srgb, var(--loss) 80%, white); }.hero-labels article.mixed { --label-tone: var(--text-muted); color: var(--text-secondary); }.label-icon { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid color-mix(in srgb, var(--label-tone) 43%, transparent); border-radius: 50%; background: color-mix(in srgb, var(--label-tone) 9%, var(--surface-0)); color: currentColor; }.hero-labels article > span:last-child { display: flex; flex-direction: column; min-width: 0; }.hero-labels strong { overflow: hidden; color: currentColor; font: 11px var(--font-heading); text-overflow: ellipsis; text-transform: uppercase; letter-spacing: .55px; white-space: nowrap; }.hero-labels small { display: -webkit-box; overflow: hidden; margin-top: 3px; color: var(--text-muted); font-size: 10px; line-height: 1.2; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
@media (max-width: 880px) { .hero-main { align-items: flex-start; flex-wrap: wrap; }.hero-kpis { grid-template-columns: repeat(3, 1fr); }.bookmark { margin-left: auto; }.record-holders { grid-template-columns: 1fr; } }
</style>
