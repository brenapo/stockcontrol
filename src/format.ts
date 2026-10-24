export const money = (cents: number | null | undefined) =>
  cents == null ? '—' : `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`

/** "12.5" / "$12,50" → 1250. Empty → null. */
export function toCents(input: string): number | null {
  const s = input.replace(/[^0-9.,-]/g, '').replace(',', '.')
  if (!s || s === '-' || s === '.') return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}
export const fromCents = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2))

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// Quantities: first tap = 1, then +0.5 (1, 1.5, 2 …); going down from 1 removes it
export const stepUp = (q: number, max = 99) => Math.min(max, q <= 0 ? 1 : q + 0.5)
export const stepDown = (q: number) => (q <= 1 ? 0 : q - 0.5)

export function summary(o: { items: { qty: number; name: string }[]; itemsText: string | null }): string {
  return [...o.items.map((i) => `${i.qty}× ${i.name}`), o.itemsText].filter(Boolean).join(', ')
}
