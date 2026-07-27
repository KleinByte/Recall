import { BrowserWindow, screen } from "electron"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const WIDTH = 320
const HEIGHT = 190

/** Distance from the corner of the screen the overlay first appears at. */
const MARGIN = 24

export interface OverlayPosition {
  x: number
  y: number
}

/**
 * A small window that sits over the League client during champion select.
 *
 * It exists only while there is something to say — a champion is being held
 * and a pinned challenge has an opinion about it — and is destroyed the moment
 * that stops being true. Keeping it around invisibly would mean a stray
 * always-on-top window sitting over every other application.
 */
export class Overlay {
  private window?: BrowserWindow

  constructor(
    private readonly preload: string,
    private readonly indexHtml: string,
    private readonly devServerUrl: string | undefined,
    private readonly readPosition: () => OverlayPosition | undefined,
    private readonly writePosition: (position: OverlayPosition) => void,
  ) {}

  /** Shows the overlay, creating it if needed, and hands it something to say. */
  show(payload: unknown) {
    const window = this.window ?? this.create()

    if (window.webContents.isLoading()) {
      window.webContents.once("did-finish-load", () => {
        window.webContents.send("overlay:data", payload)
      })
    } else {
      window.webContents.send("overlay:data", payload)
    }

    // Shown without focus, so picking a champion is never interrupted by a
    // window stealing the keyboard from the client.
    if (!window.isVisible()) window.showInactive()
  }

  hide() {
    this.window?.destroy()
    this.window = undefined
  }

  private create(): BrowserWindow {
    const stored = this.readPosition()
    const area = screen.getPrimaryDisplay().workArea

    const window = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      x: stored?.x ?? area.x + area.width - WIDTH - MARGIN,
      y: stored?.y ?? area.y + MARGIN,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: this.preload,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
    })

    // Above the client, but not above system dialogs the player may need.
    window.setAlwaysOnTop(true, "normal")

    if (this.devServerUrl) {
      void window.loadURL(`${this.devServerUrl}#overlay`)
    } else {
      void window.loadFile(this.indexHtml, { hash: "overlay" })
    }

    window.on("moved", () => {
      const [x, y] = window.getPosition()
      this.writePosition({ x, y })
    })

    window.on("closed", () => {
      this.window = undefined
    })

    this.window = window
    return window
  }
}

export const overlayPreloadPath = () =>
  path.join(__dirname, "../preload/index.mjs")
