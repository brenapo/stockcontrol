import { useEffect, useState } from 'react'

// ---------- service worker + "new version" check ----------
type Listener = () => void
const listeners = new Set<Listener>()
let updateReady = false
const announce = () => { updateReady = true; listeners.forEach((l) => l()) }

async function checkVersion() {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return
    const { build } = (await r.json()) as { build?: string }
    if (build && build !== __BUILD_ID__) announce()
  } catch { /* offline: try later */ }
}

export function startPwa() {
  if (!import.meta.env.PROD) return
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
  }
  // look for a new version when the app comes back to the front, and every 5 minutes
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion() })
  setInterval(checkVersion, 5 * 60_000)
  setTimeout(checkVersion, 15_000)
}

export async function applyUpdate() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    await reg?.update()
  } catch { /* reload anyway */ }
  location.reload()
}

export function useUpdateReady() {
  const [ready, setReady] = useState(updateReady)
  useEffect(() => {
    const l = () => setReady(true)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return ready
}

// ---------- install ----------
type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: PromptEvent | null = null
const installListeners = new Set<Listener>()
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e as PromptEvent
  installListeners.forEach((l) => l())
})
window.addEventListener('appinstalled', () => { deferred = null; installListeners.forEach((l) => l()) })

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const DISMISS_KEY = 'sr-install-dismissed'
const dismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false } }

export function useInstall() {
  const [, force] = useState(0)
  const [hidden, setHidden] = useState(dismissed)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    installListeners.add(l)
    return () => { installListeners.delete(l) }
  }, [])
  const mode: 'android' | 'ios' | null = isStandalone() || hidden ? null : deferred ? 'android' : isIos() ? 'ios' : null
  return {
    mode,
    install: async () => { if (!deferred) return; await deferred.prompt(); deferred = null; force((n) => n + 1) },
    dismiss: () => { try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ } setHidden(true) },
  }
}
