import { useEffect, useState } from 'react'
import { api } from '../../api'
import { appleRouteUrl, googleRouteUrl, MAX_STOPS } from '../../contact'
import { Icon } from '../../components/Icon'
import { ContactButtons, MapsButton, Money, OrderBody } from '../../components/OrderBits'
import { Empty, Spinner, useToast } from '../../components/ui'
import type { Order } from '../../types'

export default function Mine({ orders, done, onChange }: { orders?: Order[]; done: Order[]; onChange: () => void }) {
  const { toast, fail } = useToast()
  const [sel, setSel] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  // drop selections for orders that are no longer in the list
  useEffect(() => { if (orders) setSel((s) => s.filter((id) => orders.some((o) => o.id === id))) }, [orders])

  const act = async (o: Order, path: 'deliver' | 'release', msg: string) => {
    if (path === 'release' && !confirm('Give this delivery back?')) return
    setBusy(o.id)
    try { await api(`/orders/${o.id}/${path}`, { method: 'POST' }); toast(msg); onChange() } catch (e) { fail(e); onChange() } finally { setBusy(null) }
  }
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  if (!orders) return <Spinner />
  const addresses = sel.map((id) => orders.find((o) => o.id === id)?.address).filter((a): a is string => !!a)

  return (
    <div className="space-y-3 pb-24">
      {orders.length === 0 && <Empty icon="route" text="Nothing taken yet" />}
      {orders.map((o) => (
        <article key={o.id} className={`card space-y-3 ${sel.includes(o.id) ? 'ring-4 ring-sky' : ''}`}>
          <div className="flex items-start gap-3">
            <button
              onClick={() => toggle(o.id)}
              disabled={!o.address}
              className={`mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl border-2 ${sel.includes(o.id) ? 'border-sky bg-sky text-white' : 'border-line'} disabled:opacity-30`}
              aria-label="Add to route" aria-pressed={sel.includes(o.id)}
            >
              {sel.includes(o.id) && <Icon name="check" size={20} />}
            </button>
            <div className="min-w-0 flex-1"><OrderBody o={o} /></div>
          </div>
          <Money o={o} />
          <div className="grid grid-cols-[1fr_auto] gap-2"><ContactButtons phone={o.phone} /><MapsButton address={o.address} /></div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button className="btn btn-mint" disabled={busy === o.id} onClick={() => act(o, 'deliver', 'Delivered!')}><Icon name="check" />Delivered</button>
            <button className="btn btn-ghost btn-sm !min-h-[54px]" disabled={busy === o.id} onClick={() => act(o, 'release', 'Released')} aria-label="Give back"><Icon name="x" /></button>
          </div>
        </article>
      ))}

      {done.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-lg font-extrabold">Delivered · {done.length}</summary>
          <ul className="mt-2 divide-y divide-line">
            {done.map((o) => (
              <li key={o.id} className="py-2 text-base"><span className="font-black text-mute">#{o.code}</span> {o.customerName || o.address || '—'}</li>
            ))}
          </ul>
        </details>
      )}

      {sel.length > 0 && (
        <div className="fixed inset-x-0 z-20 p-3" style={{ bottom: 'calc(64px + env(safe-area-inset-bottom))' }}>
          <div className="mx-auto max-w-2xl space-y-1 rounded-3xl bg-card p-3 shadow-card ring-2 ring-line">
            <div className="flex items-center justify-between px-1 font-extrabold">
              <span className="flex items-center gap-1.5"><Icon name="route" size={20} />Start route · {sel.length}</span>
              <button className="text-mute underline" onClick={() => setSel([])}>Clear</button>
            </div>
            {addresses.length > MAX_STOPS && <div className="px-1 text-sm font-bold text-red-600">Max {MAX_STOPS} stops</div>}
            <div className="grid grid-cols-2 gap-2">
              <a className="btn btn-sky" href={googleRouteUrl(addresses)} target="_blank" rel="noopener noreferrer"><Icon name="pin" size={20} />Google</a>
              <a className="btn btn-ghost" href={appleRouteUrl(addresses)} target="_blank" rel="noopener noreferrer"><Icon name="pin" size={20} />Apple</a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
