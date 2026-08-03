const header = document.querySelector("[data-header]")
const navToggle = document.querySelector(".nav-toggle")
const primaryNav = document.querySelector(".primary-nav")
const tourTabs = [...document.querySelectorAll("[data-tour]")]
const tourPanels = [...document.querySelectorAll("[data-panel]")]
const captionIndex = document.querySelector("[data-caption-index]")
const captionCopy = document.querySelector("[data-caption-copy]")

const tourContent = {
  dashboard: {
    index: "01 / Dashboard",
    copy: "See the session before the individual games: streak, recent form, The Dial, rank, records, and your mode-specific RVI.",
  },
  matches: {
    index: "02 / Match history",
    copy: "Filter a permanent local archive by mode, result, champion, grade, date, notes, bookmarks, or the practice experiment you were running.",
  },
  challenges: {
    index: "03 / Challenges",
    copy: "Pin the goals that matter, sort by distance to the next tier, and know whether the champion in your draft moves one of them forward.",
  },
}

function setHeaderState() {
  header?.classList.toggle("is-scrolled", window.scrollY > 12)
}

function closeNavigation() {
  primaryNav?.classList.remove("is-open")
  navToggle?.setAttribute("aria-expanded", "false")
}

function selectTour(name, moveFocus = false) {
  tourTabs.forEach((tab) => {
    const active = tab.dataset.tour === name
    tab.setAttribute("aria-selected", String(active))
    tab.tabIndex = active ? 0 : -1
    if (active && moveFocus) tab.focus()
  })

  tourPanels.forEach((panel) => {
    const active = panel.dataset.panel === name
    panel.hidden = !active
    panel.classList.toggle("is-active", active)
  })

  const content = tourContent[name]
  if (content && captionIndex && captionCopy) {
    captionIndex.textContent = content.index
    captionCopy.textContent = content.copy
  }
}

setHeaderState()
window.addEventListener("scroll", setHeaderState, { passive: true })

navToggle?.addEventListener("click", () => {
  const open = !primaryNav?.classList.contains("is-open")
  primaryNav?.classList.toggle("is-open", open)
  navToggle.setAttribute("aria-expanded", String(open))
})

primaryNav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeNavigation))

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeNavigation()
})

tourTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectTour(tab.dataset.tour))
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    let nextIndex = index
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tourTabs.length) % tourTabs.length
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tourTabs.length
    if (event.key === "Home") nextIndex = 0
    if (event.key === "End") nextIndex = tourTabs.length - 1
    selectTour(tourTabs[nextIndex].dataset.tour, true)
  })
})

document.querySelectorAll("[data-year]").forEach((node) => {
  node.textContent = String(new Date().getFullYear())
})
