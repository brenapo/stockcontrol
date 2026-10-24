import { useEffect, useState } from 'react'
import { api } from '../api'
import { Icon } from './Icon'
import { useToast } from './ui'

export type Row = { sku: string; name: string; itemId: number; imageUrl: string; custom: boolean; qty: number; low?: boolean }

/** Quantity box: tap to type a number, or use −/+. Red when below zero, amber when low. */
function QtyBox({ value, onSet }: { value: number; onSet: (n: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const n = Number(text)
    if (text.trim() === '' || !Number.isInteger(n) || n < 0) return setText(String(value))
    if (n !== value) onSet(n)
  }
  return (
    <input
      className={`h-[48px] w-[72px] rounded-xl border-2 border-line bg-card text-center text-2xl font-black focus:border-pink focus:outline-none ${value < 0 ? 'text-red-600' : ''}`}
      inputMode="numeric"
      value={text}
      onChange={(e) => setText(e.target.value.replace(/[^0-9-]/g, ''))}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur())}
      aria-label="Quantity"
    />
  )
}

/** One place's stock (the store, or one driver) with +/−, quick number input and "add another sweet" for Other. */
export default function StockList({ holder, rows, otherItemId, onChanged, hideZeroCustom = true }: {
  holder: 'store' | string
  rows: Row[]
  otherItemId: number | null
  onChanged: () => void
  hideZeroCustom?: boolean
}) {
  const { fail } = useToast()
  const [pend, setPend] = useState<Record<string, number>>({})
  const [newName, setNewName] = useState('')

  const send = async (r: { itemId: number; name: string; custom: boolean }, body: { delta?: number; set?: number }, key: string, shown: number) => {
    setPend((p) => ({ ...p, [key]: (p[key] ?? 0) + shown }))
    try {
      await api('/stock/adjust', { body: { holder: holder === 'me' ? undefined : holder, itemId: r.itemId, name: r.custom ? r.name : undefined, ...body } })
    } catch (e) {
      fail(e)
    } finally {
      setPend((p) => ({ ...p, [key]: (p[key] ?? 0) - shown }))
      onChanged()
    }
  }

  const addOther = async () => {
    if (!otherItemId || !newName.trim()) return
    await send({ itemId: otherItemId, name: newName.trim(), custom: true }, { delta: 1 }, `new:${newName}`, 0)
    setNewName('')
  }

  const shown = rows.filter((r) => !(r.custom && hideZeroCustom && r.qty === 0 && !pend[r.sku]))
  return (
    <div className="space-y-2">
      {shown.map((r) => {
        const qty = r.qty + (pend[r.sku] ?? 0)
        return (
          <div key={r.sku} className={`flex items-center gap-2 rounded-2xl border-2 bg-card p-2 ${qty < 0 ? 'border-red-500 bg-red-50' : r.low ? 'border-orange' : 'border-line'}`}>
            <img src={r.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-black leading-tight">{r.name}</div>
              {qty < 0 && <div className="text-xs font-extrabold uppercase text-red-600">Below zero</div>}
              {qty >= 0 && r.low && <div className="text-xs font-extrabold uppercase text-orange">Low</div>}
            </div>
            <button className="btn btn-ghost btn-sm !w-11 !px-0" onClick={() => send(r, { delta: -1 }, r.sku, -1)} aria-label={`Less ${r.name}`}><Icon name="minus" size={20} /></button>
            <QtyBox value={qty} onSet={(n) => send(r, { set: n }, r.sku, 0)} />
            <button className="btn btn-pink btn-sm !w-11 !px-0" onClick={() => send(r, { delta: 1 }, r.sku, 1)} aria-label={`More ${r.name}`}><Icon name="plus" size={20} /></button>
          </div>
        )
      })}
      {otherItemId && (
        <div className="flex gap-2">
          <input className="field !min-h-[48px] flex-1 !rounded-xl !text-base" placeholder="Other sweet name" maxLength={40} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addOther()} />
          <button className="btn btn-sm btn-ghost" disabled={!newName.trim()} onClick={addOther}><Icon name="plus" size={20} />Add</button>
        </div>
      )}
    </div>
  )
}
