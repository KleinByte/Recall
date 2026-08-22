import type { CampKey, CampVisualState, RgbaFrame } from "../../../src/shared/minimap/contracts.js"

/**
 * Pixel processing for camp classification lives in the OpenCV vision worker.
 * This module intentionally contains only serializable camp-template/domain
 * contracts so Electron main never owns OpenCV objects or handwritten image
 * primitives.
 */
export const CAMP_VISUAL_DETECTOR_VERSION = 6

export interface CampVisualTemplateAsset {
  campKey: CampKey | "*"
  state: Exclude<CampVisualState, "unknown">
  width: number
  height: number
  rgba: Uint8Array
}

export interface CampClassification {
  campKey: CampKey
  state: CampVisualState
  confidence: number
  scoreMargin: number
  method?:
    | "template"
    | "adaptive_alive_baseline"
    | "native_camp_icon"
    | "native_camp_icon_absence"
    | "native_respawn_timer"
    | "overlay_countdown"
}

/**
 * Serializable template bank. Preprocessing (resize, grayscale, gradients) is
 * deliberately deferred to the OpenCV worker and cached there for a session.
 */
export class CampTemplateBank {
  private readonly templates: CampVisualTemplateAsset[] = []

  add(
    campKey: CampKey | "*",
    state: Exclude<CampVisualState, "unknown">,
    patch: RgbaFrame,
  ) {
    if (!Number.isInteger(patch.width) || !Number.isInteger(patch.height) ||
        patch.width <= 0 || patch.height <= 0 ||
        patch.data.length !== patch.width * patch.height * 4) {
      throw new Error("invalid_camp_template_frame")
    }
    this.templates.push({
      campKey,
      state,
      width: patch.width,
      height: patch.height,
      rgba: Uint8Array.from(patch.data),
    })
  }

  forCamp(campKey: CampKey) {
    const exact = this.templates.filter((template) => template.campKey === campKey)
    const selected = exact.length > 0
      ? exact
      : this.templates.filter((template) => template.campKey === "*")
    return selected.map((template) => ({ ...template, rgba: Uint8Array.from(template.rgba) }))
  }

  snapshot() {
    return this.templates.map((template) => ({
      ...template,
      rgba: Uint8Array.from(template.rgba),
    }))
  }

  get size() {
    return this.templates.length
  }
}
