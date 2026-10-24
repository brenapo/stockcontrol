import { useState } from 'react'
import { fromCents, toCents } from './format'

// Collected / Pass to owner / Driver keeps, always adding up:
// - typing the amount fills "Pass to owner" with the full amount (driver keeps 0) until a share is typed
// - typing "Pass to owner" sets driver keeps = amount − owner; typing "Driver keeps" sets owner = amount − driver
// - changing the amount later keeps "keeps" and recalculates "pass to owner" (or the share typed last)
type Lead = 'auto' | 'owed' | 'cut'
type Init = { amountCents?: number | null; driverCutCents?: number | null; ownerOwedCents?: number | null }

const diff = (a: string, b: string) => {
  const x = toCents(a)
  if (x == null) return ''
  return fromCents(x - (toCents(b) ?? 0))
}

export function useSplit(init?: Init) {
  const [amount, setA] = useState(fromCents(init?.amountCents))
  const [cut, setC] = useState(fromCents(init?.driverCutCents))
  const [owed, setO] = useState(fromCents(init?.ownerOwedCents))
  const [lead, setLead] = useState<Lead>(init?.driverCutCents != null ? 'cut' : init?.ownerOwedCents != null ? 'owed' : 'auto')

  const setAmount = (v: string) => {
    setA(v)
    if (lead === 'cut') setO(diff(v, cut))
    else if (lead === 'owed') setC(diff(v, owed))
    else { setO(toCents(v) == null ? '' : fromCents(toCents(v)!)); setC(toCents(v) == null ? '' : '0.00') }
  }
  const setOwed = (v: string) => { setO(v); setLead('owed'); if (toCents(amount) != null) setC(diff(amount, v)) }
  const setCut = (v: string) => { setC(v); setLead('cut'); if (toCents(amount) != null) setO(diff(amount, v)) }
  const reset = () => { setA(''); setC(''); setO(''); setLead('auto') }
  const load = (i: Init) => {
    setA(fromCents(i.amountCents)); setC(fromCents(i.driverCutCents)); setO(fromCents(i.ownerOwedCents))
    setLead(i.driverCutCents != null ? 'cut' : i.ownerOwedCents != null ? 'owed' : 'auto')
  }
  return { amount, cut, owed, setAmount, setCut, setOwed, reset, load }
}
