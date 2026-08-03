<script setup lang="ts">
import AugmentInsightCard from "./AugmentInsightCard.vue"
import { publicAssetUrl } from "../helpers/assets"
import type { GameAssetCatalog } from "../helpers/game-assets"
import type { OwnerAugmentSummary } from "../types/review"

const props = defineProps<{
  championName: string
  summaries: OwnerAugmentSummary[]
  assets: GameAssetCatalog
  loading?: boolean
  compact?: boolean
}>()

const asset = (augmentId: number) => props.assets.augments[augmentId]
</script>

<template>
  <section class="augment-advisor" :class="{ compact }">
    <header>
      <div>
        <p class="eyebrow">Personal Mayhem intel</p>
        <h2 class="section-title">Best augments on {{ championName }}</h2>
      </div>
      <span class="history-chip">Your history</span>
    </header>
    <div v-if="summaries.length" class="advisor-grid">
      <AugmentInsightCard
        v-for="(summary, index) in summaries"
        :key="summary.augmentId"
        :augment-id="summary.augmentId"
        :name="asset(summary.augmentId)?.name || `Augment ${summary.augmentId}`"
        :icon="asset(summary.augmentId)?.icon || publicAssetUrl('recall-icon.png')"
        :description="asset(summary.augmentId)?.description"
        :rarity="asset(summary.augmentId)?.rarity"
        :summary="summary"
        :rank="index + 1"
        :compact="compact"
      />
    </div>
    <p v-else class="empty-copy muted">
      {{ loading ? "Reading your Mayhem history…" : `No recorded augment sample for ${championName} yet.` }}
    </p>
    <p class="policy-copy">Ranked from your champion-specific grade, KDA, damage, and sample size. Win rate is excluded under Riot's augment policy.</p>
  </section>
</template>

<style scoped>
.augment-advisor { display: grid; gap: 11px; }.augment-advisor > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.augment-advisor .eyebrow { margin: 0 0 3px; font: 10px var(--font-heading); letter-spacing: 1.25px; text-transform: uppercase; color: var(--gold); }.augment-advisor .section-title { margin: 0; }
.history-chip { padding: 4px 8px; border: 1px solid var(--gold-dim); border-radius: 99px; color: var(--gold); font-size: 9px; letter-spacing: .8px; text-transform: uppercase; white-space: nowrap; }
.advisor-grid { display: grid; grid-template-columns: repeat(4, minmax(220px, 1fr)); gap: 9px; }.empty-copy { margin: 0; padding: 18px; border: 1px dashed var(--border-subtle); border-radius: var(--radius-sm); text-align: center; font-size: 11px; }.policy-copy { margin: 0; color: var(--text-muted); font-size: 10px; }
.compact .advisor-grid { grid-template-columns: 1fr; }.compact .policy-copy { font-size: 9px; }.compact .history-chip { display: none; }
@media (max-width: 1180px) { .advisor-grid { grid-template-columns: repeat(2, minmax(220px, 1fr)); } }
@media (max-width: 620px) { .advisor-grid { grid-template-columns: 1fr; } }
</style>
