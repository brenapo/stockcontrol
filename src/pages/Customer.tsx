import { useEffect, useMemo, useState } from 'react'
import { AddressInput } from '../components/AddressInput'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { UpdateBanner } from '../components/PwaBanners'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { Logo, Sheet, Spinner, useToast } from '../components/ui'
import { money, stepDown, stepUp } from '../format'
import type { MenuItem } from '../types'

type Details = { name: string; phone: string; address: string; notes: string }
type Saved = { cart: Record<number, number>; sweets?: Record<number, string>; details: Details }
const LAST_KEY = 'sr:last-order'

function loadLast(): Saved | null {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') } catch { return null }
}

export default function Customer() {
  const { user } = useAuth()
  const { fail } = useToast()
  const [menu, setMenu] = useState<MenuItem[] | null>(null)
  const [cart, setCart] = useState<Record<number, number>>({})
  const [which, setWhich] = useState<Record<number, string>>({}) // "Other": which sweet
  const [details, setDetails] = useState<Details>(() => loadLast()?.details ?? { name: '', phone: '', address: '', notes: '' })
  const [token, setToken] = useState('')
  const [tokenAt, setTokenAt] = useState(0)
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<number | null>(null)
  const [honey, setHoney] = useState('')
  const [last, setLast] = useState(loadLast)

  useEffect(() => {
    api<{ items: MenuItem[] }>('/menu').then((r) => setMenu(r.items)).catch(fail)
    api<{ token: string }>('/public/token').then((r) => { setToken(r.token); setTokenAt(Date.now()) }).catch(() => {})
  }, [fail])

  const count = useMemo(() => Object.values(cart).reduce((a, b) => a + b, 0), [cart])
  const total = useMemo(() => (menu ?? []).reduce((s, m) => s + Math.round((cart[m.id] ?? 0) * m.priceCents), 0), [menu, cart])
  const set = (id: number, d: number) =>
    setCart((c) => {
      const cur = c[id] ?? 0
      const n = d > 0 ? stepUp(cur) : stepDown(cur)
      const { [id]: _, ...rest } = c
      return n ? { ...rest, [id]: n } : rest
    })

  const repeat = () => {
    if (!last || !menu) return
    const ids = new Set(menu.map((m) => m.id))
    setCart(Object.fromEntries(Object.entries(last.cart).filter(([id]) => ids.has(Number(id)))) as Record<number, number>)
    setWhich(last.sweets ?? {})
    setDetails(last.details)
    setOpen(true)
  }

  const submit = async () => {
    setSending(true)
    try {
      // the token must be a few seconds old (anti-bot), so reuse the one fetched on page load;
      // refresh it only when missing or about to expire
      let tk = token
      if (!tk || Date.now() - tokenAt > 3 * 3600 * 1000) {
        tk = (await api<{ token: string }>('/public/token')).token
        setToken(tk); setTokenAt(Date.now())
        await new Promise((r) => setTimeout(r, 3000))
      }
      const r = await api<{ code: number }>('/public/order', {
        body: {
          token: tk, website: honey,
          customerName: details.name, phone: details.phone, address: details.address, notes: details.notes,
          items: Object.entries(cart).map(([id, qty]) => ({ id: Number(id), qty, note: which[Number(id)] || null })),
        },
      })
      const snapshot: Saved = { cart, sweets: which, details }
      try { localStorage.setItem(LAST_KEY, JSON.stringify(snapshot)) } catch { /* private mode */ }
      setLast(snapshot)
      setDone(r.code)
      setCart({})
      setWhich({})
      setOpen(false)
    } catch (e) {
      fail(e)
    } finally {
      setSending(false)
    }
  }

  if (done !== null) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 p-6 text-center">
        <div className="grid h-28 w-28 place-items-center rounded-full bg-mint-soft text-mint-dark"><Icon name="check" size={64} /></div>
        <h1 className="text-4xl font-black">Order sent!</h1>
        {done > 0 && <div className="chip bg-pink-soft text-xl text-pink-dark">#{done}</div>}
        <button className="btn btn-pink w-full" onClick={() => setDone(null)}><Icon name="plus" />New order</button>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl pb-36">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-surface/90 px-4 pb-3 backdrop-blur" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}>
        <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Top"><Logo /></button>
        <div className="flex items-center gap-2">
          {last && menu && (
            <button className="btn btn-sm btn-ghost" onClick={repeat}><Icon name="repeat" size={20} />Again</button>
          )}
          {user && <Link to="/app" className="btn btn-sm btn-pink"><Icon name="box" size={20} />App</Link>}
        </div>
      </header>
      <UpdateBanner />

      {!menu ? <Spinner /> : (
        <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3">
          {menu.map((m) => {
            const q = cart[m.id] ?? 0
            return (
              <div key={m.id} className={`card flex flex-col gap-2 !p-2 transition ${q ? 'ring-4 ring-pink' : ''}`}>
                <button className="relative block" onClick={() => set(m.id, 1)} aria-label={`Add ${m.name}`}>
                  <img src={m.imageUrl} alt="" loading="lazy" className="aspect-square w-full rounded-2xl object-cover" />
                  {q > 0 && <span className="absolute right-2 top-2 grid h-9 min-w-9 place-items-center rounded-full bg-pink px-2 text-lg font-black text-white shadow-pop">{q}</span>}
                </button>
                <div className="flex items-baseline justify-between px-1">
                  <span className="truncate text-lg font-black">{m.name}</span>
                  <span className="font-extrabold text-pink-dark">{money(m.priceCents)}</span>
                </div>
                {q === 0 ? (
                  <button className="btn btn-pink btn-sm w-full" onClick={() => set(m.id, 1)}><Icon name="plus" />Add</button>
                ) : (
                  <div className="grid grid-cols-[56px_1fr_56px] items-center">
                    <button className="btn btn-ghost btn-sm !px-0" onClick={() => set(m.id, -1)} aria-label="Less"><Icon name="minus" /></button>
                    <span className="text-center text-2xl font-black">{q}</span>
                    <button className="btn btn-pink btn-sm !px-0" onClick={() => set(m.id, 1)} aria-label="More"><Icon name="plus" /></button>
                  </div>
                )}
                {q > 0 && m.allowNote && (
                  <input className="field !min-h-[46px] !rounded-xl !text-base" placeholder="Which sweet?" maxLength={40} value={which[m.id] ?? ''} onChange={(e) => setWhich({ ...which, [m.id]: e.target.value })} aria-label="Which sweet?" />
                )}
              </div>
            )
          })}
        </div>
      )}

      <footer className="mt-8 text-center">
        <Link to="/app" className="inline-flex items-center gap-1 text-sm font-bold text-mute"><Icon name="lock" size={14} />Staff</Link>
      </footer>

      {count > 0 && !open && (
        <div className="fixed inset-x-0 bottom-0 z-30 p-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <button className="btn btn-pink mx-auto flex w-full max-w-xl justify-between !px-6" onClick={() => setOpen(true)}>
            <span className="flex items-center gap-2"><Icon name="cart" />{count}</span>
            <span>Order</span>
            <span>{money(total)}</span>
          </button>
        </div>
      )}

      {open && (
        <Sheet title="Your order" onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <div className="space-y-1">
              {(menu ?? []).filter((m) => cart[m.id]).map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-2xl border-2 border-line bg-card p-2">
                  <img src={m.imageUrl} alt="" className="h-12 w-12 rounded-xl object-cover" />
                  {m.allowNote ? (
                    <input className="field !min-h-[44px] min-w-0 flex-1 !rounded-xl !px-3 !text-base" placeholder={`${m.name}: which sweet?`} maxLength={40} value={which[m.id] ?? ''} onChange={(e) => setWhich({ ...which, [m.id]: e.target.value })} aria-label="Which sweet?" />
                  ) : (
                    <span className="flex-1 truncate font-extrabold">{m.name}</span>
                  )}
                  <button className="btn btn-ghost btn-sm !w-11 !px-0" onClick={() => set(m.id, -1)} aria-label="Less"><Icon name="minus" size={18} /></button>
                  <span className="w-10 text-center text-xl font-black">{cart[m.id]}</span>
                  <button className="btn btn-pink btn-sm !w-11 !px-0" onClick={() => set(m.id, 1)} aria-label="More"><Icon name="plus" size={18} /></button>
                </div>
              ))}
            </div>

            <input className="field" placeholder="Name" autoComplete="name" value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} maxLength={120} />
            <input className="field" placeholder="Phone" type="tel" autoComplete="tel" inputMode="tel" value={details.phone} onChange={(e) => setDetails({ ...details, phone: e.target.value })} maxLength={40} />
            <AddressInput value={details.address} onChange={(v) => setDetails({ ...details, address: v })} />
            <textarea className="field !min-h-[84px] py-3" placeholder="Notes" value={details.notes} onChange={(e) => setDetails({ ...details, notes: e.target.value })} maxLength={500} />
            {/* honeypot: invisible to people, bots fill it */}
            <input tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={honey} onChange={(e) => setHoney(e.target.value)} className="absolute -left-[9999px] h-0 w-0 opacity-0" />

            <button className="btn btn-pink w-full" disabled={sending || !count} onClick={submit}>
              {sending ? 'Sending…' : <><Icon name="check" />Send · {money(total)}</>}
            </button>
          </div>
        </Sheet>
      )}
    </main>
  )
}
