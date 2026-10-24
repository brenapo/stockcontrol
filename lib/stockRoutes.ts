import { and, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from './db.js'
import { HttpError, rt, type Route } from './http.js'
import { menuItems, settings, stock, stockLog, users } from './schema.js'
import { alertLow, manualAdjust, manualSet, settingThreshold, skuFor, STORE, transfer, type Actor, type Move, type StoreChange } from './stock.js'
import { clean, STORE_TZ } from './util.js'

const db = () => getDb()
const holderSchema = z.union([z.literal(STORE), z.string().uuid()])
const itemInput = z.object({ itemId: z.number().int(), name: z.string().max(80).nullish() })

type MenuRow = typeof menuItems.$inferSelect
const imageOf = (m: MenuRow) => (m.imageData ? `/api/menu-image/${m.id}?v=${m.imageVersion}` : `/candy/${m.letter.toLowerCase()}.svg`)

async function resolveItem(itemId: number, name?: string | null): Promise<{ sku: string; name: string }> {
  const [m] = await db().select().from(menuItems).where(and(eq(menuItems.id, itemId), eq(menuItems.retired, false)))
  if (!m) throw new HttpError(404, 'Unknown item')
  if (m.allowNote && !clean(name ?? '', 40)) throw new HttpError(400, 'Type which sweet it is')
  return skuFor(m, name)
}

async function assertHolder(holder: string) {
  if (holder === STORE) return
  const [u] = await db().select({ id: users.id }).from(users).where(and(eq(users.id, holder), eq(users.role, 'driver'), isNull(users.deletedAt)))
  if (!u) throw new HttpError(404, 'Driver not found')
}

/** Menu sweets (even at 0) + any "Other" names that have stock rows. */
async function catalog() {
  const [menu, rows, allMenu] = await Promise.all([
    db().select().from(menuItems).where(and(eq(menuItems.retired, false), eq(menuItems.active, true))).orderBy(menuItems.sortOrder),
    db().select().from(stock),
    db().select().from(menuItems),
  ])
  const nameOf = new Map(allMenu.map((m) => [`i${m.id}`, m.name]))
  const other = menu.find((m) => m.allowNote)
  const items = new Map<string, { sku: string; name: string; itemId: number; imageUrl: string; custom: boolean }>()
  for (const m of menu) if (!m.allowNote) items.set(`i${m.id}`, { sku: `i${m.id}`, name: m.name, itemId: m.id, imageUrl: imageOf(m), custom: false })
  for (const r of rows) {
    if (items.has(r.sku)) continue
    if (r.sku.startsWith('o:') && other) items.set(r.sku, { sku: r.sku, name: r.name, itemId: other.id, imageUrl: imageOf(other), custom: true })
  }
  return { items: [...items.values()], rows, nameOf, otherItemId: other?.id ?? null }
}

export const stockRoutes: Route[] = [
  // owner overview: store + every driver + totals + low-stock flags
  rt('GET', /^\/stock$/, 'owner', async () => {
    const [cat, drivers, threshold] = await Promise.all([
      catalog(),
      db().select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, 'driver'), isNull(users.deletedAt))).orderBy(users.createdAt),
      settingThreshold(),
    ])
    const driverIds = new Set(drivers.map((d) => d.id))
    const items = cat.items.map((it) => {
      let store = 0, total = 0
      const byDriver: Record<string, number> = {}
      for (const r of cat.rows) {
        if (r.sku !== it.sku) continue
        if (r.holder === STORE) store = r.qty
        else if (driverIds.has(r.holder)) byDriver[r.holder] = r.qty
        else continue
        total += r.qty
      }
      const stocked = cat.rows.some((r) => r.sku === it.sku && r.holder === STORE)
      return { ...it, name: cat.nameOf.get(it.sku) ?? it.name, store, byDriver, total, low: stocked && store <= threshold }
    })
    return { threshold, drivers, items, otherItemId: cat.otherItemId, low: items.filter((i) => i.low).map((i) => ({ sku: i.sku, name: i.name, store: i.store })) }
  }),

  // a driver's own stock
  rt('GET', /^\/stock\/me$/, 'driver', async ({ user }) => {
    const cat = await catalog()
    const mine = new Map(cat.rows.filter((r) => r.holder === user!.id).map((r) => [r.sku, r.qty]))
    const items = cat.items.map((it) => ({ ...it, name: cat.nameOf.get(it.sku) ?? it.name, qty: mine.get(it.sku) ?? 0 }))
    return { items, otherItemId: cat.otherItemId }
  }),

  // +/- or set. Owner: any holder. Driver: only their own stock.
  rt('POST', /^\/stock\/adjust$/, 'user', async ({ user, body }) => {
    const b = itemInput.extend({
      holder: holderSchema.optional(),
      delta: z.number().int().min(-10_000).max(10_000).optional(),
      set: z.number().int().min(0).max(100_000).optional(),
    }).refine((v) => (v.delta === undefined) !== (v.set === undefined), 'Send delta or set').parse(body)
    const holder = b.holder ?? (user!.role === 'driver' ? user!.id : STORE)
    if (user!.role === 'driver' && holder !== user!.id) throw new HttpError(403, 'You can only change your own stock')
    await assertHolder(holder)
    const { sku, name } = await resolveItem(b.itemId, b.name)
    const actor: Actor = { id: user!.id, name: user!.name }
    const change = await db().transaction((tx) =>
      b.set !== undefined ? manualSet(tx, actor, holder, sku, name, b.set) : manualAdjust(tx, actor, holder, sku, name, b.delta!),
    )
    if (holder === STORE) await alertLow([change])
    return { sku, qty: change.after }
  }),

  // owner moves sweets between store and drivers (give / take back), all-or-nothing
  rt('POST', /^\/stock\/transfer$/, 'owner', async ({ user, body }) => {
    const b = z.object({
      from: holderSchema, to: holderSchema,
      items: z.array(itemInput.extend({ qty: z.number().int().min(1).max(10_000) })).min(1, 'Pick at least one sweet').max(60),
    }).refine((v) => v.from !== v.to, 'Pick two different places').parse(body)
    await assertHolder(b.from)
    await assertHolder(b.to)
    const merged = new Map<string, Move>()
    for (const i of b.items) {
      const r = await resolveItem(i.itemId, i.name)
      const m = merged.get(r.sku)
      if (m) m.qty += i.qty
      else merged.set(r.sku, { ...r, qty: i.qty })
    }
    const changes: StoreChange[] = await db().transaction((tx) => transfer(tx, { id: user!.id, name: user!.name }, b.from, b.to, [...merged.values()]))
    await alertLow(changes)
    return { ok: true }
  }),

  rt('PUT', /^\/stock\/settings$/, 'owner', async ({ body }) => {
    const { lowThreshold } = z.object({ lowThreshold: z.number().int().min(0).max(10_000) }).parse(body)
    await db().insert(settings).values({ key: 'low_stock', value: String(lowThreshold) })
      .onConflictDoUpdate({ target: settings.key, set: { value: String(lowThreshold) } })
    return { threshold: lowThreshold }
  }),

  // history. Owner: filter by place and date. Driver: always only entries involving themselves.
  rt('GET', /^\/stock\/log$/, 'user', async ({ user, query }) => {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    const q = z.object({
      holder: holderSchema.optional(), from: date, to: date,
    }).parse({ holder: query.get('holder') ?? undefined, from: query.get('from') ?? undefined, to: query.get('to') ?? undefined })
    const holder = user!.role === 'driver' ? user!.id : q.holder
    const where: (SQL | undefined)[] = []
    if (holder) where.push(or(eq(stockLog.fromHolder, holder), eq(stockLog.toHolder, holder)))
    if (q.from) where.push(sql`${stockLog.at} >= (${q.from}::date::timestamp AT TIME ZONE ${STORE_TZ}::text)`)
    if (q.to) where.push(sql`${stockLog.at} < ((${q.to}::date + 1)::timestamp AT TIME ZONE ${STORE_TZ}::text)`)
    const rows = await db().select().from(stockLog).where(and(...where)).orderBy(desc(stockLog.at), desc(stockLog.id)).limit(300)
    return { log: rows }
  }),
]
