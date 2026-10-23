import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './api'

/** Fetch now, then every `ms` while the tab is visible; refetch on focus / reconnect. */
export function usePoll<T>(load: () => Promise<T>, ms = 5000, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>()
  const [error, setError] = useState<ApiError | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load
  const alive = useRef(true)

  const reload = useCallback(async () => {
    try {
      const d = await loadRef.current()
      if (alive.current) { setData(d); setError(null) }
    } catch (e) {
      if (alive.current) setError(e instanceof ApiError ? e : new ApiError(0, 'No connection'))
    }
  }, [])

  useEffect(() => {
    alive.current = true
    reload()
    const tick = () => { if (document.visibilityState === 'visible') reload() }
    const id = setInterval(tick, ms)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    window.addEventListener('online', tick)
    return () => {
      alive.current = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
      window.removeEventListener('online', tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, reload, ...deps])

  return { data, error, reload }
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}
