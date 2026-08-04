<script setup lang="ts">
import { useSlots } from "vue"

withDefaults(defineProps<{
  title: string
  eyebrow?: string
  description?: string
  compact?: boolean
}>(), {
  eyebrow: undefined,
  description: undefined,
  compact: false,
})

const slots = useSlots()
</script>

<template>
  <header class="ui-page-header" :class="{ compact }">
    <div class="ui-page-header-copy">
      <span v-if="eyebrow" class="ui-eyebrow">{{ eyebrow }}</span>
      <h1>{{ title }}</h1>
      <slot name="description">
        <p v-if="description" class="ui-page-description">{{ description }}</p>
      </slot>
      <slot />
    </div>
    <div v-if="slots.actions" class="ui-page-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.ui-page-header {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--ui-space-5);
  min-width: 0;
  padding: 3px 3px var(--ui-space-4);
  border-bottom: 1px solid var(--ui-divider);
}

.ui-page-header::after {
  content: "";
  position: absolute;
  inset: auto 62% -1px 3px;
  height: 1px;
  background: linear-gradient(90deg, var(--ui-accent), transparent);
  opacity: .48;
}

.ui-page-header-copy { min-width: 0; }

.ui-page-header h1 {
  margin: 2px 0 0;
  color: var(--ui-text-heading);
  font: clamp(23px, 2vw, 29px)/1.08 var(--ui-font-display);
  letter-spacing: .35px;
}

.ui-eyebrow {
  color: var(--ui-text-muted);
  font: var(--ui-label-size) var(--ui-font-heading);
  letter-spacing: 2px;
  text-transform: uppercase;
}

.ui-page-description {
  max-width: 72ch;
  margin: 7px 0 0;
  color: var(--ui-text-subtle);
  font-size: 12px;
  line-height: 1.45;
}

.ui-page-actions {
  display: flex;
  align-items: end;
  justify-content: flex-end;
  gap: var(--ui-space-2);
  min-width: 0;
}

.compact { padding-bottom: var(--ui-space-3); }

@container recall-content (max-width: 680px) {
  .ui-page-header { align-items: stretch; flex-direction: column; gap: var(--ui-space-3); }
  .ui-page-actions { justify-content: stretch; }
  .ui-page-actions :deep(> *) { flex: 1; min-width: 0; }
}
</style>
