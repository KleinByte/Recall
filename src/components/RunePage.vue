<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import type { ParticipantRow, RuneSelection } from "../types/stats"
import { publicAssetUrl } from "../helpers/assets"
import { placeClassicRunes } from "../helpers/rune-layouts"
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
const classicView = ref<"runes" | "masteries">("runes")
let closeTimer: ReturnType<typeof setTimeout> | undefined

const classicRuneBoardUrl = publicAssetUrl("game-data/ui/classic-rune-board.webp")
const classicMasteriesUrl = publicAssetUrl("game-data/ui/classic-masteries-empty.webp")

const placePopover = () => {
  if (!open.value || !trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  const gutter = 12
  const idealWidth = props.classic ? 760 : 660
  const width = Math.min(idealWidth, window.innerWidth - gutter * 2)
  const below = window.innerHeight - rect.bottom - gutter
  const above = rect.top - gutter
  const opensAbove = below < 420 && above > below
  const maxHeight = Math.max(240, Math.min(760, (opensAbove ? above : below) - 6))
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
watch(() => props.classic, () => { classicView.value = "runes" })

const selections = computed<RuneSelection[]>(() => props.participant.runeSelections?.length
  ? props.participant.runeSelections
  : props.participant.perks.filter(Boolean).map((runeId, slot) => ({
    runeId,
    slot,
    var1: 0,
    var2: 0,
    var3: 0,
    kind: "modern",
  })))
const selectedIds = computed(() => new Set(selections.value.map((entry) => entry.runeId)))
const modern = computed(() => !props.classic && (
  props.participant.perkPrimaryStyle > 0
  || selections.value.some((entry) => entry.runeId > 0 && entry.runeId < 700_000)
))
const primaryStyle = computed(() => runeStyles.value[props.participant.perkPrimaryStyle])
const secondaryStyle = computed(() => runeStyles.value[props.participant.perkSubStyle])
const pageStyles = computed(() => [primaryStyle.value, secondaryStyle.value].filter(Boolean))
const styleChoices = computed(() => Object.values(runeStyles.value))
const primaryRuneSlots = computed(() => primaryStyle.value?.slots.filter((slot) => slot.type !== "kStatMod") ?? [])
const secondaryRuneSlots = computed(() => secondaryStyle.value?.slots.filter((slot) =>
  slot.type !== "kKeyStone" && slot.type !== "kStatMod") ?? [])
const statSlots = computed(() => primaryStyle.value?.slots.filter((slot) => slot.type === "kStatMod") ?? [])
const keystone = computed(() => selections.value.find((entry) => entry.slot === 0)
  ?? selections.value.find((entry) => entry.slot < 6))
const selectedRuneCount = computed(() => selections.value.filter((entry) => entry.slot < 6).length)
const capturedShardCount = computed(() => new Set(
  selections.value.filter((entry) => entry.slot >= 6 && entry.slot <= 8)
    .map((entry) => entry.slot),
).size)
const shardCaptureLabel = computed(() => capturedShardCount.value === 3
  ? "3/3 captured"
  : capturedShardCount.value > 0
    ? `${capturedShardCount.value}/3 captured`
    : "Not captured")
const selectedMeta = computed(() => selections.value.map((selection) => ({
  selection,
  meta: runeMetadata.value[selection.runeId],
  metrics: runeMetrics(selection),
})))
const classicSelections = computed(() => selections.value.filter((entry) =>
  entry.kind === "classic" || entry.runeId >= 700_000))
const classicPlacements = computed(() => placeClassicRunes(classicSelections.value, runeMetadata.value))
const classicLegend = computed(() => classicSelections.value.map((selection) => ({
  selection,
  meta: runeMetadata.value[selection.runeId],
})))

const pathColors: Record<number, string> = {
  8000: "#d5aa58",
  8100: "#b64a4a",
  8200: "#6c7de1",
  8300: "#56b9c4",
  8400: "#65b96b",
}
const treeStyle = (styleId?: number) => ({
  "--path-accent": pathColors[styleId ?? 0] ?? "#c8aa6d",
})
const placementStyle = (placement: { x: number; y: number; size: number }) => ({
  left: `${placement.x}%`,
  top: `${placement.y}%`,
  width: `${placement.size}%`,
})
const chosen = (id: number) => selectedIds.value.has(id)
const shardChosen = (id: number, row: number) => selections.value.some((entry) =>
  entry.slot === 6 + row && entry.runeId === id)
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
      <aside v-if="open" class="rune-popover" :class="{ 'is-classic': classic }" :style="popoverStyle"
        @click.stop @mouseenter="enter" @mouseleave="leave">
        <header class="popover-header">
          <span class="eyebrow">{{ classic ? "League Classic setup" : "Rune page" }}</span>
          <strong v-if="modern">{{ pageStyles.map(style => style.name).join(" + ") || "Selected runes" }}</strong>
          <strong v-else>{{ classicView === "runes" ? "Rune board" : "Mastery trees" }}</strong>
          <button type="button" aria-label="Close rune page" @click="close">×</button>
        </header>

        <nav v-if="classic" class="classic-tabs" aria-label="Classic setup pages">
          <button type="button" :class="{ active: classicView === 'runes' }" @click="classicView = 'runes'">
            Rune board
          </button>
          <button type="button" :class="{ active: classicView === 'masteries' }" @click="classicView = 'masteries'">
            Masteries
          </button>
        </nav>

        <div v-if="modern && primaryStyle" class="modern-page">
          <section class="rune-tree primary" :style="treeStyle(primaryStyle.id)">
            <img class="tree-watermark" :src="runeStyleIconUrl(primaryStyle.id)" alt="" />
            <div class="path-strip" aria-label="Primary rune path">
              <img v-for="style in styleChoices" :key="style.id" :src="runeStyleIconUrl(style.id)" alt=""
                :title="style.name" :class="{ active: style.id === primaryStyle.id }" />
            </div>
            <h4><img :src="runeStyleIconUrl(primaryStyle.id)" alt="" />{{ primaryStyle.name }}<small>Primary path</small></h4>
            <div v-for="slot in primaryRuneSlots" :key="slot.type + slot.label" class="rune-row"
              :class="{ keystones: slot.type === 'kKeyStone' }">
              <span v-for="id in slot.perks" :key="id" class="rune-node"
                :class="{ selected: chosen(id), unselected: !chosen(id) }" :title="title(id)">
                <img :src="runeIconUrl(id)" :alt="title(id)" @error="hideBroken" />
              </span>
            </div>
          </section>

          <section v-if="secondaryStyle" class="rune-tree secondary" :style="treeStyle(secondaryStyle.id)">
            <img class="tree-watermark" :src="runeStyleIconUrl(secondaryStyle.id)" alt="" />
            <div class="path-strip" aria-label="Secondary rune path">
              <img v-for="style in styleChoices" :key="style.id" :src="runeStyleIconUrl(style.id)" alt=""
                :title="style.name" :class="{ active: style.id === secondaryStyle.id }" />
            </div>
            <h4><img :src="runeStyleIconUrl(secondaryStyle.id)" alt="" />{{ secondaryStyle.name }}<small>Secondary path</small></h4>
            <div v-for="slot in secondaryRuneSlots" :key="slot.type + slot.label" class="rune-row">
              <span v-for="id in slot.perks" :key="id" class="rune-node secondary-node"
                :class="{ selected: chosen(id), unselected: !chosen(id) }" :title="title(id)">
                <img :src="runeIconUrl(id)" :alt="title(id)" @error="hideBroken" />
              </span>
            </div>
            <div class="shard-divider">
              <span>Bonuses</span><small>{{ shardCaptureLabel }}</small>
            </div>
            <div v-for="(slot, shardRow) in statSlots" :key="slot.label" class="rune-row shard-row">
              <span v-for="id in slot.perks" :key="id" class="rune-node shard-node"
                :class="{ selected: shardChosen(id, shardRow), unselected: !shardChosen(id, shardRow) }"
                :title="title(id)">
                <img :src="runeIconUrl(id)" :alt="title(id)" @error="hideBroken" />
              </span>
            </div>
            <p v-if="capturedShardCount < 3" class="shard-capture-note">
              LCU match history omits bonus shards; Recall saves them when the
              in-game Active Player feed or Match-V5 supplies them.
            </p>
          </section>
        </div>

        <template v-else-if="classic">
          <section v-if="classicView === 'runes'" class="classic-runes-view">
            <div v-if="!classicPlacements.length" class="classic-capture-note">
              <strong>Rune page not captured</strong>
              <span>The match payload did not include this player's 30 sockets.</span>
            </div>
            <div class="classic-rune-board" aria-label="Classic rune socket board">
              <img class="board-backdrop" :src="classicRuneBoardUrl" alt="" />
              <span v-for="(placement, index) in classicPlacements" :key="`${placement.runeId}-${index}`"
                class="classic-rune-socket" :class="placement.type" :style="placementStyle(placement)"
                :title="`${title(placement.runeId)} · ${runeMetadata[placement.runeId]?.tooltip || ''}`">
                <img :src="runeIconUrl(placement.runeId)" :alt="title(placement.runeId)" @error="hideBroken" />
              </span>
            </div>
            <div v-if="classicLegend.length" class="classic-rune-legend">
              <span v-for="entry in classicLegend" :key="entry.selection.runeId">
                <img :src="runeIconUrl(entry.selection.runeId)" alt="" />
                <span><strong>{{ entry.meta?.name || title(entry.selection.runeId) }}</strong>
                  <small>{{ entry.selection.count || 1 }} equipped · {{ entry.meta?.tooltip }}</small></span>
              </span>
            </div>
          </section>

          <section v-else class="classic-masteries-view">
            <div class="classic-mastery-board" aria-label="Classic mastery trees">
              <img class="board-backdrop" :src="classicMasteriesUrl" alt="" />
              <div class="mastery-tree-labels" aria-hidden="true">
                <span>Offense</span><span>Defense</span><span>Utility</span>
              </div>
              <div class="mastery-unavailable">
                <strong>Mastery allocations not captured</strong>
                <span>Riot does not include the 30-point tree in the recorded match payload.</span>
              </div>
            </div>
            <p class="data-note">This neutral page preserves the historical layout without inventing a 21/9/0 build.</p>
          </section>
        </template>

        <p v-else class="classic-unavailable">
          No rune page was included in this match. Recall will show it here whenever a live or match capture supplies it.
        </p>

        <div v-if="selectedMeta.some(entry => entry.metrics.length)" class="rune-results">
          <h4>Match results</h4>
          <article v-for="entry in selectedMeta.filter(entry => entry.metrics.length)" :key="entry.selection.runeId">
            <img :src="runeIconUrl(entry.selection.runeId)" alt="" @error="hideBroken" />
            <span><strong>{{ entry.meta?.name || title(entry.selection.runeId) }}</strong>
              <small v-for="metric in entry.metrics" :key="metric">{{ metric }}</small></span>
          </article>
        </div>
      </aside>
    </Teleport>
  </span>
</template>

<style scoped>
.rune-page { position: relative; z-index: 4; display: inline-flex; min-width: 0; }
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
.trigger-copy strong { color: var(--text-secondary); font-size: 12px; }
.trigger-copy small { margin-top: 2px; color: var(--text-muted); font-size: 11px; }

.rune-popover { position: fixed; z-index: 1000; overflow-y: auto; padding: 14px; border: 1px solid rgba(200,170,109,.62); border-radius: var(--radius-md); background: radial-gradient(circle at 25% 0, rgba(35,71,94,.34), transparent 35%), linear-gradient(145deg, #080d17, #101725); box-shadow: 0 22px 60px rgba(0,0,0,.72); color: var(--text-primary); }
.rune-popover.is-classic { background: linear-gradient(145deg, #13100b, #19140d); }
.popover-header { display: flex; align-items: center; gap: 8px; min-height: 28px; padding-bottom: 9px; border-bottom: 1px solid var(--border-subtle); }
.popover-header strong { color: var(--gold-bright); font: 14px var(--font-heading); }
.popover-header button { margin-left: auto; border: 0; background: transparent; color: var(--text-muted); font-size: 20px; cursor: pointer; }

.modern-page { display: grid; grid-template-columns: 1.08fr .92fr; gap: 1px; margin-top: 10px; overflow: hidden; border: 1px solid rgba(200,170,109,.22); border-radius: 8px; background: rgba(2,6,12,.72); }
.rune-tree { position: relative; isolation: isolate; display: grid; align-content: start; gap: 7px; min-width: 0; padding: 13px 16px 15px; overflow: hidden; }
.rune-tree + .rune-tree { border-left: 1px solid rgba(200,170,109,.16); }
.tree-watermark { position: absolute; z-index: -1; top: 82px; left: 50%; width: 210px; height: 210px; object-fit: contain; opacity: .045; transform: translateX(-50%); filter: grayscale(.2); }
.path-strip { display: flex; justify-content: center; gap: 13px; min-height: 24px; }
.path-strip img { width: 22px; height: 22px; object-fit: contain; filter: grayscale(1); opacity: .22; transform: scale(.86); }
.path-strip img.active { filter: drop-shadow(0 0 6px var(--path-accent)); opacity: 1; transform: scale(1.08); }
.rune-tree h4 { display: flex; align-items: center; gap: 7px; min-height: 24px; margin: 0 0 1px; color: var(--path-accent); font: 12px var(--font-heading); letter-spacing: .45px; text-transform: uppercase; }
.rune-tree h4 > img { width: 23px; height: 23px; }
.rune-tree h4 small { margin-left: auto; color: var(--text-muted); font: 11px var(--font-body); letter-spacing: .35px; }
.rune-row { display: flex; align-items: center; justify-content: space-evenly; gap: 10px; min-height: 46px; }
.rune-node { position: relative; display: grid; place-items: center; width: 38px; height: 38px; border: 2px solid rgba(139,147,153,.38); border-radius: 50%; background: radial-gradient(circle, rgba(34,41,48,.95), rgba(9,12,17,.95)); box-shadow: inset 0 0 0 2px rgba(0,0,0,.65); transition: opacity .15s ease, filter .15s ease, transform .15s ease; }
.rune-node img { width: 34px; height: 34px; object-fit: contain; border-radius: 50%; }
.rune-node.unselected { filter: grayscale(1); opacity: .3; transform: scale(.91); }
.rune-node.selected { border-color: var(--path-accent); opacity: 1; box-shadow: 0 0 0 1px rgba(255,255,255,.42), 0 0 13px color-mix(in srgb, var(--path-accent) 70%, transparent), inset 0 0 0 2px rgba(0,0,0,.7); }
.keystones { min-height: 64px; }
.keystones .rune-node { width: 50px; height: 50px; }
.keystones .rune-node img { width: 46px; height: 46px; }
.secondary-node { width: 36px; height: 36px; }
.secondary-node img { width: 32px; height: 32px; }
.shard-divider { display: flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: var(--ui-text-label); letter-spacing: .7px; text-transform: uppercase; }
.shard-divider::before, .shard-divider::after { content: ""; flex: 1; height: 1px; background: rgba(200,170,109,.18); }
.shard-divider small { color: var(--text-muted); font: 10px var(--font-body); letter-spacing: .2px; text-transform: none; }
.shard-capture-note { margin: 0; color: var(--text-muted); font-size: 10px; line-height: 1.35; text-align: center; }
.shard-row { min-height: 34px; }
.shard-node { width: 27px; height: 27px; border-width: 1px; }
.shard-node img { width: 23px; height: 23px; }

.classic-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin: 10px 0 8px; padding: 3px; border: 1px solid rgba(200,170,109,.22); border-radius: 6px; background: rgba(0,0,0,.28); }
.classic-tabs button { min-height: 28px; border: 0; border-radius: 4px; background: transparent; color: var(--text-muted); font: 12px var(--font-heading); letter-spacing: .55px; text-transform: uppercase; cursor: pointer; }
.classic-tabs button.active { background: linear-gradient(#173354, #0e2540); color: #f0cf84; box-shadow: inset 0 0 0 1px rgba(200,170,109,.45); }
.classic-rune-board, .classic-mastery-board { position: relative; overflow: hidden; border: 1px solid rgba(232,197,111,.48); border-radius: 6px; background: #100c08; box-shadow: inset 0 0 22px rgba(0,0,0,.45); }
.board-backdrop { display: block; width: 100%; height: auto; }
.classic-rune-socket { position: absolute; display: grid; place-items: center; aspect-ratio: 1; transform: translate(-50%, -50%); filter: drop-shadow(0 2px 4px rgba(0,0,0,.72)); }
.classic-rune-socket img { width: 100%; height: 100%; object-fit: contain; }
.classic-rune-socket.kQuintessence { filter: drop-shadow(0 0 8px rgba(105,65,159,.9)) drop-shadow(0 2px 4px rgba(0,0,0,.75)); }
.classic-capture-note { display: flex; align-items: baseline; gap: 8px; margin-bottom: 7px; padding: 7px 10px; border: 1px solid rgba(200,170,109,.28); border-radius: 4px; background: rgba(255,247,212,.07); }
.classic-capture-note strong { flex: 0 0 auto; color: #f0cf84; font: 11px var(--font-heading); }
.classic-capture-note span { color: var(--text-muted); font-size: 12px; line-height: 1.35; }
.classic-rune-legend { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 8px; margin-top: 8px; }
.classic-rune-legend > span { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 5px 7px; border: 1px solid rgba(200,170,109,.19); border-radius: 4px; background: rgba(255,255,255,.025); }
.classic-rune-legend img { width: 29px; height: 29px; object-fit: contain; }
.classic-rune-legend > span > span { display: flex; flex-direction: column; min-width: 0; }
.classic-rune-legend strong, .classic-rune-legend small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.classic-rune-legend strong { color: var(--text-secondary); font-size: 12px; }
.classic-rune-legend small { color: var(--text-muted); font-size: 11px; }
.mastery-tree-labels { position: absolute; inset: auto 0 4% 0; display: grid; grid-template-columns: repeat(3, 1fr); color: rgba(255,237,196,.86); font: 13px var(--font-heading); text-align: center; text-shadow: 0 2px 3px #000; }
.mastery-unavailable { position: absolute; top: 50%; left: 50%; display: flex; flex-direction: column; align-items: center; width: min(370px, 72%); padding: 12px 16px; border: 1px solid rgba(232,197,111,.5); border-radius: 5px; background: rgba(3,7,10,.8); box-shadow: 0 10px 25px rgba(0,0,0,.46); text-align: center; transform: translate(-50%, -50%); }
.mastery-unavailable strong { color: #f0cf84; font: 13px var(--font-heading); }
.mastery-unavailable span { margin-top: 4px; color: #ddd2bc; font-size: 11px; line-height: 1.4; }
.data-note { margin: 7px 1px 0; color: var(--text-muted); font-size: 12px; line-height: 1.4; }

.rune-results { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7px 12px; margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--border-subtle); }
.rune-results h4 { grid-column: 1 / -1; margin: 0; color: var(--text-secondary); font: 12px var(--font-heading); letter-spacing: .7px; text-transform: uppercase; }
.rune-results article { display: flex; align-items: center; gap: 7px; }
.rune-results img { width: 30px; height: 30px; object-fit: contain; }
.rune-results article span { display: flex; flex-direction: column; min-width: 0; }
.rune-results strong { font-size: 12px; }
.rune-results small { color: var(--text-muted); font-size: 11px; line-height: 1.35; }
.classic-unavailable { margin: 10px 0 0; padding: 10px; border: 1px dashed var(--border-subtle); color: var(--text-muted); font-size: 12px; line-height: 1.5; }

@media (max-width: 700px) {
  .modern-page, .rune-results { grid-template-columns: 1fr; }
  .rune-tree + .rune-tree { border-top: 1px solid rgba(200,170,109,.16); border-left: 0; }
  .rune-results h4 { grid-column: auto; }
  .classic-rune-legend { grid-template-columns: 1fr; }
  .classic-capture-note { align-items: flex-start; flex-direction: column; gap: 2px; }
  .mastery-unavailable span { font-size: 11px; }
}
</style>
