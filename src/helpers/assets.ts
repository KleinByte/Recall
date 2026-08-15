export function publicAssetUrl(path: string): string {
  const relative = `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`
  // CSS custom properties resolve relative url() values against the stylesheet
  // that consumes them. In a packaged build that incorrectly points at
  // dist/assets/game-data. An absolute URL keeps images rooted beside
  // dist/index.html for both normal attributes and CSS variables.
  return typeof document === "undefined"
    ? relative
    : new URL(relative, document.baseURI).href
}
