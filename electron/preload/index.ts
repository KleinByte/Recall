import { ipcRenderer, contextBridge } from "electron"

type IpcListener = Parameters<typeof ipcRenderer.on>[1]

interface ChannelSubscription {
  listeners: Map<string, IpcListener>
  wrapped: IpcListener
}

// Context-bridge callback proxies do not have stable identity across separate
// `on` and `off` calls. Keep one native listener per channel and address the
// renderer owners by a plain string instead.
const channelSubscriptions = new Map<string, ChannelSubscription>()

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld("ipcRenderer", {
  on(channel: string, listener: IpcListener, subscriptionId: string) {
    let subscription = channelSubscriptions.get(channel)
    if (!subscription) {
      const listeners = new Map<string, IpcListener>()
      const wrapped: IpcListener = (event, ...payload) => {
        for (const current of [...listeners.values()]) current(event, ...payload)
      }
      subscription = { listeners, wrapped }
      channelSubscriptions.set(channel, subscription)
      ipcRenderer.on(channel, wrapped)
    }
    // Re-registering the same owner (for example after HMR) replaces its proxy.
    subscription.listeners.set(subscriptionId, listener)
  },
  off(channel: string, _listener: IpcListener, subscriptionId: string) {
    const subscription = channelSubscriptions.get(channel)
    if (!subscription) return
    subscription.listeners.delete(subscriptionId)
    if (subscription.listeners.size > 0) return
    ipcRenderer.off(channel, subscription.wrapped)
    channelSubscriptions.delete(channel)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

// --------- Preload scripts loading ---------
function domReady(
  condition: DocumentReadyState[] = ["complete", "interactive"]
) {
  return new Promise((resolve) => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      const handleReadyState = () => {
        if (condition.includes(document.readyState)) {
          document.removeEventListener("readystatechange", handleReadyState)
          resolve(true)
        }
      }
      document.addEventListener("readystatechange", handleReadyState)
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find((e) => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find((e) => e === child)) {
      return parent.removeChild(child)
    }
  },
}

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function useLoading() {
  const className = `loaders-css__square-spin`
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `
  const oStyle = document.createElement("style")
  const oDiv = document.createElement("div")

  oStyle.id = "app-loading-style"
  oStyle.innerHTML = styleContent
  oDiv.className = "app-loading-wrap"
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

// ----------------------------------------------------------------------

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
  ev.data.payload === "removeLoading" && removeLoading()
}

setTimeout(removeLoading, 4999)
