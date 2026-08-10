<script setup lang="ts">
import { computed } from "vue"
import { recallGradeFromRecallScore } from "../shared/recall-grade"
import { normalizeAugmentRarity } from "../helpers/game-assets"
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

const tier = computed(() => recallGradeFromRecallScore(props.summary?.averageRecallScore) ?? "—")
const rarity = computed(() => normalizeAugmentRarity(props.rarity))
const rarityClass = computed(() => rarity.value?.toLowerCase() ?? "unknown")
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
  --rarity: #7f8c99;
  --rarity-bright: #c7d1dc;
  --rarity-deep: #354352;
  --rarity-wash: rgba(127, 140, 153, .14);
  position: relative;
  display: grid;
  grid-template-columns: 66px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  min-width: 0;
  min-height: 88px;
  padding: 10px 11px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--rarity) 58%, var(--border-subtle));
  border-radius: var(--radius-md);
  background:
    radial-gradient(circle at 0 0, var(--rarity-wash), transparent 46%),
    linear-gradient(145deg, var(--surface-2), var(--surface-1));
  box-shadow: inset 3px 0 var(--rarity), 0 7px 18px rgba(0, 0, 0, .12);
}
.rarity-silver { --rarity: #a7b0bb; --rarity-bright: #e0e5ea; --rarity-deep: #56616d; --rarity-wash: rgba(167, 176, 187, .16); }
.rarity-gold { --rarity: #c89b3c; --rarity-bright: #f0d58a; --rarity-deep: #785a28; --rarity-wash: rgba(200, 155, 60, .17); }
.rarity-prismatic { --rarity: #b99cff; --rarity-bright: #f0d7ff; --rarity-deep: #654da8; --rarity-wash: rgba(185, 156, 255, .2); }
.rarity-prismatic::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(115deg, transparent 12%, rgba(81, 213, 226,.08) 42%, rgba(240,150,221,.11) 68%, transparent 88%); }
.rarity-unknown { --rarity: #6f8196; }
.augment-rank { position: absolute; top: 5px; left: 5px; z-index: 2; display: grid; place-items: center; min-width: 20px; height: 20px; border: 1px solid var(--rarity); border-radius: 50%; background: #07111f; color: var(--text-primary); font: 11px var(--font-heading); }
.augment-art { position: relative; display: grid; place-items: center; width: 64px; height: 64px; isolation: isolate; }
.augment-art::before { content: ""; position: absolute; width: 45px; height: 45px; z-index: -1; transform: rotate(45deg); border: 2px solid var(--rarity); border-radius: 8px; background: linear-gradient(135deg, var(--surface-0), color-mix(in srgb, var(--rarity-deep) 42%, var(--surface-0))); box-shadow: 0 0 16px color-mix(in srgb, var(--rarity) 32%, transparent), inset 0 0 0 2px rgba(1,10,19,.75); }
.augment-art img { display: block; width: 48px; height: 48px; object-fit: contain; object-position: 50% 50%; filter: drop-shadow(0 2px 5px rgba(0,0,0,.55)); }
.augment-copy { display: flex; flex-direction: column; min-width: 0; }
.augment-kicker { color: var(--rarity-bright); font: 11px var(--font-heading); letter-spacing: 1.15px; text-transform: uppercase; }
.augment-copy > strong { margin-top: 2px; overflow: hidden; color: var(--text-primary); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.augment-copy p { display: -webkit-box; margin: 4px 0 0; overflow: hidden; color: var(--text-muted); font-size: 12px; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.augment-metrics { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; color: var(--text-muted); font-size: 12px; }
.augment-metrics b { color: var(--text-secondary); font-weight: 700; }
.augment-empty { margin-top: 5px; color: var(--text-muted); font-size: 12px; }
.augment-tier { display: grid; justify-items: center; min-width: 49px; padding-left: 10px; border-left: 1px solid var(--border-subtle); }
.augment-tier small { color: var(--text-muted); font-size: 10px; letter-spacing: .7px; text-transform: uppercase; white-space: nowrap; }
.augment-tier strong { margin-top: 3px; color: var(--gold-bright); font: 20px var(--font-display); }
.augment-tier.grade-s strong { color: #f2cf65; }.augment-tier.grade-a strong { color: #42cfbd; }.augment-tier.grade-b strong { color: #55a9dc; }.augment-tier.grade-c strong, .augment-tier.grade-d strong { color: #d27b78; }
.augment-card.compact { grid-template-columns: 54px minmax(0, 1fr) auto; min-height: 70px; padding: 8px 9px; }
.compact .augment-art { width: 52px; height: 52px; }.compact .augment-art::before { width: 37px; height: 37px; border-radius: 7px; }.compact .augment-art img { width: 40px; height: 40px; }
.compact .augment-copy > strong { font-size: 12px; }.compact .augment-metrics { gap: 6px; margin-top: 4px; font-size: 11px; }.compact .augment-tier { min-width: 42px; padding-left: 7px; }.compact .augment-tier strong { font-size: 17px; }
@media (max-width: 620px) { .augment-card { grid-template-columns: 66px minmax(0,1fr); }.augment-tier { grid-column: 2; grid-row: 2; justify-items: start; padding: 5px 0 0; border: 0; }.augment-tier small, .augment-tier strong { display: inline; }.augment-tier strong { margin-left: 5px; } }
</style>
