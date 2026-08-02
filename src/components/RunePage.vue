<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import type { ParticipantRow, RuneSelection } from "../types/stats"
import {
  loadRuneMetadata,
  runeIconUrl,
  runeMetadata,
  runeMetrics,
  runeStyleIconUrl,
  runeStyles,
} from "../helpers/runes"

const props = defineProps<{ participant: ParticipantRow; classic?: boolean; align?: "left" | "right" }>()
const open = ref(false)
const pinned = ref(false)
onMounted(() => void loadRuneMetadata())

const selections = computed<RuneSelection[]>(() => props.participant.runeSelections?.length
  ? props.participant.runeSelections
  : props.participant.perks.filter(Boolean).map((runeId, slot) => ({ runeId, slot, var1: 0, var2: 0, var3: 0, kind: "modern" })))
const selectedIds = computed(() => new Set(selections.value.map((entry) => entry.runeId)))
const modern = computed(() => !props.classic && selections.value.some((entry) => entry.runeId < 700_000))
const pageStyles = computed(() => [props.participant.perkPrimaryStyle, props.participant.perkSubStyle]
  .map((id) => runeStyles.value[id]).filter(Boolean))
const selectedMeta = computed(() => selections.value.map((selection) => ({
  selection,
  meta: runeMetadata.value[selection.runeId],
  metrics: runeMetrics(selection),
})))
const classicGroups = computed(() => [
  ["kQuintessence", "Quintessences"], ["kMark", "Marks"], ["kSeal", "Seals"], ["kGlyph", "Glyphs"],
].map(([type, label]) => ({ label, runes: selectedMeta.value.filter((entry) => entry.meta?.type === type) })))

const chosen = (id: number) => selectedIds.value.has(id)
const title = (id: number) => runeMetadata.value[id]?.name ?? `Rune ${id}`
const enter = () => { open.value = true }
const leave = () => { if (!pinned.value) open.value = false }
const toggle = () => { pinned.value = !pinned.value; open.value = pinned.value }
const close = () => { pinned.value = false; open.value = false }
</script>

<template>
  <span class="rune-page" :class="[align, { open }]" @mouseenter="enter" @mouseleave="leave">
    <button class="rune-trigger" type="button" :aria-expanded="open" @click.stop="toggle" @focus="enter">
      <template v-if="selections.length">
        <img v-for="entry in selections.slice(0, 6)" :key="entry.runeId" v-show="runeIconUrl(entry.runeId)"
          :src="runeIconUrl(entry.runeId)" :title="title(entry.runeId)" alt="" />
      </template>
      <span v-else class="rune-empty">Runes unavailable</span>
    </button>

    <aside v-if="open" class="rune-popover" @click.stop>
      <header>
        <span class="eyebrow">Rune page</span>
        <strong v-if="modern">{{ pageStyles.map(style => style.name).join(" + ") || "Selected runes" }}</strong>
        <strong v-else>League Classic runes</strong>
        <button type="button" aria-label="Close rune page" @click="close">×</button>
      </header>

      <div v-if="modern && pageStyles.length" class="modern-page">
        <section v-for="(style, styleIndex) in pageStyles" :key="style.id" class="rune-tree" :class="{ secondary: styleIndex === 1 }">
          <h4><img :src="runeStyleIconUrl(style.id)" alt="" />{{ style.name }}</h4>
          <div v-for="slot in style.slots.filter(slot => styleIndex === 0 || (slot.type !== 'kStatMod' && slot.perks.some(chosen)))" :key="slot.type + slot.label" class="rune-row">
            <img v-for="id in slot.perks" :key="id" :src="runeIconUrl(id)" :alt="title(id)"
              :title="title(id)" :class="{ selected: chosen(id), unselected: !chosen(id) }" />
          </div>
        </section>
      </div>

      <div v-else-if="selections.length" class="classic-page">
        <section v-for="group in classicGroups" :key="group.label">
          <h4>{{ group.label }}</h4>
          <span v-if="!group.runes.length" class="muted">No selection captured</span>
          <article v-for="entry in group.runes" :key="entry.selection.runeId">
            <img :src="runeIconUrl(entry.selection.runeId)" alt="" />
            <span><strong>{{ entry.meta?.name || title(entry.selection.runeId) }}</strong>
              <small>{{ entry.selection.count ? `${entry.selection.count}× · ` : "" }}{{ entry.meta?.statName || entry.meta?.tooltip }}</small></span>
          </article>
        </section>
      </div>
      <p v-else class="classic-unavailable">
        Riot's historical League Classic match data does not include the selected rune page. Recall will show it here when a live capture supplies it.
      </p>

      <div v-if="selectedMeta.some(entry => entry.metrics.length)" class="rune-results">
        <h4>Match results</h4>
        <article v-for="entry in selectedMeta.filter(entry => entry.metrics.length)" :key="entry.selection.runeId">
          <img :src="runeIconUrl(entry.selection.runeId)" alt="" />
          <span><strong>{{ entry.meta?.name || title(entry.selection.runeId) }}</strong><small v-for="metric in entry.metrics" :key="metric">{{ metric }}</small></span>
        </article>
      </div>
    </aside>
  </span>
</template>

<style scoped>
.rune-page { position: relative; display: inline-flex; min-width: 0; z-index: 4; }
.rune-page.open { z-index: 20; }
.rune-trigger { display: flex; align-items: center; gap: 2px; min-width: 0; padding: 2px 4px; border: 1px solid var(--border-subtle); border-radius: 4px; background: rgba(5, 14, 28, .7); color: var(--text-muted); cursor: pointer; }
.rune-trigger:hover, .rune-trigger:focus-visible { border-color: var(--gold); outline: none; }
.rune-trigger img { width: 17px; height: 17px; object-fit: contain; }
.rune-empty { font-size: 8px; white-space: nowrap; }
.rune-popover { position: absolute; left: 0; top: calc(100% + 5px); width: min(520px, 78vw); max-height: min(680px, 80vh); overflow-y: auto; padding: 12px; border: 1px solid rgba(200,170,109,.55); border-radius: var(--radius-md); background: linear-gradient(145deg, #0b1629, #101d34); box-shadow: 0 18px 50px rgba(0,0,0,.6); color: var(--text-primary); }
.right .rune-popover { left: auto; right: 0; }
header { display: flex; align-items: center; gap: 8px; padding-bottom: 9px; border-bottom: 1px solid var(--border-subtle); }
header strong { font: 12px var(--font-heading); color: var(--gold-bright); }
header button { margin-left: auto; border: 0; background: transparent; color: var(--text-muted); font-size: 18px; cursor: pointer; }
.modern-page { display: grid; grid-template-columns: 1.15fr .85fr; gap: 16px; padding-top: 10px; }
.rune-tree { display: grid; gap: 7px; }
h4 { margin: 0; color: var(--text-secondary); font: 9px var(--font-heading); letter-spacing: .7px; text-transform: uppercase; }
.rune-tree h4 { display: flex; align-items: center; gap: 5px; color: var(--gold-bright); }
.rune-tree h4 img { width: 18px; height: 18px; }
.rune-row { display: flex; align-items: center; justify-content: space-around; gap: 7px; min-height: 32px; padding: 3px 5px; border-radius: 5px; background: rgba(255,255,255,.025); }
.rune-row img { width: 28px; height: 28px; object-fit: contain; border-radius: 50%; transition: .15s ease; }
.rune-row img.unselected { filter: grayscale(1); opacity: .2; transform: scale(.82); }
.rune-row img.selected { filter: drop-shadow(0 0 6px rgba(10,200,185,.7)); }
.secondary .rune-row img { width: 24px; height: 24px; }
.classic-page { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding-top: 10px; }
.classic-page section { display: grid; gap: 5px; padding: 8px; border: 1px solid var(--border-subtle); border-radius: 5px; }
.classic-page article, .rune-results article { display: flex; align-items: center; gap: 7px; }
.classic-page article img, .rune-results img { width: 28px; height: 28px; object-fit: contain; }
.classic-page article span, .rune-results article span { display: flex; flex-direction: column; min-width: 0; }
.classic-page strong, .rune-results strong { font-size: 9px; }
.classic-page small, .rune-results small { color: var(--text-muted); font-size: 8px; line-height: 1.35; }
.rune-results { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7px 12px; margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--border-subtle); }
.rune-results h4 { grid-column: 1 / -1; }
.classic-unavailable { margin: 10px 0 0; padding: 10px; border: 1px dashed var(--border-subtle); color: var(--text-muted); font-size: 9px; line-height: 1.5; }
@media (max-width: 700px) { .modern-page, .classic-page, .rune-results { grid-template-columns: 1fr; }.rune-results h4 { grid-column: auto; } }
</style>
