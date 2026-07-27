import { createApp } from "vue"
import App from "./App.vue"
import Overlay from "./Overlay.vue"

import "./style.css"

/**
 * Both windows load this same bundle.
 *
 * The champion select overlay is a second, frameless window rather than a
 * separate build: it shares the theme, the preload bridge and the types, and
 * a hash is enough to tell the two apart.
 */
const isOverlay = window.location.hash === "#overlay"

if (isOverlay) document.body.classList.add("overlay-window")

createApp(isOverlay ? Overlay : App)
  .mount("#app")
  .$nextTick(() => {
    postMessage({ payload: "removeLoading" }, "*")
  })
