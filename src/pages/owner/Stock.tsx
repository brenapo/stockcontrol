import { useState } from 'react'
import { api } from '../../api'
import { Icon } from '../../components/Icon'
import StockHistory from '../../components/StockHistory'
import StockList from '../../components/StockList'
import { Empty, Sheet, Spinner, useToast } from '../../components/ui'
import { usePoll } from '../../hooks'
import type { LogEntry, OwnerStock } from '../../types'

const VIEWS = [
  { id: 'overview', label: 'Overview', icon: 'layers' },
  { id: 'store', label: 'Store', icon: 'box' },
  { id: 'drivers', label: 'Drivers', icon: 'users' },
  { id: 'history', label: 'History', icon: 'clock' },
] as const

export default function Stock({ data, reload }: { data?: OwnerStock; reload: () => void }) {
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('overview')
  if (!data) return <Spinner />
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1.5">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)} className={`btn btn-sm !min-h-[52px] flex-col !gap-0 !px-1 !text-xs ${view === v.id ? 'bg-pink text-white' : 'btn-ghost'}`}>
            <Icon name={v.icon} size={20} />{v.label}
          </button>
        ))}
      </div>
      {view === 'overview' && <Overview data={data} reload={reload} />}
      {view === 'store' && <Store data={data} reload={reload} />}
      {view === 'drivers' && <Drivers data={data} reload={reload} />}
      {view === 'history' && <History data={data} />}
    </div>
  )
}

function Overview({ data, reload }: { data: OwnerStock; reload: () => void }) {
  const { fail } = useToast()
  const setThreshold = async (n: number) => {
    if (n < 0) return
    try { await api('/stock/settings', { method: 'PUT', body: { lowThreshold: n } }); reload() } catch (e) { fail(e) }
  }
  return (
    <div className="space-y-3">
      {data.low.length > 0 && (
        <div className="rounded-3xl border-2 border-orange bg-orange-soft p-3">
          <div className="mb-1 flex items-center gap-2 text-lg font-black"><Icon name="bell" className="text-orange" />Low stock</div>
          <div className="flex flex-wrap gap-2">
            {data.low.map((l) => <span key={l.sku} className="chip bg-card text-base">{l.name} · {l.store}</span>)}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between rounded-2xl border-2 border-line bg-card p-2 pl-4">
        <span className="font-extrabold text-mute">Alert at ≤</span>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost btn-sm !w-11 !px-0" onClick={() => setThreshold(data.threshold - 1)} aria-label="Lower"><Icon name="minus" size={20} /></button>
          <span className="w-10 text-center text-2xl font-black">{data.threshold}</span>
          <button className="btn btn-ghost btn-sm !w-11 !px-0" onClick={() => setThreshold(data.threshold + 1)} aria-label="Raise"><Icon name="plus" size={20} /></button>
        </div>
      </div>

      {data.items.map((it) => (
        <div key={it.sku} className="card !p-3">
          <div className="flex items-center gap-3">
            <img src={it.imageUrl} alt="" className="h-14 w-14 rounded-2xl object-cover" />
            <div className="min-w-0 flex-1 text-xl font-black leading-tight">{it.name}</div>
            <div className="text-right">
              <div className={`text-3xl font-black ${it.total < 0 ? 'text-red-600' : ''}`}>{it.total}</div>
              <div className="text-xs font-extrabold uppercase text-mute">Total</div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className={`chip text-base ${it.low ? 'bg-orange-soft text-orange' : 'bg-sun-soft'}`}><Icon name="box" size={16} />Store {it.store}</span>
            {data.drivers.map((d) => {
              const q = it.byDriver[d.id] ?? 0
              return <span key={d.id} className={`chip text-base ${q < 0 ? 'bg-red-100 text-red-600' : 'bg-sky-soft text-sky'}`}><Icon name="user" size={16} />{d.name} {q}</span>
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function Store({ data, reload }: { data: OwnerStock; reload: () => void }) {
  const [moving, setMoving] = useState(false)
  const rows = data.items.map((i) => ({ ...i, qty: i.store }))
  return (
    <div className="space-y-3">
      <button className="btn btn-pink w-full" disabled={!data.drivers.length} onClick={() => setMoving(true)}><Icon name="swap" />Give / take back</button>
      <StockList holder="store" rows={rows} otherItemId={data.otherItemId} onChanged={reload} />
      {moving && <Transfer data={data} onClose={() => setMoving(false)} onDone={() => { setMoving(false); reload() }} />}
    </div>
  )
}

function Drivers({ data, reload }: { data: OwnerStock; reload: () => void }) {
  if (!data.drivers.length) return <Empty icon="users" text="No drivers yet" />
  return (
    <div className="space-y-4">
      {data.drivers.map((d) => (
        <section key={d.id} className="space-y-2">
          <h3 className="flex items-center gap-2 text-xl font-black"><Icon name="user" className="text-pink" />{d.name}</h3>
          <StockList holder={d.id} rows={data.items.map((i) => ({ ...i, qty: i.byDriver[d.id] ?? 0, low: false }))} otherItemId={data.otherItemId} onChanged={reload} />
        </section>
      ))}
    </div>
  )
}

function Transfer({ data, onClose, onDone }: { data: OwnerStock; onClose: () => void; onDone: () => void }) {
  const { toast, fail } = useToast()
  const [mode, setMode] = useState<'give' | 'back'>('give')
  const [driver, setDriver] = useState(data.drivers[0]?.id ?? '')
  const [qty, setQty] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const avail = (sku: string) => {
    const it = data.items.find((i) => i.sku === sku)!
    return mode === 'give' ? it.store : (it.byDriver[driver] ?? 0)
  }
  const bump = (sku: string, d: number) => setQty((q) => ({ ...q, [sku]: Math.max(0, Math.min(avail(sku), (q[sku] ?? 0) + d)) }))
  const picked = data.items.filter((i) => (qty[i.sku] ?? 0) > 0)

  const submit = async () => {
    setBusy(true)
    try {
      await api('/stock/transfer', {
        body: {
          from: mode === 'give' ? 'store' : driver, to: mode === 'give' ? driver : 'store',
          items: picked.map((i) => ({ itemId: i.itemId, name: i.custom ? i.name : undefined, qty: qty[i.sku] })),
        },
      })
      toast(mode === 'give' ? 'Given' : 'Taken back')
      onDone()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  return (
    <Sheet title={mode === 'give' ? 'Give to driver' : 'Take back'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button className={`btn btn-sm !min-h-[50px] ${mode === 'give' ? 'bg-pink text-white' : 'btn-ghost'}`} onClick={() => { setMode('give'); setQty({}) }}>Store → Driver</button>
          <button className={`btn btn-sm !min-h-[50px] ${mode === 'back' ? 'bg-pink text-white' : 'btn-ghost'}`} onClick={() => { setMode('back'); setQty({}) }}>Driver → Store</button>
        </div>
        <select className="field" value={driver} onChange={(e) => { setDriver(e.target.value); setQty({}) }} aria-label="Driver">
          {data.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {data.items.map((it) => {
          const max = avail(it.sku)
          const q = qty[it.sku] ?? 0
          return (
            <div key={it.sku} className={`flex items-center gap-2 rounded-2xl border-2 bg-card p-2 ${q ? 'border-pink' : 'border-line'} ${max <= 0 ? 'opacity-40' : ''}`}>
              <img src={it.imageUrl} alt="" className="h-11 w-11 rounded-xl object-cover" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-black">{it.name}</div>
                <div className="text-sm font-bold text-mute">{max} available</div>
              </div>
              <button className="btn btn-ghost btn-sm !w-11 !px-0" disabled={q <= 0} onClick={() => bump(it.sku, -1)} aria-label="Less"><Icon name="minus" size={18} /></button>
              <span className="w-8 text-center text-xl font-black">{q}</span>
              <button className="btn btn-pink btn-sm !w-11 !px-0" disabled={q >= max} onClick={() => bump(it.sku, 1)} aria-label="More"><Icon name="plus" size={18} /></button>
            </div>
          )
        })}
        <button className="btn btn-pink w-full" disabled={busy || !picked.length || !driver} onClick={submit}>
          <Icon name="check" />{busy ? '…' : mode === 'give' ? 'Give' : 'Take back'}{picked.length ? ` · ${picked.reduce((s, i) => s + qty[i.sku], 0)}` : ''}
        </button>
      </div>
    </Sheet>
  )
}

function History({ data }: { data: OwnerStock }) {
  const [holder, setHolder] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const q = new URLSearchParams()
  if (holder) q.set('holder', holder)
  if (from) q.set('from', from)
  if (to) q.set('to', to)
  const { data: res } = usePoll(() => api<{ log: LogEntry[] }>(`/stock/log?${q}`), 15_000, [holder, from, to])
  return (
    <div className="space-y-3">
      <select className="field" value={holder} onChange={(e) => setHolder(e.target.value)} aria-label="Filter by place">
        <option value="">Everyone</option>
        <option value="store">Store</option>
        {data.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <input className="field" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <input className="field" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To" />
      </div>
      {!res ? <Spinner /> : <StockHistory log={res.log} />}
    </div>
  )
}
