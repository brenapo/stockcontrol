import { useState } from 'react'
import { api } from '../api'
import { toCents } from '../format'
import { useSplit } from '../split'
import type { Order, Pay } from '../types'
import { Icon } from './Icon'
import { Money } from './OrderBits'
import { Segmented, useToast } from './ui'

// Driver's money tiles with an Edit button: collected, cash/zelle, you keep, pass to owner
export function SplitEditor({ o, onSaved }: { o: Order; onSaved: () => void }) {
  const { toast, fail } = useToast()
  const [open, setOpen] = useState(false)
  const { amount, cut, owed, setAmount, setCut, setOwed, load } = useSplit()
  const [pay, setPay] = useState<Pay | null>(null)
  const [busy, setBusy] = useState(false)

  const start = () => {
    load(o); setPay(o.paymentMethod); setOpen(true)
  }

  const save = async () => {
    setBusy(true)
    try {
      await api(`/orders/${o.id}/split`, { body: { amountCents: toCents(amount), paymentMethod: pay, driverCutCents: toCents(cut), ownerOwedCents: toCents(owed) } })
      toast('Saved'); setOpen(false); onSaved()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <Money o={o} />
        <button className="btn btn-ghost btn-sm w-full" onClick={start}><Icon name="edit" size={20} />{o.driverCutCents == null ? 'Set what you keep' : 'Edit amounts'}</button>
      </div>
    )
  }
  const field = (id: string, label: string, v: string, set: (s: string) => void) => (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="relative">
        <span className="absolute left-4 top-[13px] text-lg font-black text-mute">$</span>
        <input id={id} className="field !pl-9" inputMode="decimal" placeholder="0.00" value={v} onChange={(e) => set(e.target.value)} />
      </div>
    </div>
  )
  return (
    <div className="space-y-3 rounded-3xl bg-sun-soft p-3">
      {field(`amt-${o.id}`, 'Collected', amount, setAmount)}
      <Segmented<Pay> value={pay} onChange={setPay} options={[{ value: 'cash', label: 'Cash', icon: 'cash' }, { value: 'zelle', label: 'Zelle', icon: 'bank' }]} />
      <div className="grid grid-cols-2 gap-2">
        {field(`cut-${o.id}`, 'You keep', cut, setCut)}
        {field(`owed-${o.id}`, 'Pass to owner', owed, setOwed)}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button className="btn btn-pink" disabled={busy} onClick={save}><Icon name="check" />Save</button>
        <button className="btn btn-ghost !w-14 !px-0" onClick={() => setOpen(false)} aria-label="Cancel"><Icon name="x" /></button>
      </div>
    </div>
  )
}
