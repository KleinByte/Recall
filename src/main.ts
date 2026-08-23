import { createApp } from "vue"
import "./style.css"

async function bootstrap() {
  const parameters = new URLSearchParams(window.location.search)
  const overlay = parameters.get("surface") === "tempo-overlay"
  const minimapDebug = import.meta.env.DEV &&
    parameters.get("surface") === "minimap-vision-debug"
  const showcase = import.meta.env.DEV ? parameters.get("showcase") : null
  if (showcase) {
    const { installShowcaseEnvironment, showcaseGameId } = await import(
      "./showcase/install-showcase-environment"
    )
    installShowcaseEnvironment(showcase)
    const navigation = await import("./helpers/navigation")
    if (["playback", "jungle", "review-overview", "review-rvi", "review-breakdown"].includes(showcase)) {
      navigation.focusReviewGameId.value = showcaseGameId
      navigation.page.value = "review"
    } else if (showcase === "champion") {
      navigation.openChampion(20)
    } else if (["skill-overview", "skill-insights", "skill-analyze"].includes(showcase)) {
      navigation.page.value = "skill"
    } else if (showcase === "progress") {
      navigation.page.value = "progress"
    } else if (showcase === "live") {
      navigation.page.value = "live"
    } else {
      navigation.page.value = "dashboard"
    }
  }
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
