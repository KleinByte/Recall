<script setup lang="ts">
import { useSlots } from "vue"
import ScrollArea from "./ScrollArea.vue"
import Surface from "./Surface.vue"

withDefaults(defineProps<{
  title: string
  meta?: string
  scroll?: boolean
  maxHeight?: string
  variant?: "panel" | "quiet" | "inset" | "raised" | "instrument"
  padding?: "compact" | "normal" | "roomy"
}>(), {
  meta: undefined,
  scroll: false,
  maxHeight: undefined,
  variant: "panel",
  padding: "normal",
})

const slots = useSlots()
</script>

<template>
  <Surface as="section" class="card panel" :variant="variant" :padding="padding">
    <header class="head">
      <h2 class="section-title flush">{{ title }}</h2>
      <span v-if="meta" class="muted meta">{{ meta }}</span>
      <div v-if="slots.actions" class="actions"><slot name="actions" /></div>
    </header>

    <ScrollArea v-if="scroll" :max-height="maxHeight">
      <slot />
    </ScrollArea>
    <slot v-else />
  </Surface>
</template>

<style scoped>
.panel {
  min-width: 0;
}

.head {
  display: flex;
  align-items: baseline;
  gap: var(--ui-space-3);
  margin-bottom: var(--ui-space-3);
  padding-bottom: 9px;
  border-bottom: 1px solid var(--ui-divider);
}

.section-title.flush {
  margin: 0;
}

.meta {
  color: var(--ui-text-muted);
  font-size: 11px;
  margin-left: auto;
  text-align: right;
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
  margin-left: auto;
}

.meta + .actions { margin-left: 0; }
</style>
