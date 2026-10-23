import { Icon } from '../../components/Icon'
import { Spinner } from '../../components/ui'
import { money } from '../../format'
import type { Totals } from '../../types'

export default function Earnings({ summary: s }: { summary?: Totals }) {
  if (!s) return <Spinner />
  return (
    <div className="space-y-3">
      <Block label="Today" kept={s.dayKept} owed={s.dayOwed} count={s.dayCount} />
      <Block label="This week" kept={s.weekKept} owed={s.weekOwed} count={s.weekCount} />
      <div className="card flex items-center justify-between !bg-grape-soft">
        <div>
          <div className="text-xs font-extrabold uppercase text-mute">Not settled · {s.openCount}</div>
          <div className="text-3xl font-black">{money(s.openOwed)}</div>
        </div>
        <Icon name="wallet" size={36} className="text-grape" />
      </div>
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
