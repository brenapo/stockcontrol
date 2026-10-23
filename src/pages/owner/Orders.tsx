import { useState } from 'react'
import { api } from '../../api'
import { Icon } from '../../components/Icon'
import { OrderForm } from '../../components/OrderForm'
import { ContactButtons, MapsButton, Money, OrderBody } from '../../components/OrderBits'
import { Empty, Sheet, Spinner, useToast } from '../../components/ui'
import { usePoll, useDebounced } from '../../hooks'
import type { MenuItem, Order } from '../../types'

const FILTERS = [
  { id: 'all', label: 'All' }, { id: 'new', label: 'New' }, { id: 'taken', label: 'Taken' },
  { id: 'delivered', label: 'Delivered' }, { id: 'archived', label: 'Archived' },
] as const

export default function Orders({ menu }: { menu: MenuItem[] }) {
  const { toast, fail } = useToast()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all')
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 300)
  const [editing, setEditing] = useState<Order | null>(null)
  const { data, error, reload } = usePoll(
    () => api<{ orders: Order[] }>(`/orders?q=${encodeURIComponent(q)}${filter === 'archived' ? '&archived=1' : ''}`),
    5000,
    [q, filter],
  )

  const orders = (data?.orders ?? []).filter((o) => filter === 'all' || filter === 'archived' || o.status === filter)

  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    try { await fn(); if (msg) toast(msg); reload() } catch (e) { fail(e) }
  }
  const remove = (o: Order) => { if (confirm(`Delete order #${o.code}?`)) act(() => api(`/orders/${o.id}`, { method: 'DELETE' }), 'Deleted') }
  const archiveOld = () => { if (confirm('Archive delivered orders older than 30 days?')) act(async () => { const r = await api<{ archived: number }>('/orders/archive-old', { body: { days: 30 } }); toast(`${r.archived} archived`) }) }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-4 top-[16px] text-mute" />
        <input className="field !pl-12" type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} className={`btn btn-sm shrink-0 ${filter === f.id ? 'bg-pink text-white' : 'btn-ghost'}`}>{f.label}</button>
        ))}
        <button onClick={archiveOld} className="btn btn-sm btn-ghost shrink-0" aria-label="Archive old"><Icon name="archive" size={20} />30d+</button>
      </div>

      {!data && !error && <Spinner />}
      {error && !data && <Empty icon="signal" text="No connection" />}
      {data && orders.length === 0 && <Empty icon="box" text="No orders" />}

      {orders.map((o) => (
        <article key={o.id} className="card space-y-3">
          <OrderBody o={o} />
          <Money o={o} />
          <ContactButtons phone={o.phone} />
          <div className="grid grid-cols-4 gap-2">
            <MapsButton address={o.address} />
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(o)} aria-label="Edit"><Icon name="edit" size={20} /></button>
            <button className="btn btn-sm btn-ghost" onClick={() => act(() => api(`/orders/${o.id}/archive`, { body: { archived: !o.archivedAt } }))} aria-label="Archive"><Icon name="archive" size={20} /></button>
            <button className="btn btn-sm btn-ghost text-red-600" onClick={() => remove(o)} aria-label="Delete"><Icon name="trash" size={20} /></button>
          </div>
          {o.status === 'delivered' && o.driverId && (
            <button className={`btn btn-sm w-full ${o.settledAt ? 'bg-mint-soft text-mint-dark dark:text-mint' : 'btn-grape'}`} onClick={() => act(() => api(`/orders/${o.id}/settle`, { body: { settled: !o.settledAt } }))}>
              <Icon name="check" size={20} />{o.settledAt ? 'Settled' : 'Mark settled'}
            </button>
          )}
        </article>
      ))}

      {editing && (
        <Sheet title={`Order #${editing.code}`} onClose={() => setEditing(null)}>
          <OrderForm initial={editing} menu={menu} onSaved={() => { setEditing(null); reload() }} />
        </Sheet>
      )}
    </div>
  )
}
