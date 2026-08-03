<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import type { ParticipantRow, RuneSelection } from "../types/stats"
import {
  loadRuneMetadata,
  runeIconUrl,
  runeMetadata,
  runeMetrics,
  runeStyleIconUrl,
  runeStyles,
} from "../helpers/runes"

const props = defineProps<{
  participant: ParticipantRow
  classic?: boolean
  align?: "left" | "right"
  compact?: boolean
}>()
const open = ref(false)
const pinned = ref(false)
const trigger = ref<HTMLElement>()
const popoverStyle = ref<Record<string, string>>({})
let closeTimer: ReturnType<typeof setTimeout> | undefined

const placePopover = () => {
  if (!open.value || !trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  const gutter = 12
  const width = Math.min(540, window.innerWidth - gutter * 2)
  const below = window.innerHeight - rect.bottom - gutter
  const above = rect.top - gutter
  const opensAbove = below < 360 && above > below
  const maxHeight = Math.max(220, Math.min(680, (opensAbove ? above : below) - 6))
  const preferredLeft = props.align === "right" ? rect.right - width : rect.left
  const left = Math.max(gutter, Math.min(preferredLeft, window.innerWidth - width - gutter))

  popoverStyle.value = {
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
    ...(opensAbove
      ? { bottom: `${window.innerHeight - rect.top + 6}px`, top: "auto" }
      : { top: `${rect.bottom + 6}px`, bottom: "auto" }),
  }
}

onMounted(() => {
  void loadRuneMetadata()
  window.addEventListener("resize", placePopover)
  window.addEventListener("scroll", placePopover, true)
})
onBeforeUnmount(() => {
  if (closeTimer) clearTimeout(closeTimer)
  window.removeEventListener("resize", placePopover)
  window.removeEventListener("scroll", placePopover, true)
})
watch(open, (value) => { if (value) void nextTick(placePopover) })

const selections = computed<RuneSelection[]>(() => props.participant.runeSelections?.length
  ? props.participant.runeSelections
  : props.participant.perks.filter(Boolean).map((runeId, slot) => ({ runeId, slot, var1: 0, var2: 0, var3: 0, kind: "modern" })))
const selectedIds = computed(() => new Set(selections.value.map((entry) => entry.runeId)))
const modern = computed(() => !props.classic && selections.value.some((entry) => entry.runeId < 700_000))
const pageStyles = computed(() => [props.participant.perkPrimaryStyle, props.participant.perkSubStyle]
  .map((id) => runeStyles.value[id]).filter(Boolean))
const primaryStyle = computed(() => runeStyles.value[props.participant.perkPrimaryStyle])
const secondaryStyle = computed(() => runeStyles.value[props.participant.perkSubStyle])
const keystone = computed(() => selections.value.find((entry) => entry.slot < 6))
const selectedRuneCount = computed(() => selections.value.filter((entry) => entry.slot < 6).length)
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
const enter = () => {
  if (closeTimer) clearTimeout(closeTimer)
  open.value = true
}
const leave = () => {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = setTimeout(() => { if (!pinned.value) open.value = false }, 90)
}
const toggle = () => {
  if (closeTimer) clearTimeout(closeTimer)
  pinned.value = !pinned.value
  open.value = pinned.value
}
const close = () => {
  if (closeTimer) clearTimeout(closeTimer)
  pinned.value = false
  open.value = false
}
const hideBroken = (event: Event) => { (event.currentTarget as HTMLImageElement).style.display = "none" }
</script>

<template>
  <span class="rune-page" :class="[align, { open, compact }]" @mouseenter="enter" @mouseleave="leave">
    <button ref="trigger" class="rune-trigger" type="button" :aria-expanded="open"
      :aria-label="keystone ? `Open ${title(keystone.runeId)} rune page` : 'Open rune page'"
      @click.stop="toggle" @focus="enter">
      <template v-if="selections.length">
        <span class="keystone-frame">
          <img v-if="keystone" :src="runeIconUrl(keystone.runeId)" :title="title(keystone.runeId)"
            alt="" @error="hideBroken" />
        </span>
        <span class="style-stack" aria-hidden="true">
          <img v-if="primaryStyle" :src="runeStyleIconUrl(primaryStyle.id)" alt="" @error="hideBroken" />
          <img v-if="secondaryStyle" :src="runeStyleIconUrl(secondaryStyle.id)" alt="" @error="hideBroken" />
        </span>
        <span v-if="!compact" class="trigger-copy">
          <strong>{{ keystone ? title(keystone.runeId) : "Rune page" }}</strong>
          <small>{{ modern ? `${primaryStyle?.name || "Runes"} · ${selectedRuneCount} selected` : "Classic rune page" }}</small>
        </span>
      </template>
      <template v-else>
        <span class="keystone-frame empty" aria-hidden="true">◇</span>
        <span v-if="!compact" class="trigger-copy"><strong>No rune data</strong><small>Open details</small></span>
      </template>
    </button>

    <Teleport to="body">
    <aside v-if="open" class="rune-popover" :style="popoverStyle"
      @click.stop @mouseenter="enter" @mouseleave="leave">
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
              :title="title(id)" :class="{ selected: chosen(id), unselected: !chosen(id) }" @error="hideBroken" />
          </div>
        </section>
      </div>

      <div v-else-if="selections.length" class="classic-page">
        <section v-for="group in classicGroups" :key="group.label">
          <h4>{{ group.label }}</h4>
          <span v-if="!group.runes.length" class="muted">No selection captured</span>
          <article v-for="entry in group.runes" :key="entry.selection.runeId">
            <img :src="runeIconUrl(entry.selection.runeId)" alt="" @error="hideBroken" />
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
          <img :src="runeIconUrl(entry.selection.runeId)" alt="" @error="hideBroken" />
          <span><strong>{{ entry.meta?.name || title(entry.selection.runeId) }}</strong><small v-for="metric in entry.metrics" :key="metric">{{ metric }}</small></span>
        </article>
      </div>
    </aside>
    </Teleport>
  </span>
</template>

<style scoped>
.rune-page { position: relative; display: inline-flex; min-width: 0; z-index: 4; }
.rune-page.open { z-index: 20; }
.rune-trigger { display: grid; grid-template-columns: 28px 18px minmax(0, 1fr); align-items: center; gap: 4px; width: 158px; min-width: 0; padding: 3px 6px 3px 4px; border: 1px solid var(--border-subtle); border-radius: 5px; background: linear-gradient(90deg, rgba(5,14,28,.88), rgba(19,34,56,.76)); color: var(--text-muted); text-align: left; cursor: pointer; }
.rune-page.compact .rune-trigger { grid-template-columns: 28px 16px; width: 54px; padding-right: 3px; }
.rune-trigger:hover, .rune-trigger:focus-visible { border-color: var(--gold); outline: none; background: var(--surface-2); }
.keystone-frame { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid rgba(200,170,109,.34); border-radius: 50%; background: rgba(0,0,0,.3); color: var(--text-muted); }
.keystone-frame img { width: 25px; height: 25px; object-fit: contain; }
.keystone-frame.empty { font-size: 14px; }
.style-stack { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.style-stack img { width: 14px; height: 14px; object-fit: contain; }
.trigger-copy { display: flex; flex-direction: column; min-width: 0; line-height: 1.1; }
.trigger-copy strong, .trigger-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trigger-copy strong { color: var(--text-secondary); font-size: 10px; }
.trigger-copy small { margin-top: 2px; color: var(--text-muted); font-size: 9px; }
.rune-popover { position: fixed; z-index: 1000; overflow-y: auto; padding: 14px; border: 1px solid rgba(200,170,109,.62); border-radius: var(--radius-md); background: radial-gradient(circle at 22% 0, rgba(32,74,99,.42), transparent 34%), linear-gradient(145deg, #081426, #101d34); box-shadow: 0 22px 60px rgba(0,0,0,.72); color: var(--text-primary); }
header { display: flex; align-items: center; gap: 8px; padding-bottom: 9px; border-bottom: 1px solid var(--border-subtle); }
header strong { font: 13px var(--font-heading); color: var(--gold-bright); }
header button { margin-left: auto; border: 0; background: transparent; color: var(--text-muted); font-size: 18px; cursor: pointer; }
.modern-page { display: grid; grid-template-columns: 1.15fr .85fr; gap: 16px; padding-top: 10px; }
.rune-tree { display: grid; gap: 7px; }
h4 { margin: 0; color: var(--text-secondary); font: 10px var(--font-heading); letter-spacing: .7px; text-transform: uppercase; }
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
.classic-page strong, .rune-results strong { font-size: 10px; }
.classic-page small, .rune-results small { color: var(--text-muted); font-size: 9px; line-height: 1.35; }
.rune-results { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7px 12px; margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--border-subtle); }
.rune-results h4 { grid-column: 1 / -1; }
.classic-unavailable { margin: 10px 0 0; padding: 10px; border: 1px dashed var(--border-subtle); color: var(--text-muted); font-size: 10px; line-height: 1.5; }
@media (max-width: 700px) { .modern-page, .classic-page, .rune-results { grid-template-columns: 1fr; }.rune-results h4 { grid-column: auto; } }
</style>
