import { and, eq, sql } from 'drizzle-orm'
import { getDb, type Tx } from './db.js'
import { HttpError } from './http.js'
import { notifyLowStock } from './notify.js'
import { menuItems, settings, stock, stockLog, users, type OrderItem } from './schema.js'
import { clean } from './util.js'

export const STORE = 'store'
export const DEFAULT_LOW = 5

export type Actor = { id: string | null; name: string }
export type StoreChange = { sku: string; name: string; before: number; after: number }

export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40)

/** Stock identity of a menu pick. "Other" is tracked by the name that was typed. */
export function skuFor(menu: { id: number; allowNote: boolean; name: string }, note?: string | null): { sku: string; name: string } {
  if (!menu.allowNote) return { sku: `i${menu.id}`, name: menu.name }
  const typed = clean(note ?? '', 40)?.replace(/\s+/g, ' ') ?? null
  return typed ? { sku: `o:${norm(typed)}`, name: typed } : { sku: 'o:other', name: menu.name }
}

export async function holderName(tx: Tx | ReturnType<typeof getDb>, holder: string): Promise<string> {
  if (holder === STORE) return 'Store'
  const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, holder))
  return u?.name ?? 'Driver'
}

/** Atomic add/subtract on one stock row. Returns quantity before/after. Throws 409 if a *manual* removal would go below zero. */
export async function adjust(
  tx: Tx, holder: string, sku: string, name: string, delta: number, opts: { allowNegative?: boolean } = {},
): Promise<{ before: number; after: number }> {
  const [row] = await tx
    .insert(stock)
    .values({ holder, sku, name, qty: delta })
    .onConflictDoUpdate({ target: [stock.holder, stock.sku], set: { qty: sql`${stock.qty} + ${delta}`, name } })
    .returning({ qty: stock.qty })
  if (delta < 0 && row.qty < 0 && !opts.allowNegative) {
    throw new HttpError(409, `Not enough ${name}${holder === STORE ? ' in the store' : ''}`)
  }
  return { before: row.qty - delta, after: row.qty }
}

type LogRow = typeof stockLog.$inferInsert
const log = (tx: Tx, row: LogRow) => tx.insert(stockLog).values(row)

export async function settingThreshold(db: ReturnType<typeof getDb> | Tx = getDb()): Promise<number> {
  const [r] = await db.select().from(settings).where(eq(settings.key, 'low_stock'))
  const n = r ? Number(r.value) : DEFAULT_LOW
  return Number.isFinite(n) ? n : DEFAULT_LOW
}

/** Manual +/- by the owner (any holder) or a driver (own stock). */
export async function manualAdjust(tx: Tx, actor: Actor, holder: string, sku: string, name: string, delta: number): Promise<StoreChange> {
  if (delta === 0) return { sku, name, before: 0, after: 0 }
  const { before, after } = await adjust(tx, holder, sku, name, delta)
  const who = await holderName(tx, holder)
  await log(tx, {
    action: delta > 0 ? 'add' : 'remove', actorId: actor.id, actorName: actor.name,
    fromHolder: delta < 0 ? holder : null, fromName: delta < 0 ? who : null,
    toHolder: delta > 0 ? holder : null, toName: delta > 0 ? who : null,
    sku, name, qty: Math.abs(delta),
  })
  return { sku, name, before, after }
}

/** Set an exact quantity. The row is locked first so a concurrent +/- cannot be lost. */
export async function manualSet(tx: Tx, actor: Actor, holder: string, sku: string, name: string, target: number): Promise<StoreChange> {
  await tx.insert(stock).values({ holder, sku, name, qty: 0 }).onConflictDoNothing()
  const [cur] = await tx.select({ qty: stock.qty }).from(stock).where(and(eq(stock.holder, holder), eq(stock.sku, sku))).for('update')
  const delta = target - cur.qty
  if (delta === 0) return { sku, name, before: cur.qty, after: cur.qty }
  const r = await manualAdjust(tx, actor, holder, sku, name, delta)
  return r
}

export type Move = { sku: string; name: string; qty: number }

/** All-or-nothing move between two holders (store or a driver). Source must have enough of every item. */
export async function transfer(tx: Tx, actor: Actor, from: string, to: string, moves: Move[]): Promise<StoreChange[]> {
  const fromName = await holderName(tx, from)
  const toName = await holderName(tx, to)
  const storeChanges: StoreChange[] = []
  for (const m of [...moves].sort((a, b) => a.sku.localeCompare(b.sku))) { // fixed order avoids deadlocks
    const out = await adjust(tx, from, m.sku, m.name, -m.qty)
    const inn = await adjust(tx, to, m.sku, m.name, m.qty, { allowNegative: true })
    if (from === STORE) storeChanges.push({ sku: m.sku, name: m.name, ...out })
    if (to === STORE) storeChanges.push({ sku: m.sku, name: m.name, ...inn })
    await log(tx, {
      action: 'transfer', actorId: actor.id, actorName: actor.name,
      fromHolder: from, fromName, toHolder: to, toName, sku: m.sku, name: m.name, qty: m.qty,
    })
  }
  return storeChanges
}

type OrderLike = { id: string; code: number; driverId: string | null; items: OrderItem[] }

/** Delivered → subtract from the driver (may go negative on purpose); revert → give it back. */
export async function applyDelivery(
  tx: Tx, o: OrderLike, kind: 'deliver' | 'revert', actor: Actor, driverId = o.driverId,
): Promise<{ name: string; qty: number }[]> {
  if (!driverId) return []
  const agg = new Map<string, { name: string; qty: number }>()
  for (const i of o.items) {
    if (!i.sku) continue // orders from before stock tracking
    const a = agg.get(i.sku) ?? { name: i.name, qty: 0 }
    a.qty += i.qty
    agg.set(i.sku, a)
  }
  if (!agg.size) return []
  const who = await holderName(tx, driverId)
  const negative: { name: string; qty: number }[] = []
  for (const [sku, a] of [...agg].sort((x, y) => x[0].localeCompare(y[0]))) {
    const sign = kind === 'deliver' ? -1 : 1
    const { after } = await adjust(tx, driverId, sku, a.name, sign * a.qty, { allowNegative: true })
    if (after < 0) negative.push({ name: a.name, qty: after })
    await log(tx, {
      action: kind, actorId: actor.id, actorName: actor.name,
      fromHolder: kind === 'deliver' ? driverId : null, fromName: kind === 'deliver' ? who : null,
      toHolder: kind === 'revert' ? driverId : null, toName: kind === 'revert' ? who : null,
      sku, name: a.name, qty: a.qty, orderId: o.id, note: `#${o.code}`,
    })
  }
  return negative
}

/** Telegram alert only when the store level *crosses* the threshold, so it is not repeated on every tap. */
export async function alertLow(changes: StoreChange[]): Promise<void> {
  if (!changes.length) return
  const threshold = await settingThreshold()
  await Promise.allSettled(
    changes.filter((c) => c.after <= threshold && c.before > threshold).map((c) => notifyLowStock(c.name, c.after, threshold)),
  )
}

export async function menuCatalog() {
  return getDb().select().from(menuItems).where(and(eq(menuItems.retired, false), eq(menuItems.active, true))).orderBy(menuItems.sortOrder)
}
