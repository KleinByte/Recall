const header = document.querySelector("[data-header]")
const navToggle = document.querySelector(".nav-toggle")
const primaryNav = document.querySelector(".primary-nav")
const gallery = document.querySelector("[data-gallery]")
const galleryPrevious = document.querySelector("[data-gallery-previous]")
const galleryNext = document.querySelector("[data-gallery-next]")
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

function scrollGallery(direction) {
  if (!gallery) return
  gallery.scrollBy({ left: direction * gallery.clientWidth * 0.86, behavior: "smooth" })
}

galleryPrevious?.addEventListener("click", () => scrollGallery(-1))
galleryNext?.addEventListener("click", () => scrollGallery(1))
gallery?.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
  event.preventDefault()
  scrollGallery(event.key === "ArrowRight" ? 1 : -1)
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
