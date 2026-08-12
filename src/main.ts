import { createApp } from "vue"
import "./style.css"

async function bootstrap() {
  const overlay = new URLSearchParams(window.location.search).get("surface") === "tempo-overlay"
  if (overlay) document.documentElement.classList.add("tempo-overlay-surface")
  const component = overlay
    ? (await import("./TempoOverlayApp.vue")).default
    : (await import("./App.vue")).default

  createApp(component)
    .mount("#app")
    .$nextTick(() => {
      postMessage({ payload: "removeLoading" }, "*")
    })
}

void bootstrap()
