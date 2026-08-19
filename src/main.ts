import { createApp } from "vue"
import "./style.css"

async function bootstrap() {
  const overlay = new URLSearchParams(window.location.search).get("surface") === "tempo-overlay"
  const minimapDebug = new URLSearchParams(window.location.search).get("surface") === "minimap-vision-debug"
  if (overlay) document.documentElement.classList.add("tempo-overlay-surface")
  if (minimapDebug) document.documentElement.classList.add("minimap-debug-overlay-surface")
  const component = overlay
    ? (await import("./TempoOverlayApp.vue")).default
    : minimapDebug
      ? (await import("./MinimapVisionDebugOverlay.vue")).default
    : (await import("./App.vue")).default

  createApp(component)
    .mount("#app")
    .$nextTick(() => {
      postMessage({ payload: "removeLoading" }, "*")
    })
}

void bootstrap()
