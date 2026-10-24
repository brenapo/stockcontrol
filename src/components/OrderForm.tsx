import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { fromCents, money, toCents } from '../format'
import { useDebounced } from '../hooks'
import type { MenuItem, Order, Pay, Status, User } from '../types'
import { AddressInput } from './AddressInput'
import { Icon } from './Icon'
import { Segmented, useToast } from './ui'

type Customer = { name: string | null; phone: string | null; address: string | null; items: { id?: number; qty: number; note?: string }[]; itemsText: string | null }

// driver = a driver logging their own customer: no customer lookup, no payout split (the owner sets it later)
export function OrderForm({ initial, menu, onSaved, driver = false }: { initial?: Order; menu: MenuItem[]; onSaved: (o: Order) => void; driver?: boolean }) {
  const { toast, fail } = useToast()
  const edit = !!initial
  const [name, setName] = useState(initial?.customerName ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [itemsText, setItemsText] = useState(initial?.itemsText ?? '')
  const [qty, setQty] = useState<Record<number, number>>(() =>
    Object.fromEntries((initial?.items ?? []).filter((i) => i.id != null).map((i) => [i.id!, i.qty])),
  )
  const [which, setWhich] = useState<Record<number, string>>(() =>
    Object.fromEntries((initial?.items ?? []).filter((i) => i.id != null && i.note).map((i) => [i.id!, i.note!])),
  )
  const [amount, setAmount] = useState(fromCents(initial?.amountCents))
  const [pay, setPay] = useState<Pay | null>(initial?.paymentMethod ?? null)
  const [cut, setCut] = useState(fromCents(initial?.driverCutCents))
  const [owed, setOwed] = useState(fromCents(initial?.ownerOwedCents))
  const [owedTouched, setOwedTouched] = useState(edit && initial?.ownerOwedCents != null)
  const [status, setStatus] = useState<Status>(initial?.status ?? 'new')
  const [driverId, setDriverId] = useState<string>(initial?.driverId ?? '')
  const [drivers, setDrivers] = useState<User[]>([])
  const [showMenu, setShowMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<Customer[]>([])

  const menuTotal = useMemo(() => menu.reduce((s, m) => s + (qty[m.id] ?? 0) * m.priceCents, 0), [menu, qty])
  const picked = menu.filter((m) => qty[m.id])

  // owner owes = amount to collect − driver's cut, until the owner types their own number
  useEffect(() => {
    if (owedTouched) return
    const a = toCents(amount)
    setOwed(a == null ? '' : fromCents(a - (toCents(cut) ?? 0)))
  }, [amount, cut, owedTouched])

  useEffect(() => {
    if (edit) api<{ users: User[] }>('/users').then((r) => setDrivers(r.users.filter((u) => u.role === 'driver'))).catch(() => {})
  }, [edit])

  // find returning customers by name or phone
  const q = useDebounced(!edit && !driver ? (phone.replace(/\D/g, '').length >= 4 ? phone : name.trim().length >= 2 ? name : '') : '', 350)
  useEffect(() => {
    if (!q) return setFound([])
    api<{ customers: Customer[] }>(`/customers?q=${encodeURIComponent(q)}`).then((r) => setFound(r.customers)).catch(() => setFound([]))
  }, [q])

  const repeat = (c: Customer) => {
    setName(c.name ?? ''); setPhone(c.phone ?? ''); setAddress(c.address ?? ''); setItemsText(c.itemsText ?? '')
    const ids = new Set(menu.map((m) => m.id))
    setQty(Object.fromEntries(c.items.filter((i) => i.id != null && ids.has(i.id)).map((i) => [i.id!, i.qty])))
    setWhich(Object.fromEntries(c.items.filter((i) => i.id != null && i.note && ids.has(i.id)).map((i) => [i.id!, i.note!])))
    setFound([])
  }

  const bump = (id: number, d: number) =>
    setQty((c) => {
      const n = Math.max(0, Math.min(99, (c[id] ?? 0) + d))
      const { [id]: _, ...rest } = c
      return n ? { ...rest, [id]: n } : rest
    })

  const save = async () => {
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        customerName: name || null, phone: phone || null, address: address || null, notes: notes || null, itemsText: itemsText || null,
        amountCents: toCents(amount), paymentMethod: pay,
        ...(driver ? {} : { driverCutCents: toCents(cut), ownerOwedCents: toCents(owed) }),
      }
      const items = Object.entries(qty).map(([id, n]) => ({ id: Number(id), qty: n, note: which[Number(id)]?.trim() || null }))
      const key = (i: { id?: number; qty: number; note?: string | null }) => `${i.id}:${i.qty}:${i.note ?? ''}`
      const before = (initial?.items ?? []).filter((i) => i.id != null).map(key).sort().join()
      // when editing, leave the stored item snapshot alone unless the owner changed the picks
      if (!edit || items.map(key).sort().join() !== before) body.items = items
      if (edit) {
        body.status = status
        if (status !== 'new') body.driverId = driverId || null
        const r = await api<{ order: Order }>(`/orders/${initial!.id}`, { method: 'PATCH', body })
        toast('Saved')
        onSaved(r.order)
      } else {
        const r = await api<{ order: Order }>('/orders', { body })
        toast(driver ? 'Added to your deliveries' : 'Order created')
        onSaved(r.order)
        setName(''); setPhone(''); setAddress(''); setNotes(''); setItemsText(''); setQty({}); setWhich({}); setAmount(''); setPay(null); setCut(''); setOwed(''); setOwedTouched(false)
      }
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Icon name="user" className="pointer-events-none absolute left-4 top-[16px] text-mute" />
        <input className="field !pl-12" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" />
      </div>
      <div className="relative">
        <Icon name="phone" className="pointer-events-none absolute left-4 top-[16px] text-mute" />
        <input className="field !pl-12" placeholder="Phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} autoComplete="off" />
      </div>
      {found.length > 0 && (
        <div className="space-y-1">
          {found.map((c, i) => (
            <button key={i} type="button" onClick={() => repeat(c)} className="btn btn-sm btn-ghost w-full !justify-between text-left">
              <span className="truncate">{[c.name, c.phone].filter(Boolean).join(' · ') || 'Customer'}</span>
              <span className="flex shrink-0 items-center gap-1 text-pink"><Icon name="repeat" size={18} />Repeat</span>
            </button>
          ))}
        </div>
      )}
      <AddressInput value={address} onChange={setAddress} withIcon />

      <div className="space-y-2 rounded-3xl bg-card p-3">
        <div className="flex items-center justify-between">
          <span className="label !mb-0">Items</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowMenu((v) => !v)}><Icon name="candy" size={20} />{showMenu ? 'Hide menu' : 'Menu'}</button>
        </div>
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {picked.map((m) => (
              <span key={m.id} className="chip bg-pink-soft text-base text-pink-dark">{qty[m.id]}× {m.allowNote && which[m.id]?.trim() ? which[m.id] : m.name}</span>
            ))}
          </div>
        )}
        {showMenu && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {menu.map((m) => (
              <div key={m.id} className={`rounded-2xl border-2 p-1.5 ${qty[m.id] ? 'border-pink' : 'border-line'}`}>
                <button type="button" className="block w-full" onClick={() => bump(m.id, 1)} aria-label={`Add ${m.name}`}>
                  <img src={m.imageUrl} alt="" loading="lazy" className="aspect-square w-full rounded-xl object-cover" />
                  <div className="truncate text-sm font-extrabold">{m.name}</div>
                </button>
                {qty[m.id] ? (
                  <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center">
                    <button type="button" className="btn btn-ghost !min-h-[40px] !rounded-lg !px-0" onClick={() => bump(m.id, -1)} aria-label="Less"><Icon name="minus" size={18} /></button>
                    <span className="px-2 text-lg font-black">{qty[m.id]}</span>
                    <button type="button" className="btn btn-pink !min-h-[40px] !rounded-lg !px-0" onClick={() => bump(m.id, 1)} aria-label="More"><Icon name="plus" size={18} /></button>
                  </div>
                ) : null}
                {qty[m.id] && m.allowNote ? (
                  <input className="field !min-h-[40px] mt-1 !rounded-lg !px-2 !text-sm" placeholder="Which sweet?" maxLength={40} value={which[m.id] ?? ''} onChange={(e) => setWhich({ ...which, [m.id]: e.target.value })} aria-label="Which sweet?" />
                ) : null}
              </div>
            ))}
          </div>
        )}
        <input className="field" placeholder="Other items (free text)" value={itemsText} onChange={(e) => setItemsText(e.target.value)} maxLength={500} />
      </div>

      <div className="space-y-3 rounded-3xl bg-sun-soft p-3">
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <div>
            <label className="label" htmlFor="amt">{driver ? 'Amount collected' : 'Amount to collect'}</label>
            <div className="relative">
              <span className="absolute left-4 top-[13px] text-lg font-black text-mute">$</span>
              <input id="amt" className="field !pl-9" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          {menuTotal > 0 && (
            <button type="button" className="btn btn-ghost btn-sm !min-h-[54px]" onClick={() => setAmount(fromCents(menuTotal))}>{money(menuTotal)}</button>
          )}
        </div>
        <Segmented<Pay> value={pay} onChange={setPay} options={[{ value: 'cash', label: 'Cash', icon: 'cash' }, { value: 'zelle', label: 'Zelle', icon: 'bank' }]} />
        {!driver && <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="cut">Driver keeps</label>
            <div className="relative">
              <span className="absolute left-4 top-[13px] text-lg font-black text-mute">$</span>
              <input id="cut" className="field !pl-9" inputMode="decimal" placeholder="0.00" value={cut} onChange={(e) => setCut(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="owed">Owes owner</label>
            <div className="relative">
              <span className="absolute left-4 top-[13px] text-lg font-black text-mute">$</span>
              <input id="owed" className="field !pl-9" inputMode="decimal" placeholder="0.00" value={owed} onChange={(e) => { setOwed(e.target.value); setOwedTouched(true) }} />
            </div>
          </div>
        </div>}
      </div>

      <textarea className="field !min-h-[84px] py-3" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />

      {edit && (
        <div className="grid grid-cols-2 gap-2">
          <select className="field" value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Status">
            <option value="new">New</option><option value="taken">Taken</option><option value="delivered">Delivered</option>
          </select>
          <select className="field" value={driverId} onChange={(e) => setDriverId(e.target.value)} disabled={status === 'new'} aria-label="Driver">
            <option value="">Driver…</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      )}

      <button className="btn btn-pink w-full" onClick={save} disabled={busy}>
        <Icon name="check" />{busy ? 'Saving…' : edit ? 'Save' : driver ? 'Add delivery' : 'Create delivery'}
      </button>
    </div>
  )
}
