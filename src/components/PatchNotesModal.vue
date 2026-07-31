<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { currentAppVersion, patchNotes } from "../data/patch-notes"

const emit = defineEmits<{
  (event: "close"): void
}>()

const dialog = ref<HTMLElement | null>(null)
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

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close")
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`))
}

onMounted(() => {
  window.addEventListener("keydown", closeOnEscape)
  dialog.value?.focus()
})

onBeforeUnmount(() => window.removeEventListener("keydown", closeOnEscape))
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @click.self="emit('close')">
      <section
        ref="dialog"
        class="dialog card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="patch-notes-title"
        tabindex="-1"
      >
        <header class="dialog-head">
          <div>
            <p class="eyebrow">What's new in Recall</p>
            <h2 id="patch-notes-title">Patch notes</h2>
          </div>
          <button
            class="close"
            type="button"
            title="Close patch notes"
            aria-label="Close patch notes"
            @click="emit('close')"
          >
            ×
          </button>
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
          <button class="league-button" type="button" @click="emit('close')">
            Got it
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  padding: var(--space-5);
  background: rgba(3, 8, 18, 0.82);
}

.dialog {
  width: min(860px, 100%);
  max-height: min(760px, calc(100vh - 40px));
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}

.dialog:focus {
  outline: none;
}

.dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  background:
    radial-gradient(
      circle at 10% 0%,
      rgba(200, 170, 109, 0.12),
      transparent 52%
    ),
    var(--surface-2);
}

.eyebrow {
  margin: 0 0 3px;
  color: var(--gold);
  font-family: var(--font-heading);
  font-size: 10px;
  letter-spacing: 1.8px;
  text-transform: uppercase;
}

h2 {
  margin: 0;
  color: var(--gold-bright);
  font-family: var(--font-display);
  font-size: 25px;
  letter-spacing: 0.8px;
}

.close {
  border: 0;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 27px;
  line-height: 1;
}

.close:hover {
  color: var(--text-primary);
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
  padding: var(--space-3);
  border-right: 1px solid var(--border-subtle);
  background: var(--surface-1);
}

.release-tab {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3);
  border: 1px solid transparent;
  border-left: 2px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font: 12px var(--font-body);
  text-align: left;
}

.release-tab small {
  color: var(--text-muted);
  font-size: 9px;
}

.release-tab:hover {
  background: var(--surface-2);
  color: var(--text-primary);
}

.release-tab.active {
  border-color: var(--border-subtle);
  border-left-color: var(--gold);
  background: var(--surface-3);
  color: var(--gold-bright);
}

.release {
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-5);
}

.release-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.version {
  color: var(--gold);
  font-family: var(--font-heading);
  font-size: 10px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

h3 {
  margin: 3px 0 0;
  color: var(--text-primary);
  font: 20px var(--font-display);
}

time {
  color: var(--text-muted);
  font-size: 10px;
  white-space: nowrap;
}

.summary {
  margin: var(--space-3) 0 var(--space-5);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.65;
}

.notes-section + .notes-section {
  margin-top: var(--space-5);
}

h4 {
  margin: 0 0 var(--space-2);
  color: var(--gold-bright);
  font: 13px var(--font-heading);
  letter-spacing: 0.4px;
}

ul {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding-left: 19px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.55;
}

li::marker {
  color: var(--gold);
}

footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-2);
  font-size: 10px;
}

@media (max-width: 680px) {
  .backdrop {
    align-items: flex-start;
    padding: var(--space-3);
  }

  .dialog {
    max-height: calc(100vh - 24px);
  }

  .release-layout {
    grid-template-columns: 1fr;
  }

  .release-list {
    display: flex;
    flex: 0 0 auto;
    gap: var(--space-1);
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .release-tab {
    width: auto;
    min-width: 130px;
  }

  .release-heading {
    flex-direction: column;
    gap: var(--space-1);
  }
}
</style>
