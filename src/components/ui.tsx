import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { ApiError } from '../api'
import { Icon } from './Icon'

// ---------- toast ----------
type Toast = { id: number; text: string; kind: 'ok' | 'err' }
const ToastCtx = createContext<{ toast: (text: string, kind?: 'ok' | 'err') => void; fail: (e: unknown) => void }>({ toast() {}, fail() {} })
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const toast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((l) => [...l, { id, text, kind }])
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 3500)
  }, [])
  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'Something went wrong', 'err'), [toast])
  return (
    <ToastCtx.Provider value={{ toast, fail }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4" style={{ paddingTop: 'env(safe-area-inset-top)' }} role="status">
        {items.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-2xl px-4 py-3 text-base font-extrabold text-white shadow-lg ${t.kind === 'ok' ? 'bg-mint-dark' : 'bg-red-600'}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ---------- bottom sheet ----------
export function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-surface p-4 pb-8"
        style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-2xl font-black">{title}</h2>
          <button className="btn btn-ghost btn-sm !min-h-[44px] !w-11 !px-0" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------- misc ----------
export function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-mute">
      <Icon name={icon} size={44} />
      <p className="text-lg font-extrabold">{text}</p>
    </div>
  )
}

export function Spinner() {
  return <div className="mx-auto my-10 h-9 w-9 animate-spin rounded-full border-4 border-pink-soft border-t-pink" />
}

export function Logo({ size = 40, text = true }: { size?: number; text?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <img src="/logo.svg" width={size} height={size} alt="" className="rounded-xl" />
      {text && <span className="text-2xl font-black tracking-tight text-pink">Sugar Rush</span>}
    </span>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T | null; options: { value: T; label: string; icon?: string }[]; onChange: (v: T | null) => void }) {
  return (
    <div className="grid grid-flow-col gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(value === o.value ? null : o.value)}
          className={`btn btn-sm !min-h-[54px] ${value === o.value ? 'bg-pink text-white' : 'btn-ghost'}`}
          aria-pressed={value === o.value}
        >
          {o.icon && <Icon name={o.icon} size={20} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}
