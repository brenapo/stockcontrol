import { useState } from 'react'
import { api } from '../../api'
import { Icon } from '../../components/Icon'
import { ContactButtons, MapsButton, Money, OrderBody } from '../../components/OrderBits'
import { Empty, Spinner, useToast } from '../../components/ui'
import type { Order } from '../../types'

export default function Open({ orders, offline, onChange, onTaken }: { orders?: Order[]; offline: boolean; onChange: () => void; onTaken: () => void }) {
  const { toast, fail } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const take = async (o: Order) => {
    setBusy(o.id)
    try { await api(`/orders/${o.id}/take`, { method: 'POST' }); toast("It's yours!"); onChange(); onTaken() } catch (e) { fail(e); onChange() } finally { setBusy(null) }
  }

  if (offline) return <Empty icon="signal" text="No connection" />
  if (!orders) return <Spinner />
  if (!orders.length) return <Empty icon="candy" text="No open deliveries" />

  return (
    <div className="space-y-3">
      {orders.map((o) => (
        <article key={o.id} className="card space-y-3">
          <OrderBody o={o} />
          <Money o={o} />
          <div className="grid grid-cols-[1fr_auto] gap-2"><ContactButtons phone={o.phone} /><MapsButton address={o.address} /></div>
          <button className="btn btn-pink w-full" disabled={busy === o.id} onClick={() => take(o)}><Icon name="check" />{busy === o.id ? '…' : "I'll take it"}</button>
        </article>
      ))}
    </div>
  )
}
