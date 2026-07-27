<script setup lang="ts">
const props = defineProps<{
  page: number
  pageSize: number
  total: number
}>()

const emit = defineEmits<{
  (event: "update:page", value: number): void
  (event: "update:pageSize", value: number): void
}>()

const PAGE_SIZES = [25, 50, 100]

const lastPage = () => Math.max(1, Math.ceil(props.total / props.pageSize))
const from = () => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1)
const to = () => Math.min(props.total, props.page * props.pageSize)
</script>

<template>
  <div class="pagination">
    <div class="muted range numeric">
      {{ from().toLocaleString() }}–{{ to().toLocaleString() }} of
      {{ total.toLocaleString() }}
    </div>

    <div class="controls">
      <button
        class="league-button step"
        :disabled="page <= 1"
        @click="emit('update:page', 1)"
      >
        First
      </button>
      <button
        class="league-button step"
        :disabled="page <= 1"
        @click="emit('update:page', page - 1)"
      >
        Prev
      </button>

      <span class="numeric current">Page {{ page }} of {{ lastPage() }}</span>

      <button
        class="league-button step"
        :disabled="page >= lastPage()"
        @click="emit('update:page', page + 1)"
      >
        Next
      </button>
      <button
        class="league-button step"
        :disabled="page >= lastPage()"
        @click="emit('update:page', lastPage())"
      >
        Last
      </button>
    </div>

    <label class="size">
      <span class="muted">Per page</span>
      <select
        class="league-select"
        :value="pageSize"
        @change="
          emit(
            'update:pageSize',
            Number(($event.target as HTMLSelectElement).value),
          )
        "
      >
        <option v-for="size in PAGE_SIZES" :key="size" :value="size">
          {{ size }}
        </option>
      </select>
    </label>
  </div>
</template>

<style scoped>
.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding: var(--space-3) 0;
}

.range {
  font-size: 12px;
}

.controls {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.step {
  padding: var(--space-2) var(--space-3);
}

.step:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.current {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 0 var(--space-2);
}

.size {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
}
</style>
