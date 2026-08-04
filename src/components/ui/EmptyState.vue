<script setup lang="ts">
import { useSlots } from "vue"
import Surface from "./Surface.vue"

withDefaults(defineProps<{
  title: string
  description?: string
  tone?: "neutral" | "warning" | "danger"
  compact?: boolean
}>(), {
  description: undefined,
  tone: "neutral",
  compact: false,
})

const slots = useSlots()
</script>

<template>
  <Surface
    class="ui-empty-state"
    :class="['tone-' + tone, { compact }]"
    variant="quiet"
    :padding="compact ? 'compact' : 'normal'"
  >
    <div v-if="slots.icon" class="ui-empty-icon"><slot name="icon" /></div>
    <div class="ui-empty-copy">
      <h2>{{ title }}</h2>
      <slot><p v-if="description">{{ description }}</p></slot>
    </div>
    <div v-if="slots.actions" class="ui-empty-actions"><slot name="actions" /></div>
  </Surface>
</template>

<style scoped>
.ui-empty-state {
  display: flex;
  align-items: center;
  gap: var(--ui-space-4);
  border-left: 2px solid var(--ui-border-emphasis);
}
.ui-empty-copy { min-width: 0; }
.ui-empty-copy h2 { margin: 0; color: var(--ui-text-heading); font: 15px var(--ui-font-heading); }
.ui-empty-copy p { max-width: 72ch; margin: 5px 0 0; color: var(--ui-text-subtle); font-size: 12px; }
.ui-empty-icon { color: var(--ui-accent); font-size: 22px; }
.ui-empty-actions { display: flex; gap: var(--ui-space-2); margin-left: auto; }
.tone-warning { border-left-color: var(--ui-warning); }
.tone-danger { border-left-color: var(--ui-negative); }
.compact { gap: var(--ui-space-3); }
@container recall-content (max-width: 560px) {
  .ui-empty-state { align-items: flex-start; flex-wrap: wrap; }
  .ui-empty-actions { flex-basis: 100%; margin-left: 0; }
}
</style>
