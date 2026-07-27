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
  padding-right: var(--space-2);
}

.scroll::-webkit-scrollbar {
  width: 6px;
}

.scroll::-webkit-scrollbar-track {
  background: var(--surface-2);
  border-radius: var(--radius-sm);
}

.scroll::-webkit-scrollbar-thumb {
  background: var(--gold-faint);
  border-radius: var(--radius-sm);
}

.scroll::-webkit-scrollbar-thumb:hover {
  background: var(--gold-dim);
}
</style>
