<script setup lang="ts">
import { computed, ref } from "vue"
import { currentAppVersion, patchNotes } from "../data/patch-notes"
import Button from "./ui/Button.vue"
import Dialog from "./ui/Dialog.vue"

const emit = defineEmits<{
  (event: "close"): void
}>()

const selectedVersion = ref(
  patchNotes.some((release) => release.version === currentAppVersion)
    ? currentAppVersion
    : patchNotes[0]?.version,
)

const selected = computed(
  () =>
    patchNotes.find((release) => release.version === selectedVersion.value) ??
    patchNotes[0],
)

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`))
}

</script>

<template>
  <Dialog
    labelled-by="patch-notes-title"
    size="large"
    padding="none"
    @close="emit('close')"
  >
        <header class="dialog-head">
          <div>
            <p class="eyebrow">What's new in Recall</p>
            <h2 id="patch-notes-title">Patch notes</h2>
          </div>
          <Button
            class="close"
            variant="ghost"
            size="compact"
            icon-only
            title="Close patch notes"
            aria-label="Close patch notes"
            @click="emit('close')"
          >
            ×
          </Button>
        </header>

        <div class="release-layout">
          <nav class="release-list" aria-label="Recall releases">
            <button
              v-for="release in patchNotes"
              :key="release.version"
              type="button"
              class="release-tab"
              :class="{ active: release.version === selectedVersion }"
              :aria-current="
                release.version === selectedVersion ? 'true' : undefined
              "
              @click="selectedVersion = release.version"
            >
              <span>Version {{ release.version }}</span>
              <small>
                {{
                  release.version === currentAppVersion
                    ? "Installed"
                    : displayDate(release.releasedAt)
                }}
              </small>
            </button>
          </nav>

          <article v-if="selected" class="release">
            <div class="release-heading">
              <div>
                <span class="version">Recall {{ selected.version }}</span>
                <h3>{{ selected.title }}</h3>
              </div>
              <time :datetime="selected.releasedAt">
                {{ displayDate(selected.releasedAt) }}
              </time>
            </div>

            <p class="summary">{{ selected.summary }}</p>

            <section
              v-for="section in selected.sections"
              :key="section.title"
              class="notes-section"
            >
              <h4>{{ section.title }}</h4>
              <ul>
                <li v-for="item in section.items" :key="item">{{ item }}</li>
              </ul>
            </section>
          </article>
        </div>

        <footer>
          <span class="muted">You're running Recall {{ currentAppVersion }}.</span>
          <Button variant="primary" @click="emit('close')">
            Got it
          </Button>
        </footer>
  </Dialog>
</template>

<style scoped>
.dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ui-space-4);
  padding: var(--ui-space-5);
  border-bottom: 1px solid var(--ui-divider);
  background:
    radial-gradient(
      circle at 10% 0%,
    color-mix(in srgb, var(--ui-accent) 12%, transparent),
      transparent 52%
    ),
    var(--ui-surface-raised);
}

.eyebrow {
  margin: 0 0 3px;
  color: var(--ui-accent);
  font-family: var(--ui-font-heading);
  font-size: 12px;
  letter-spacing: 1.8px;
  text-transform: uppercase;
}

h2 {
  margin: 0;
  color: var(--ui-text-heading);
  font-family: var(--ui-font-display);
  font-size: 25px;
  letter-spacing: 0.8px;
}

.close {
  font-size: 27px;
  line-height: 1;
}

.release-layout {
  min-height: 0;
  display: grid;
  grid-template-columns: 205px minmax(0, 1fr);
  flex: 1;
}

.release-list {
  min-height: 0;
  overflow-y: auto;
  padding: var(--ui-space-3);
  border-right: 1px solid var(--ui-divider);
  background: var(--ui-surface-inset);
}

.release-tab {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--ui-space-3);
  border: 1px solid transparent;
  border-left: 2px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text-subtle);
  cursor: pointer;
  font: 12px var(--ui-font-body);
  text-align: left;
}

.release-tab small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.release-tab:hover {
  background: var(--ui-surface-hover);
  color: var(--ui-text);
}

.release-tab.active {
  border-color: var(--ui-border);
  border-left-color: var(--ui-accent);
  background: var(--ui-surface-selected);
  color: var(--ui-text-heading);
}

.release {
  min-height: 0;
  overflow-y: auto;
  padding: var(--ui-space-5);
}

.release-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ui-space-4);
}

.version {
  color: var(--ui-accent);
  font-family: var(--ui-font-heading);
  font-size: 12px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

h3 {
  margin: 3px 0 0;
  color: var(--ui-text);
  font: 20px var(--ui-font-display);
}

time {
  color: var(--ui-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.summary {
  margin: var(--ui-space-3) 0 var(--ui-space-5);
  color: var(--ui-text-subtle);
  font-size: 13px;
  line-height: 1.65;
}

.notes-section + .notes-section {
  margin-top: var(--ui-space-5);
}

h4 {
  margin: 0 0 var(--ui-space-2);
  color: var(--ui-text-heading);
  font: 13px var(--ui-font-heading);
  letter-spacing: 0.4px;
}

ul {
  display: grid;
  gap: var(--ui-space-2);
  margin: 0;
  padding-left: 19px;
  color: var(--ui-text-subtle);
  font-size: 12px;
  line-height: 1.55;
}

li::marker {
  color: var(--ui-accent);
}

footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ui-space-4);
  padding: var(--ui-space-3) var(--ui-space-5);
  border-top: 1px solid var(--ui-divider);
  background: var(--ui-surface-raised);
  font-size: 12px;
}

@media (max-width: 680px) {
  .release-layout {
    grid-template-columns: 1fr;
  }

  .release-list {
    display: flex;
    flex: 0 0 auto;
    gap: var(--ui-space-1);
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--ui-divider);
  }

  .release-tab {
    width: auto;
    min-width: 130px;
  }

  .release-heading {
    flex-direction: column;
    gap: var(--ui-space-1);
  }
}
</style>
