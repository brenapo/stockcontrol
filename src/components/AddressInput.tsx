import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useDebounced } from '../hooks'
import { Icon } from './Icon'

// Address field with suggestions while typing. Typing freely always works; picking a suggestion just fills the text.
export function AddressInput({ value, onChange, withIcon = false }: { value: string; onChange: (v: string) => void; withIcon?: boolean }) {
  const [list, setList] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const picked = useRef('')
  const q = useDebounced(value, 300)

  useEffect(() => {
    if (!open || q.trim().length < 3 || q === picked.current) return setList([])
    let live = true
    api<{ suggestions: string[] }>(`/places?q=${encodeURIComponent(q)}`)
      .then((r) => { if (live) setList(r.suggestions) })
      .catch(() => { if (live) setList([]) })
    return () => { live = false }
  }, [q, open])

  const pick = (s: string) => {
    picked.current = s
    onChange(s)
    setList([])
  }

  return (
    <div className="relative">
      {withIcon && <Icon name="pin" className="pointer-events-none absolute left-4 top-[16px] text-mute" />}
      <input
        className={`field ${withIcon ? '!pl-12' : ''}`}
        placeholder="Address"
        autoComplete="street-address"
        value={value}
        maxLength={300}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-autocomplete="list"
      />
      {open && list.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-2xl bg-card shadow-card ring-2 ring-line">
          {list.map((s) => (
            <li key={s}>
              <button type="button" className="flex w-full items-start gap-2 px-4 py-3 text-left text-base font-bold hover:bg-pink-soft" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                <Icon name="pin" size={18} className="mt-0.5 shrink-0 text-pink" />{s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
