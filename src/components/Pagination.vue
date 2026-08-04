<script setup lang="ts">
import Button from "./ui/Button.vue"

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
  <nav class="pagination" aria-label="Pagination">
    <div class="range">
      {{ from().toLocaleString() }}–{{ to().toLocaleString() }} of
      {{ total.toLocaleString() }}
    </div>

    <div class="controls">
      <Button
        class="step"
        size="compact"
        :disabled="page <= 1"
        @click="emit('update:page', 1)"
      >
        First
      </Button>
      <Button
        class="step"
        size="compact"
        :disabled="page <= 1"
        @click="emit('update:page', page - 1)"
      >
        Prev
      </Button>

      <span class="current">Page {{ page }} of {{ lastPage() }}</span>

      <Button
        class="step"
        size="compact"
        :disabled="page >= lastPage()"
        @click="emit('update:page', page + 1)"
      >
        Next
      </Button>
      <Button
        class="step"
        size="compact"
        :disabled="page >= lastPage()"
        @click="emit('update:page', lastPage())"
      >
        Last
      </Button>
    </div>

    <label class="size">
      <span>Per page</span>
      <select
        class="league-select page-size-select"
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
  </nav>
</template>

<style scoped>
.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-4);
  flex-wrap: wrap;
  padding: var(--ui-space-3) 0;
}

.range {
  color: var(--ui-text-muted);
  font-family: var(--ui-font-numeric);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--ui-space-2);
}

.current {
  font-size: 12px;
  color: var(--ui-text-subtle);
  padding: 0 var(--ui-space-2);
  font-family: var(--ui-font-numeric);
  font-variant-numeric: tabular-nums;
}

.size {
  display: flex;
  align-items: center;
  gap: var(--ui-space-2);
  color: var(--ui-text-muted);
  font-size: 12px;
}

.page-size-select {
  min-height: var(--ui-control-height-compact);
  padding-block: 3px;
  font-size: 11px;
}

@container recall-content (max-width: 620px) {
  .pagination { justify-content: center; }
  .range { width: 100%; text-align: center; }
  .controls { order: 3; width: 100%; }
}

@container recall-content (max-width: 420px) {
  .current { order: -1; flex-basis: 100%; text-align: center; }
  .step { flex: 1 1 64px; }
}
</style>
