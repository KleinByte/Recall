<script setup lang="ts">
defineProps<{ maxHeight?: string }>()
</script>

<template>
  <div class="scroll" :style="{ maxHeight: maxHeight ?? '260px' }">
    <slot />
  </div>
</template>

<style scoped>
.scroll {
  overflow-y: auto;
  padding-right: var(--ui-space-2);
}

.scroll::-webkit-scrollbar {
  width: 6px;
}

.scroll::-webkit-scrollbar-track {
  background: var(--ui-surface-inset);
  border-radius: var(--ui-radius-sm);
}

.scroll::-webkit-scrollbar-thumb {
  background: var(--ui-accent-dim);
  border-radius: var(--ui-radius-sm);
}

.scroll::-webkit-scrollbar-thumb:hover {
  background: var(--ui-accent);
}
</style>
