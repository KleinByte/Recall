const header = document.querySelector("[data-header]")
const navToggle = document.querySelector(".nav-toggle")
const primaryNav = document.querySelector(".primary-nav")
const showcase = document.querySelector("[data-showcase]")
const showcaseSlides = [...document.querySelectorAll("[data-showcase-slide]")]
const showcaseThumbs = [...document.querySelectorAll("[data-showcase-thumb]")]
const showcasePrevious = document.querySelector("[data-showcase-previous]")
const showcaseNext = document.querySelector("[data-showcase-next]")
const showcaseCurrent = document.querySelector("[data-showcase-current]")
const scrollProgress = document.querySelector("[data-scroll-progress]")
const pointerAura = document.querySelector("[data-pointer-aura]")
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
const socialCardMode = new URLSearchParams(window.location.search).has("social-card")

if (socialCardMode) {
  document.body.classList.add("social-card-mode")
}

function setHeaderState() {
  header?.classList.toggle("is-scrolled", window.scrollY > 12)
}

function closeNavigation() {
  primaryNav?.classList.remove("is-open")
  navToggle?.setAttribute("aria-expanded", "false")
}

setHeaderState()
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
let pointerStart = null

function selectShowcase(requestedIndex, moveFocus = false) {
  if (!showcaseSlides.length) return
  activeShowcaseIndex = (requestedIndex + showcaseSlides.length) % showcaseSlides.length

  showcaseSlides.forEach((slide, index) => {
    const active = index === activeShowcaseIndex
    slide.hidden = !active
    slide.classList.toggle("is-active", active)
  })

  const activeAnimation = showcaseSlides[activeShowcaseIndex]?.querySelector('img[src*=".gif"]')
  if (activeAnimation && !reducedMotion.matches) {
    const source = activeAnimation.getAttribute("src")?.split("?")[0]
    if (source) activeAnimation.setAttribute("src", `${source}?play=${Date.now()}`)
  }

  showcaseThumbs.forEach((thumb, index) => {
    const active = index === activeShowcaseIndex
    thumb.classList.toggle("is-active", active)
    thumb.setAttribute("aria-selected", String(active))
    thumb.tabIndex = active ? 0 : -1
    if (active && moveFocus) thumb.focus()
  })

  if (showcaseCurrent) showcaseCurrent.textContent = String(activeShowcaseIndex + 1).padStart(2, "0")
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
  if (event.pointerType !== "mouse") pointerStart = event.clientX
})
showcase?.addEventListener("pointerup", (event) => {
  if (pointerStart === null) return
  const distance = event.clientX - pointerStart
  pointerStart = null
  if (Math.abs(distance) >= 50) selectShowcase(activeShowcaseIndex + (distance < 0 ? 1 : -1))
})
showcaseThumbs.forEach((thumb, index) => {
  thumb.addEventListener("click", () => selectShowcase(index))
  thumb.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    if (event.key === "Home") return selectShowcase(0, true)
    if (event.key === "End") return selectShowcase(showcaseThumbs.length - 1, true)
    selectShowcase(index + (event.key === "ArrowRight" ? 1 : -1), true)
  })
})

document.querySelectorAll("[data-year]").forEach((node) => {
  node.textContent = String(new Date().getFullYear())
})

const revealSelectors = [
  ".section-heading",
  ".cv-spotlight > *",
  ".cv-flow > li",
  ".feature-story > *",
  ".champion-story > *",
  ".feature-card",
  ".review-suite > *",
  ".review-mosaic figure",
  ".skill-suite > *",
  ".skill-visuals figure",
  ".records-suite > *",
  ".accuracy-layout > *",
  ".privacy-layout > *",
  ".start-steps > li",
  ".showcase-stage",
  ".showcase-thumbnails",
  ".faq-list",
  ".final-cta",
]
const revealTargets = [...document.querySelectorAll(revealSelectors.join(","))]

revealTargets.forEach((element, index) => {
  element.dataset.reveal = ""
  element.style.setProperty("--reveal-delay", `${Math.min(index % 4, 3) * 75}ms`)
})

if (!socialCardMode) {
  document.body.classList.add("motion-ready")
  if (reducedMotion.matches || !("IntersectionObserver" in window)) {
    revealTargets.forEach((element) => element.classList.add("is-visible"))
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add("is-visible")
        observer.unobserve(entry.target)
      })
    }, { rootMargin: "0px 0px -9%", threshold: 0.08 })
    revealTargets.forEach((element) => observer.observe(element))
  }
}

let scrollFrame = 0
function updateScrollEffects() {
  scrollFrame = 0
  setHeaderState()
  const maximum = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
  const progress = Math.max(0, Math.min(1, window.scrollY / maximum))
  scrollProgress?.style.setProperty("--scroll-progress", String(progress))

  if (reducedMotion.matches) return
  document.querySelectorAll("[data-parallax]").forEach((element) => {
    const rect = element.getBoundingClientRect()
    if (rect.bottom < -200 || rect.top > window.innerHeight + 200) return
    const factor = Number(element.dataset.parallax || 0)
    const offset = (rect.top + rect.height / 2 - window.innerHeight / 2) * factor
    element.style.setProperty("--parallax-y", `${offset.toFixed(1)}px`)
  })
}

function scheduleScrollEffects() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScrollEffects)
}

updateScrollEffects()
window.addEventListener("scroll", scheduleScrollEffects, { passive: true })
window.addEventListener("resize", scheduleScrollEffects, { passive: true })

if (!reducedMotion.matches) {
  window.addEventListener("pointermove", (event) => {
    pointerAura?.style.setProperty("--pointer-x", `${event.clientX}px`)
    pointerAura?.style.setProperty("--pointer-y", `${event.clientY}px`)
  }, { passive: true })

  document.querySelectorAll("[data-tilt]").forEach((element) => {
    element.addEventListener("pointermove", (event) => {
      const rect = element.getBoundingClientRect()
      const x = (event.clientX - rect.left) / rect.width - 0.5
      const y = (event.clientY - rect.top) / rect.height - 0.5
      element.style.setProperty("--tilt-y", `${(-3 + x * 5).toFixed(2)}deg`)
      element.style.setProperty("--tilt-x", `${(1.5 - y * 4).toFixed(2)}deg`)
    })
    element.addEventListener("pointerleave", () => {
      element.style.setProperty("--tilt-y", "-3deg")
      element.style.setProperty("--tilt-x", "1.5deg")
    })
  })

  document.querySelectorAll(".feature-card").forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect()
      card.style.setProperty("--card-x", `${event.clientX - rect.left}px`)
      card.style.setProperty("--card-y", `${event.clientY - rect.top}px`)
    })
  })
}

document.querySelectorAll(".faq-list details").forEach((item) => {
  item.addEventListener("toggle", () => {
    if (!item.open) return
    document.querySelectorAll(".faq-list details[open]").forEach((openItem) => {
      if (openItem !== item) openItem.open = false
    })
  })
})
