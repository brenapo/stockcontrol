import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'
import type { User } from './types'

type AuthState = { user: User | null | undefined; offline: boolean; login: (u: string, p: string) => Promise<void>; logout: () => Promise<void> }
const Ctx = createContext<AuthState>(null as never)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [offline, setOffline] = useState(false)

  const check = useCallback(async () => {
    try {
      const r = await api<{ user: User }>('/auth/me')
      setUser(r.user)
      setOffline(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setOffline(true)
      else { setUser(null); setOffline(false) }
    }
  }, [])

  useEffect(() => {
    check()
    const out = () => setUser(null)
    window.addEventListener('sr:unauth', out)
    window.addEventListener('online', check)
    return () => { window.removeEventListener('sr:unauth', out); window.removeEventListener('online', check) }
  }, [check])

  const login = async (username: string, password: string) => {
    const r = await api<{ user: User }>('/auth/login', { body: { username, password } })
    setUser(r.user)
  }
  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }) } catch { /* cookie is cleared server-side when online */ }
    setUser(null)
  }
  return <Ctx.Provider value={{ user, offline, login, logout }}>{children}</Ctx.Provider>
}
