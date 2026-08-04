<script setup lang="ts">
import type { UpdateStatus } from "../types/update"
import Button from "./ui/Button.vue"
import Surface from "./ui/Surface.vue"

defineProps<{
  status: UpdateStatus
}>()

const emit = defineEmits<{
  (event: "dismiss"): void
  (event: "install"): void
}>()
</script>

<template>
  <Surface
    v-if="status.kind === 'downloaded'"
    as="section"
    variant="raised"
    padding="compact"
    class="update-ready"
    role="status"
  >
    <div class="body">
      <strong>Recall {{ status.version }} is ready to install.</strong>
      <span>The update will restart Recall and finish in the background.</span>
    </div>
    <Button class="restart" variant="primary" size="compact" @click="emit('install')">
      Restart to update
    </Button>
    <Button
      class="dismiss"
      variant="ghost"
      size="compact"
      icon-only
      title="Later"
      aria-label="Later"
      @click="emit('dismiss')"
    >
      ×
    </Button>
  </Surface>
</template>

<style scoped>
.update-ready {
  display: flex;
  align-items: center;
  gap: var(--ui-space-3);
  margin-bottom: var(--ui-space-4);
  border-left: 3px solid var(--ui-accent);
}

.body {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.body strong {
  color: var(--ui-text-heading);
  font-family: var(--ui-font-heading);
  font-weight: 500;
  letter-spacing: 0.6px;
}

.body span {
  color: var(--ui-text-subtle);
  font-size: 12px;
}

.restart {
  white-space: nowrap;
}

.dismiss {
  font-size: 20px;
  line-height: 1;
}

@container recall-content (max-width: 620px) {
  .update-ready { align-items: flex-start; flex-wrap: wrap; }
  .body { order: 1; flex-basis: calc(100% - 44px); }
  .dismiss { order: 2; margin-left: auto; }
  .restart { order: 3; width: 100%; }
}
</style>
