<script setup lang="ts">
import Dialog from "../ui/Dialog.vue"

defineProps<{
  open: boolean
  title: string
  labelledBy: string
}>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Dialog
    v-if="open"
    :labelled-by="labelledBy"
    size="fullscreen"
    padding="none"
    @close="emit('close')"
  >
    <header class="map-popout-heading">
      <div>
        <span>Expanded review</span>
        <h2 :id="labelledBy">{{ title }}</h2>
      </div>
      <button type="button" aria-label="Close expanded map" title="Close expanded map" @click="emit('close')">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.4 4 4.6 4.6L14.6 4 16 5.4 11.4 10l4.6 4.6-1.4 1.4-4.6-4.6L5.4 16 4 14.6 8.6 10 4 5.4 5.4 4Z" /></svg>
      </button>
    </header>
    <div class="map-popout-body">
      <slot />
    </div>
  </Dialog>
  <slot v-else />
</template>

<style scoped>
.map-popout-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  gap: var(--ui-space-4);
  padding: var(--ui-space-4) var(--ui-space-5);
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-surface-raised);
}
.map-popout-heading span {
  color: var(--ui-text-muted);
  font-size: 11px;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.map-popout-heading h2 { margin: 2px 0 0; font-size: 18px; }
.map-popout-heading button {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
  color: var(--ui-text);
  cursor: pointer;
}
.map-popout-heading svg { width: 18px; fill: currentColor; }
.map-popout-body {
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: var(--ui-space-4);
  background: var(--ui-canvas);
}
</style>
