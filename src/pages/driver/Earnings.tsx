import { useState } from 'react'
import { api } from '../../api'
import { Icon } from '../../components/Icon'
import { SplitEditor } from '../../components/SplitEditor'
import { Empty, Spinner, useToast } from '../../components/ui'
import { money, summary } from '../../format'
import type { Order, Totals } from '../../types'

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

export default function Earnings({ summary: s, open, onChange }: { summary?: Totals; open?: Order[]; onChange: () => void }) {
  const { toast, fail } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  if (!s || !open) return <Spinner />

  const owed = open.reduce((t, o) => t + (o.ownerOwedCents ?? 0), 0)
  const kept = open.reduce((t, o) => t + (o.driverCutCents ?? 0), 0)
  const unset = open.filter((o) => o.ownerOwedCents == null).length

  const clear = async (o?: Order) => {
    if (!o && !confirm(`Settled all ${open.length} with the owner? They will be cleared.`)) return
    setBusy(o?.id ?? 'all')
    try {
      await api(o ? `/orders/${o.id}/clear` : '/payouts/me/clear', { method: 'POST' })
      toast(o ? 'Cleared' : 'All cleared')
      onChange()
    } catch (e) { fail(e); onChange() } finally { setBusy(null) }
  }

  return (
    <div className="space-y-3">
      <section className="card space-y-3 !bg-grape-soft">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-black">To settle · {open.length}</h3>
          <Icon name="wallet" size={28} className="text-grape" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-card p-3"><div className="text-xs font-extrabold uppercase text-mute">You keep</div><div className="text-3xl font-black">{money(kept)}</div></div>
          <div className="rounded-2xl bg-card p-3"><div className="text-xs font-extrabold uppercase text-mute">Pass to owner</div><div className="text-3xl font-black">{money(owed)}</div></div>
        </div>
        {unset > 0 && <div className="text-sm font-bold text-mute">{unset} without your split yet</div>}
        {open.length > 0 && (
          <button className="btn btn-grape w-full" disabled={busy === 'all'} onClick={() => clear()}><Icon name="check" />Settled with owner · clear all</button>
        )}
      </section>

      {open.length === 0 && <Empty icon="wallet" text="All settled" />}
      {open.map((o) => (
        <article key={o.id} className="card space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-mute">#{o.code}</span>
            <span className="chip bg-sky-soft text-sky"><Icon name="clock" size={14} />{when(o.deliveredAt)}</span>
            {o.paymentMethod === 'pending' && <span className="chip bg-orange-soft text-orange">Payment pending</span>}
          </div>
          <div className="text-lg font-black leading-tight">{o.customerName || o.address || 'Delivery'}</div>
          {summary(o) && <div className="text-base text-mute">{summary(o)}</div>}
          <SplitEditor o={o} onSaved={onChange} />
          <button className="btn btn-ghost btn-sm w-full" disabled={busy === o.id} onClick={() => clear(o)}><Icon name="check" size={20} />Settled · clear</button>
        </article>
      ))}

      <Block label="Today" kept={s.dayKept} owed={s.dayOwed} count={s.dayCount} />
      <Block label="This week" kept={s.weekKept} owed={s.weekOwed} count={s.weekCount} />
    </div>
  )
}

function Block({ label, kept, owed, count }: { label: string; kept: number; owed: number; count: number }) {
  return (
    <section className="card space-y-2">
      <div className="flex items-center justify-between"><h3 className="text-xl font-black">{label}</h3><span className="chip bg-sky-soft text-sky"><Icon name="check" size={14} />{count}</span></div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-mint-soft p-3"><div className="text-xs font-extrabold uppercase text-mute">You kept</div><div className="text-3xl font-black">{money(kept)}</div></div>
        <div className="rounded-2xl bg-sun-soft p-3"><div className="text-xs font-extrabold uppercase text-mute">Owed to owner</div><div className="text-3xl font-black">{money(owed)}</div></div>
      </div>
    </section>
  )
}
