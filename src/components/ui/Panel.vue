<script setup lang="ts">
import ScrollArea from "./ScrollArea.vue"

defineProps<{
  title: string
  meta?: string
  scroll?: boolean
  maxHeight?: string
}>()
</script>

<template>
  <section class="card panel">
    <header class="head">
      <h2 class="section-title flush">{{ title }}</h2>
      <span v-if="meta" class="muted meta">{{ meta }}</span>
      <slot name="actions" />
    </header>

    <ScrollArea v-if="scroll" :max-height="maxHeight">
      <slot />
    </ScrollArea>
    <slot v-else />
  </section>
</template>

<style scoped>
.panel {
  padding: var(--space-3) var(--space-4) var(--space-4);
  min-width: 0;
}

.head {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.section-title.flush {
  margin: 0;
}

.meta {
  font-size: 11px;
  margin-left: auto;
  text-align: right;
}
</style>
