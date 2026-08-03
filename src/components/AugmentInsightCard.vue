<script setup lang="ts">
import { computed } from "vue"
import { gradeFromScore } from "../helpers/format"
import type { OwnerAugmentSummary } from "../types/review"

const props = defineProps<{
  augmentId: number
  name: string
  icon: string
  description?: string
  rarity?: string
  summary?: OwnerAugmentSummary
  rank?: number
  compact?: boolean
}>()

const tier = computed(() => gradeFromScore(props.summary?.averageGrade) ?? "—")
const rarityClass = computed(() => (props.rarity ?? "unknown").toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"))
const cleanDescription = computed(() => (props.description ?? "")
  .replaceAll(/<[^>]+>/g, " ")
  .replaceAll(/\s+/g, " ")
  .trim())
</script>

<template>
  <article
    class="augment-card"
    :class="[`rarity-${rarityClass}`, { compact }]"
    :title="cleanDescription || name"
  >
    <span v-if="rank" class="augment-rank">#{{ rank }}</span>
    <span class="augment-art">
      <img :src="icon" :alt="name" />
    </span>
    <div class="augment-copy">
      <span class="augment-kicker">{{ rarity || "Augment" }}</span>
      <strong>{{ name }}</strong>
      <p v-if="cleanDescription && !compact">{{ cleanDescription }}</p>
      <div v-if="summary" class="augment-metrics">
        <span><b>{{ summary.games }}</b> games</span>
        <span><b>{{ summary.kda.toFixed(2) }}</b> KDA</span>
        <span><b>{{ Math.round(summary.damagePerMinute).toLocaleString() }}</b> DPM</span>
      </div>
      <span v-else class="augment-empty">No personal sample yet</span>
    </div>
    <div class="augment-tier" :class="`grade-${tier[0]?.toLowerCase() || 'new'}`">
      <small>Personal tier</small>
      <strong>{{ tier }}</strong>
    </div>
  </article>
</template>

<style scoped>
.augment-card {
  --rarity: #6f8196;
  position: relative;
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  min-width: 0;
  min-height: 88px;
  padding: 10px 11px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--rarity) 52%, var(--border-subtle));
  border-radius: var(--radius-md);
  background:
    radial-gradient(circle at 0 0, color-mix(in srgb, var(--rarity) 18%, transparent), transparent 42%),
    linear-gradient(145deg, var(--surface-2), var(--surface-1));
  box-shadow: inset 2px 0 var(--rarity), 0 7px 18px rgba(0, 0, 0, .12);
}
.rarity-silver, .rarity-1 { --rarity: #9ba7b4; }
.rarity-gold, .rarity-2 { --rarity: #c89b3c; }
.rarity-prismatic, .rarity-3 { --rarity: #8e73dc; }
.rarity-unknown { --rarity: #3fa7b8; }
.augment-rank { position: absolute; top: 5px; left: 5px; z-index: 2; display: grid; place-items: center; min-width: 20px; height: 20px; border: 1px solid var(--rarity); border-radius: 50%; background: #07111f; color: var(--text-primary); font: 9px var(--font-heading); }
.augment-art { position: relative; display: grid; place-items: center; width: 52px; height: 52px; transform: rotate(45deg); border: 1px solid var(--rarity); border-radius: 9px; background: var(--surface-0); box-shadow: 0 0 13px color-mix(in srgb, var(--rarity) 22%, transparent); overflow: hidden; }
.augment-art img { width: 68px; height: 68px; transform: rotate(-45deg); object-fit: cover; }
.augment-copy { display: flex; flex-direction: column; min-width: 0; }
.augment-kicker { color: var(--rarity); font: 9px var(--font-heading); letter-spacing: 1px; text-transform: uppercase; }
.augment-copy > strong { margin-top: 2px; overflow: hidden; color: var(--text-primary); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.augment-copy p { display: -webkit-box; margin: 4px 0 0; overflow: hidden; color: var(--text-muted); font-size: 10px; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.augment-metrics { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; color: var(--text-muted); font-size: 10px; }
.augment-metrics b { color: var(--text-secondary); font-weight: 700; }
.augment-empty { margin-top: 5px; color: var(--text-muted); font-size: 10px; }
.augment-tier { display: grid; justify-items: center; min-width: 49px; padding-left: 10px; border-left: 1px solid var(--border-subtle); }
.augment-tier small { color: var(--text-muted); font-size: 8px; letter-spacing: .7px; text-transform: uppercase; white-space: nowrap; }
.augment-tier strong { margin-top: 3px; color: var(--gold-bright); font: 20px var(--font-display); }
.augment-tier.grade-s strong { color: #f2cf65; }.augment-tier.grade-a strong { color: #42cfbd; }.augment-tier.grade-b strong { color: #55a9dc; }.augment-tier.grade-c strong, .augment-tier.grade-d strong { color: #d27b78; }
.augment-card.compact { grid-template-columns: 46px minmax(0, 1fr) auto; min-height: 70px; padding: 8px 9px; }
.compact .augment-art { width: 43px; height: 43px; border-radius: 7px; }.compact .augment-art img { width: 57px; height: 57px; }
.compact .augment-copy > strong { font-size: 12px; }.compact .augment-metrics { gap: 6px; margin-top: 4px; font-size: 9px; }.compact .augment-tier { min-width: 42px; padding-left: 7px; }.compact .augment-tier strong { font-size: 17px; }
@media (max-width: 620px) { .augment-card { grid-template-columns: 48px minmax(0, 1fr); }.augment-tier { grid-column: 2; grid-row: 2; justify-items: start; padding: 5px 0 0; border: 0; }.augment-tier small, .augment-tier strong { display: inline; }.augment-tier strong { margin-left: 5px; } }
</style>
