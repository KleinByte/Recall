/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  // expose in the `electron/preload/index.ts`
  ipcRenderer: {
    on(channel: string, listener: (event: unknown, ...args: any[]) => void, subscriptionId: string): void
    off(channel: string, listener: (event: unknown, ...args: any[]) => void, subscriptionId: string): void
    send(channel: string, ...args: unknown[]): void
    invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
  }
  /** Development-only IPC fixture used by the fictional product showcase. */
  showcaseIpcRenderer?: Window["ipcRenderer"]
}
