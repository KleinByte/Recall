<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue"
import { championIconUrl } from "../helpers/format"
import type { Champion } from "../types/lol"

const props = defineProps<{
  champions: Champion[]
  modelValue?: number
}>()

const emit = defineEmits<{
  "update:modelValue": [value: number | undefined]
  change: []
}>()

const root = ref<HTMLElement>()
const searchInput = ref<HTMLInputElement>()
const open = ref(false)
const query = ref("")

const selectedChampion = computed(() =>
  props.champions.find((champion) => champion.id === props.modelValue),
)

const filteredChampions = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  if (!needle) return props.champions
  return props.champions.filter((champion) =>
    champion.name.toLocaleLowerCase().includes(needle),
  )
})

async function toggle() {
  open.value = !open.value
  if (open.value) {
    await nextTick()
    searchInput.value?.focus()
  } else {
    query.value = ""
  }
}

function close() {
  open.value = false
  query.value = ""
}

function select(value: number | undefined) {
  emit("update:modelValue", value)
  emit("change")
  close()
}

function handleOutsideClick(event: PointerEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) close()
}

onMounted(() => document.addEventListener("pointerdown", handleOutsideClick))
onBeforeUnmount(() => document.removeEventListener("pointerdown", handleOutsideClick))
</script>

<template>
  <div ref="root" class="champion-picker" @keydown.esc.stop="close">
    <button
      type="button"
      class="picker-trigger"
      aria-haspopup="listbox"
      :aria-expanded="open"
      aria-controls="skill-champion-options"
      @click="toggle"
    >
      <span class="trigger-value">
        <img
          v-if="selectedChampion"
          :src="championIconUrl(selectedChampion.id)"
          :alt="selectedChampion.name"
        />
        <span>{{ selectedChampion?.name ?? "Any champion" }}</span>
      </span>
      <span class="chevron" aria-hidden="true">⌄</span>
    </button>

    <div v-if="open" class="picker-popover">
      <label class="search-field">
        <span class="sr-only">Search champions</span>
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          class="league-input"
          placeholder="Search champions"
          autocomplete="off"
        />
      </label>

      <div id="skill-champion-options" class="champion-grid" role="listbox">
        <button
          type="button"
          class="champion-option any-option"
          role="option"
          :aria-selected="modelValue === undefined"
          :class="{ selected: modelValue === undefined }"
          @click="select(undefined)"
        >
          <span class="any-icon" aria-hidden="true">All</span>
          <span>Any champion</span>
        </button>

        <button
          v-for="champion in filteredChampions"
          :key="champion.id"
          type="button"
          class="champion-option"
          role="option"
          :aria-selected="modelValue === champion.id"
          :class="{ selected: modelValue === champion.id }"
          @click="select(champion.id)"
        >
          <img :src="championIconUrl(champion.id)" :alt="champion.name" />
          <span>{{ champion.name }}</span>
        </button>
      </div>

      <p v-if="!filteredChampions.length" class="empty muted">
        No played champions match “{{ query.trim() }}”.
      </p>
    </div>
  </div>
</template>

<style scoped>
.champion-picker {
  position: relative;
  width: 100%;
}

.picker-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 36px;
  gap: var(--space-2);
  padding: 4px var(--space-3) 4px 6px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--gold);
  font-family: var(--font-body);
  font-size: 13px;
  letter-spacing: .5px;
  cursor: pointer;
}

.picker-trigger:hover,
.picker-trigger[aria-expanded="true"] {
  border-color: var(--border-strong);
  background: var(--surface-3);
  color: var(--gold-bright);
}

.trigger-value {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: var(--space-2);
}

.trigger-value img {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border-radius: 4px;
  object-fit: cover;
}

.trigger-value span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chevron {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1;
}

.picker-popover {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  right: 0;
  width: min(540px, calc(100vw - 48px));
  padding: var(--space-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--surface-1);
  box-shadow: 0 18px 46px rgba(0, 0, 0, .48);
}

.search-field,
.search-field input {
  display: block;
  width: 100%;
}

.champion-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 6px;
  max-height: min(340px, 48vh);
  margin-top: var(--space-3);
  overflow-y: auto;
  padding-right: 2px;
}

.champion-option {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  min-width: 0;
  min-height: 42px;
  gap: var(--space-2);
  padding: 4px 7px 4px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.champion-option:hover,
.champion-option:focus-visible {
  border-color: var(--border-subtle);
  background: var(--surface-2);
}

.champion-option.selected {
  border-color: var(--gold-dim);
  background: var(--surface-3);
  color: var(--gold-bright);
}

.champion-option img,
.any-icon {
  width: 32px;
  height: 32px;
  border-radius: 5px;
}

.champion-option img {
  object-fit: cover;
}

.champion-option > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.any-icon {
  display: grid;
  place-items: center;
  border: 1px solid var(--border-subtle);
  background: var(--surface-2);
  color: var(--text-secondary);
  font-family: var(--font-heading);
  font-size: 9px;
  text-transform: uppercase;
}

.empty {
  margin: var(--space-3) 0 var(--space-1);
  font-size: 11px;
  text-align: center;
}

@media (max-width: 620px) {
  .picker-popover {
    width: min(100%, calc(100vw - 32px));
  }

  .champion-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-height: 44vh;
  }
}

@media (max-width: 390px) {
  .champion-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
