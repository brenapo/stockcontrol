import { api } from '../../api'
import { Icon } from '../../components/Icon'
import { Empty, Spinner, useToast } from '../../components/ui'
import { money } from '../../format'
import { usePoll } from '../../hooks'
import type { DriverTotals } from '../../types'

export default function Payouts() {
  const { toast, fail } = useToast()
  const { data, reload } = usePoll(() => api<{ drivers: DriverTotals[] }>('/payouts'), 10_000)

  const settle = async (d: DriverTotals) => {
    if (!confirm(`Mark ${money(d.openOwed)} from ${d.driverName} as settled?`)) return
    try { await api('/payouts/settle', { body: { driverId: d.driverId } }); toast('Settled'); reload() } catch (e) { fail(e) }
  }

  if (!data) return <Spinner />
  if (!data.drivers.length) return <Empty icon="wallet" text="No payouts yet" />

  return (
    <div className="space-y-3">
      {data.drivers.map((d) => (
        <section key={d.driverId} className="card space-y-3">
          <h3 className="flex items-center gap-2 text-2xl font-black"><Icon name="user" className="text-pink" />{d.driverName}</h3>
          <Period label="Today" kept={d.dayKept} owed={d.dayOwed} count={d.dayCount} />
          <Period label="This week" kept={d.weekKept} owed={d.weekOwed} count={d.weekCount} />
          <div className="flex items-center justify-between rounded-2xl bg-grape-soft p-3">
            <div>
              <div className="text-xs font-extrabold uppercase text-mute">Not settled · {d.openCount}</div>
              <div className="text-3xl font-black">{money(d.openOwed)}</div>
            </div>
            <button className="btn btn-grape" disabled={!d.openCount} onClick={() => settle(d)}><Icon name="check" />Settled</button>
          </div>
        </section>
      ))}
    </div>
  )
}

function Period({ label, kept, owed, count }: { label: string; kept: number; owed: number; count: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm font-extrabold uppercase text-mute"><span>{label}</span><span>{count} delivered</span></div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-mint-soft p-3"><div className="text-xs font-extrabold uppercase text-mute">Kept</div><div className="text-2xl font-black">{money(kept)}</div></div>
        <div className="rounded-2xl bg-sun-soft p-3"><div className="text-xs font-extrabold uppercase text-mute">Owes owner</div><div className="text-2xl font-black">{money(owed)}</div></div>
      </div>
    </div>
  )
}
