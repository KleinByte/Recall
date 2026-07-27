<script setup lang="ts">
defineProps<{ results: boolean[] }>()
</script>

<template>
  <div class="form-strip">
    <div v-if="results.length === 0" class="empty muted">No games recorded</div>
    <template v-else>
      <span
        v-for="(won, index) in results"
        :key="index"
        class="pill"
        :class="won ? 'win' : 'loss'"
        :title="won ? 'Win' : 'Loss'"
      >
        {{ won ? "W" : "L" }}
      </span>
    </template>
  </div>
</template>

<style scoped>
.form-strip {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  align-items: center;
}

.pill {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  font-family: var(--font-display);
  font-size: 11px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
}

.pill.win {
  background: var(--win-dim);
  border-color: var(--win);
  color: var(--win);
}

.pill.loss {
  background: var(--loss-dim);
  border-color: var(--loss);
  color: var(--loss);
}

.empty {
  font-size: 12px;
}
</style>
