const header = document.querySelector("[data-header]")
const navToggle = document.querySelector(".nav-toggle")
const primaryNav = document.querySelector(".primary-nav")
const showcase = document.querySelector("[data-showcase]")
const showcaseSlides = [...document.querySelectorAll("[data-showcase-slide]")]
const showcaseThumbs = [...document.querySelectorAll("[data-showcase-thumb]")]
const showcasePrevious = document.querySelector("[data-showcase-previous]")
const showcaseNext = document.querySelector("[data-showcase-next]")
const showcaseCurrent = document.querySelector("[data-showcase-current]")
const showcaseProgress = document.querySelector("[data-showcase-progress]")
const skillTabs = [...document.querySelectorAll("[data-skill-tab]")]
const skillPanels = [...document.querySelectorAll("[data-skill-panel]")]

function setHeaderState() {
  header?.classList.toggle("is-scrolled", window.scrollY > 12)
}

function closeNavigation() {
  primaryNav?.classList.remove("is-open")
  navToggle?.setAttribute("aria-expanded", "false")
}

function selectSkill(name, moveFocus = false) {
  skillTabs.forEach((tab) => {
    const active = tab.dataset.skillTab === name
    tab.setAttribute("aria-selected", String(active))
    tab.tabIndex = active ? 0 : -1
    if (active && moveFocus) tab.focus()
  })

  skillPanels.forEach((panel) => {
    const active = panel.dataset.skillPanel === name
    panel.hidden = !active
    panel.classList.toggle("is-active", active)
  })
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

let activeShowcaseIndex = 0
let showcasePointerStart = null

function selectShowcase(requestedIndex, moveFocus = false) {
  if (!showcaseSlides.length) return
  activeShowcaseIndex = (requestedIndex + showcaseSlides.length) % showcaseSlides.length

  showcaseSlides.forEach((slide, index) => {
    const active = index === activeShowcaseIndex
    slide.hidden = !active
    slide.classList.toggle("is-active", active)
  })

  showcaseThumbs.forEach((thumb, index) => {
    const active = index === activeShowcaseIndex
    thumb.classList.toggle("is-active", active)
    thumb.setAttribute("aria-selected", String(active))
    thumb.tabIndex = active ? 0 : -1
    if (active) {
      const thumbnailRail = thumb.parentElement
      if (thumbnailRail?.scrollWidth > thumbnailRail?.clientWidth) {
        thumbnailRail.scrollTo({
          left: thumb.offsetLeft - thumbnailRail.clientWidth / 2 + thumb.clientWidth / 2,
          behavior: "smooth",
        })
      }
      if (moveFocus) thumb.focus()
    }
  })

  if (showcaseCurrent) showcaseCurrent.textContent = String(activeShowcaseIndex + 1).padStart(2, "0")
  if (showcaseProgress) showcaseProgress.style.width = `${((activeShowcaseIndex + 1) / showcaseSlides.length) * 100}%`
}

showcasePrevious?.addEventListener("click", () => selectShowcase(activeShowcaseIndex - 1))
showcaseNext?.addEventListener("click", () => selectShowcase(activeShowcaseIndex + 1))
showcase?.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
  event.preventDefault()
  if (event.key === "ArrowLeft") selectShowcase(activeShowcaseIndex - 1)
  if (event.key === "ArrowRight") selectShowcase(activeShowcaseIndex + 1)
  if (event.key === "Home") selectShowcase(0)
  if (event.key === "End") selectShowcase(showcaseSlides.length - 1)
})
showcase?.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse") return
  showcasePointerStart = event.clientX
})
showcase?.addEventListener("pointerup", (event) => {
  if (showcasePointerStart === null) return
  const distance = event.clientX - showcasePointerStart
  showcasePointerStart = null
  if (Math.abs(distance) < 50) return
  selectShowcase(activeShowcaseIndex + (distance < 0 ? 1 : -1))
})

showcaseThumbs.forEach((thumb, index) => {
  thumb.addEventListener("click", () => selectShowcase(index))
  thumb.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    let nextIndex = index
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + showcaseThumbs.length) % showcaseThumbs.length
    if (event.key === "ArrowRight") nextIndex = (index + 1) % showcaseThumbs.length
    if (event.key === "Home") nextIndex = 0
    if (event.key === "End") nextIndex = showcaseThumbs.length - 1
    selectShowcase(nextIndex, true)
  })
})

skillTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectSkill(tab.dataset.skillTab))
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    let nextIndex = index
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + skillTabs.length) % skillTabs.length
    if (event.key === "ArrowRight") nextIndex = (index + 1) % skillTabs.length
    if (event.key === "Home") nextIndex = 0
    if (event.key === "End") nextIndex = skillTabs.length - 1
    selectSkill(skillTabs[nextIndex].dataset.skillTab, true)
  })
})

document.querySelectorAll("[data-year]").forEach((node) => {
  node.textContent = String(new Date().getFullYear())
})
