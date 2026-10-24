import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { getDb } from './db.js'
import { HttpError, json, rt, type Route } from './http.js'
import { itemsSummary, notifyNewOrder, notifyStatus, push } from './notify.js'
import { menuItems, orders, pushSubscriptions, stock, users, type OrderItem } from './schema.js'
import {
  checkFormToken, clearCookie, createSession, destroySession, destroyUserSessions, hashPassword, hit,
  makeFormToken, readCookie, COOKIE_NAME, sessionCookie, verifyPassword,
} from './security.js'
import { applyDelivery, alertLow, transfer, skuFor, STORE, type Actor } from './stock.js'
import { stockRoutes } from './stockRoutes.js'
import { suggestAddresses } from './places.js'
import { builtInImage, clean, digits, isHalfStep, STORE_TZ } from './util.js'

const db = () => getDb()

// ---------- shared validation ----------
const cents = z.number().int().min(0).max(10_000_00)
const text = (max: number) => z.string().max(max).nullish()
const itemRef = z.object({ id: z.number().int(), qty: z.number().min(0.5).max(99).refine(isHalfStep, 'Use steps of 0.5'), note: z.string().max(80).nullish() })

const customerFields = {
  customerName: text(120),
  phone: text(40),
  address: text(300),
  notes: text(500),
  itemsText: text(500),
  items: z.array(itemRef).max(60).optional(),
}
const ownerFields = {
  ...customerFields,
  amountCents: cents.nullish(),
  paymentMethod: z.enum(['cash', 'zelle']).nullish(),
  driverCutCents: cents.nullish(),
  ownerOwedCents: z.number().int().min(-10_000_00).max(10_000_00).nullish(),
}
const ownerOrderCreate = z.object(ownerFields)
// drivers log their own customers' deliveries: they set what they collected; the owner sets the split later
const driverOrderCreate = z.object({ ...customerFields, amountCents: cents.nullish(), paymentMethod: z.enum(['cash', 'zelle']).nullish(), driverCutCents: cents.nullish(), ownerOwedCents: z.number().int().min(-10_000_00).max(10_000_00).nullish() })
const ownerOrderPatch = z.object({
  ...ownerFields,
  status: z.enum(['new', 'taken', 'delivered']).optional(),
  driverId: z.string().uuid().nullish(),
})
const publicOrder = z.object({ ...customerFields, token: z.string().max(200), website: z.string().max(200).optional() })

async function snapshotItems(refs: { id: number; qty: number; note?: string | null }[]): Promise<OrderItem[]> {
  if (!refs.length) return []
  const rows = await db().select().from(menuItems).where(and(inArray(menuItems.id, refs.map((r) => r.id)), eq(menuItems.active, true), eq(menuItems.retired, false)))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const merged = new Map<string, OrderItem>()
  for (const r of refs) {
    const m = byId.get(r.id)
    if (!m) throw new HttpError(400, 'An item in your order is no longer available')
    const { sku, name } = skuFor(m, r.note)
    const cur = merged.get(sku)
    if (cur) cur.qty = Math.min(99, cur.qty + r.qty)
    else merged.set(sku, { id: m.id, sku, name, qty: r.qty, priceCents: m.priceCents, ...(m.allowNote && name !== m.name ? { note: name } : {}) })
  }
  return [...merged.values()]
}

type TextIn = { customerName?: string | null; phone?: string | null; address?: string | null; notes?: string | null; itemsText?: string | null }
function textFields(b: TextIn) {
  const out: Partial<typeof orders.$inferInsert> = {}
  if (b.customerName !== undefined) out.customerName = clean(b.customerName, 120)
  if (b.phone !== undefined) out.phone = clean(b.phone, 40)
  if (b.address !== undefined) out.address = clean(b.address, 300)
  if (b.notes !== undefined) out.notes = clean(b.notes, 500)
  if (b.itemsText !== undefined) out.itemsText = clean(b.itemsText, 500)
  return out
}

const serialize = (o: typeof orders.$inferSelect) => ({
  id: o.id, code: o.code, status: o.status, source: o.source,
  customerName: o.customerName, phone: o.phone, address: o.address, notes: o.notes,
  itemsText: o.itemsText, items: o.items,
  amountCents: o.amountCents, paymentMethod: o.paymentMethod,
  driverCutCents: o.driverCutCents, ownerOwedCents: o.ownerOwedCents,
  driverId: o.driverId, driverName: o.driverName,
  takenAt: o.takenAt, deliveredAt: o.deliveredAt, settledAt: o.settledAt, settledBy: o.settledBy, archivedAt: o.archivedAt, createdAt: o.createdAt,
})

const need = <T>(v: T | undefined, msg = 'Not found'): T => {
  if (v === undefined) throw new HttpError(404, msg)
  return v
}

// ---------- timezone helpers for payout summaries ----------
const tz = STORE_TZ
const dayStart = sql`(date_trunc('day', now() AT TIME ZONE ${tz}::text) AT TIME ZONE ${tz}::text)`
const weekStart = sql`(date_trunc('week', now() AT TIME ZONE ${tz}::text) AT TIME ZONE ${tz}::text)`

async function payoutRows(driverId?: string) {
  const sum = (col: AnyPgColumn, f: SQL) => sql<number>`coalesce(sum(${col}) filter (where ${f}), 0)::int`
  const cnt = (f: SQL) => sql<number>`(count(*) filter (where ${f}))::int`
  const inDay = sql`${orders.deliveredAt} >= ${dayStart}`
  const inWeek = sql`${orders.deliveredAt} >= ${weekStart}`
  const open = sql`${orders.settledAt} is null`
  return db()
    .select({
      driverId: orders.driverId,
      driverName: sql<string>`max(${orders.driverName})`,
      dayKept: sum(orders.driverCutCents, inDay), dayOwed: sum(orders.ownerOwedCents, inDay), dayCount: cnt(inDay),
      weekKept: sum(orders.driverCutCents, inWeek), weekOwed: sum(orders.ownerOwedCents, inWeek), weekCount: cnt(inWeek),
      openKept: sum(orders.driverCutCents, open), openOwed: sum(orders.ownerOwedCents, open), openCount: cnt(open),
    })
    .from(orders)
    .where(and(
      eq(orders.status, 'delivered'), isNotNull(orders.driverId),
      driverId ? eq(orders.driverId, driverId) : undefined,
      or(gte(orders.deliveredAt, weekStart), isNull(orders.settledAt)),
    ))
    .groupBy(orders.driverId)
}

// ---------- image helpers ----------
const IMG_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/
function validImage(dataUrl: string): boolean {
  const m = IMG_RE.exec(dataUrl)
  if (!m) return false
  const b = Buffer.from(m[2], 'base64')
  if (m[1] === 'png') return b.subarray(0, 4).toString('hex') === '89504e47'
  if (m[1] === 'jpeg') return b.subarray(0, 3).toString('hex') === 'ffd8ff'
  return b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
}

const menuView = (m: typeof menuItems.$inferSelect) => ({
  id: m.id, letter: m.letter, name: m.name, priceCents: m.priceCents, active: m.active, allowNote: m.allowNote,
  imageUrl: m.imageData ? `/api/menu-image/${m.id}?v=${m.imageVersion}` : builtInImage(m.letter),
  customImage: !!m.imageData,
})

const publicUser = (u: { id: string; username: string; name: string; role: string; phone: string | null }) =>
  ({ id: u.id, username: u.username, name: u.name, role: u.role, phone: u.phone })

// ---------- routes ----------
export const routes: Route[] = [
  // ----- public -----
  rt('GET', /^\/menu$/, 'shopOrUser', async ({ res }) => {
    const rows = await db().select().from(menuItems).where(and(eq(menuItems.active, true), eq(menuItems.retired, false))).orderBy(menuItems.sortOrder)
    res.setHeader('cache-control', 'private, max-age=15')
    return { items: rows.map(menuView) }
  }),

  rt('GET', /^\/menu-image\/(\d+)$/, 'shopOrUser', async ({ res, params }) => {
    const [m] = await db().select({ d: menuItems.imageData }).from(menuItems).where(eq(menuItems.id, Number(params[0])))
    const match = m?.d ? IMG_RE.exec(m.d) : null
    if (!match) throw new HttpError(404, 'Not found')
    res.statusCode = 200
    res.setHeader('content-type', `image/${match[1]}`)
    res.setHeader('cache-control', 'private, max-age=31536000, immutable')
    res.setHeader('x-content-type-options', 'nosniff')
    res.end(Buffer.from(match[2], 'base64'))
  }),

  rt('GET', /^\/public\/token$/, 'shop', async ({ ip }) => {
    if (!(await hit(`token:${ip}`, 60, 600))) throw new HttpError(429, 'Slow down')
    return { token: makeFormToken() }
  }),

  // address suggestions while typing (customer page and the app)
  rt('GET', /^\/places$/, 'shopOrUser', async ({ query, ip, res }) => {
    const q = clean(query.get('q'), 120)
    if (!q || q.length < 3) return { suggestions: [] }
    if (!(await hit(`places:${ip}`, 120, 600))) return { suggestions: [] }
    res.setHeader('cache-control', 'private, max-age=300')
    return { suggestions: await suggestAddresses(q) }
  }),

  rt('POST', /^\/public\/order$/, 'shop', async ({ body, ip }) => {
    if (!(await hit(`order:${ip}`, 5, 600)) || !(await hit('order:all', 120, 3600))) {
      throw new HttpError(429, 'Too many orders — please try again in a few minutes')
    }
    const b = publicOrder.parse(body)
    if (b.website) return { ok: true, code: 0 } // honeypot: pretend success
    if (!checkFormToken(b.token)) throw new HttpError(400, 'Please wait a moment and try again')
    const items = await snapshotItems(b.items ?? [])
    const fields = textFields(b)
    if (!items.length && !fields.itemsText && !fields.notes) throw new HttpError(400, 'Add something to your order')
    const [o] = await db().insert(orders).values({ ...fields, items, source: 'customer' }).returning()
    await Promise.allSettled([
      notifyNewOrder(o),
      push('all', { title: '🍭 New delivery', body: [o.address, itemsSummary(o)].filter(Boolean).join(' · ').slice(0, 140), url: '/app', tag: 'new-order' }),
    ])
    return { ok: true, code: o.code }
  }),

  // ----- auth -----
  rt('POST', /^\/auth\/login$/, 'public', async ({ body, ip, req, res }) => {
    const b = z.object({ username: z.string().max(64), password: z.string().max(200) }).parse(body)
    const username = b.username.trim().toLowerCase()
    if (!(await hit(`login:ip:${ip}`, 30, 900)) || !(await hit(`login:${ip}:${username}`, 8, 900))) {
      throw new HttpError(429, 'Too many attempts — try again later')
    }
    const [u] = await db().select().from(users).where(and(eq(users.username, username), isNull(users.deletedAt)))
    const ok = await verifyPassword(b.password, u?.passwordHash)
    if (!u || !ok) throw new HttpError(401, 'Wrong username or password')
    const token = await createSession(u.id, req.headers['user-agent'])
    res.setHeader('set-cookie', sessionCookie(token))
    return { user: publicUser(u) }
  }),

  rt('POST', /^\/auth\/logout$/, 'public', async ({ req, res }) => {
    const token = readCookie(req.headers.cookie, COOKIE_NAME)
    if (token) await destroySession(token)
    res.setHeader('set-cookie', clearCookie())
    return { ok: true }
  }),

  rt('GET', /^\/auth\/me$/, 'user', ({ user }) => ({ user: publicUser(user!) })),

  rt('POST', /^\/auth\/password$/, 'user', async ({ user, body, req, res }) => {
    const b = z.object({ current: z.string().max(200), next: z.string().min(8, 'Password needs 8+ characters').max(128) }).parse(body)
    if (!(await hit(`pw:${user!.id}`, 10, 900))) throw new HttpError(429, 'Too many attempts')
    const [u] = await db().select().from(users).where(eq(users.id, user!.id))
    if (!(await verifyPassword(b.current, u.passwordHash))) throw new HttpError(400, 'Current password is wrong')
    await db().update(users).set({ passwordHash: await hashPassword(b.next) }).where(eq(users.id, user!.id))
    await destroyUserSessions(user!.id)
    res.setHeader('set-cookie', sessionCookie(await createSession(user!.id, req.headers['user-agent'])))
    return { ok: true }
  }),

  // ----- orders: owner -----
  rt('GET', /^\/orders$/, 'user', async ({ user, query }) => {
    if (user!.role === 'driver') {
      const rows = await db().select().from(orders).where(and(
        isNull(orders.archivedAt),
        or(
          eq(orders.status, 'new'),
          and(eq(orders.driverId, user!.id), or(eq(orders.status, 'taken'), gte(orders.deliveredAt, sql`now() - interval '2 days'`))),
        ),
      )).orderBy(desc(orders.createdAt)).limit(200)
      return { orders: rows.map(serialize) }
    }
    const q = clean(query.get('q'), 80)
    const where: (SQL | undefined)[] = [query.get('archived') === '1' ? isNotNull(orders.archivedAt) : isNull(orders.archivedAt)]
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`
      where.push(or(
        sql`${orders.customerName} ilike ${like}`, sql`${orders.phone} ilike ${like}`, sql`${orders.address} ilike ${like}`,
        sql`${orders.itemsText} ilike ${like}`, sql`${orders.notes} ilike ${like}`, sql`${orders.driverName} ilike ${like}`,
        sql`${orders.items}::text ilike ${like}`, sql`${orders.code}::text = ${q.replace(/^#/, '')}`,
      ))
    }
    const rows = await db().select().from(orders).where(and(...where)).orderBy(desc(orders.createdAt)).limit(300)
    return { orders: rows.map(serialize) }
  }),

  rt('POST', /^\/orders$/, 'user', async ({ body, user }) => {
    if (user!.role === 'driver') {
      const b = driverOrderCreate.parse(body)
      if (!(await hit(`driver-order:${user!.id}`, 60, 3600))) throw new HttpError(429, 'Too many deliveries — try again later')
      const items = await snapshotItems(b.items ?? [])
      const fields = textFields(b)
      if (!items.length && !fields.itemsText && !fields.notes && !fields.address && !fields.customerName) throw new HttpError(400, 'Add something to the delivery')
      const [o] = await db().insert(orders).values({
        ...fields, items, source: 'driver', status: 'taken', driverId: user!.id, driverName: user!.name, takenAt: new Date(),
        amountCents: b.amountCents ?? null, paymentMethod: b.paymentMethod ?? null,
        driverCutCents: b.driverCutCents ?? null,
        ownerOwedCents: b.ownerOwedCents ?? (b.amountCents != null && b.driverCutCents != null ? b.amountCents - b.driverCutCents : null),
      }).returning()
      await Promise.allSettled([
        notifyNewOrder(o, `New delivery by ${user!.name}`),
        push('owner', { title: `🚗 ${user!.name} added #${o.code}`, body: [o.address, itemsSummary(o)].filter(Boolean).join(' · ').slice(0, 140), url: '/app', tag: `o-${o.id}` }),
      ])
      return { order: serialize(o) }
    }
    const b = ownerOrderCreate.parse(body)
    const items = await snapshotItems(b.items ?? [])
    const amount = b.amountCents ?? null
    const cut = b.driverCutCents ?? null
    const owed = b.ownerOwedCents ?? (amount != null ? amount - (cut ?? 0) : null)
    const [o] = await db().insert(orders).values({
      ...textFields(b), items, source: 'owner', amountCents: amount, paymentMethod: b.paymentMethod ?? null,
      driverCutCents: cut, ownerOwedCents: owed,
    }).returning()
    await Promise.allSettled([
      notifyNewOrder(o),
      push('all', { title: '🍭 New delivery', body: [o.address, itemsSummary(o)].filter(Boolean).join(' · ').slice(0, 140), url: '/app', tag: 'new-order' }),
    ])
    return { order: serialize(o) }
  }),

  rt('POST', /^\/orders\/archive-old$/, 'owner', async ({ body }) => {
    const { days } = z.object({ days: z.number().int().min(1).max(3650).default(30) }).parse(body)
    const rows = await db().update(orders).set({ archivedAt: new Date() })
      .where(and(eq(orders.status, 'delivered'), isNull(orders.archivedAt), lt(orders.deliveredAt, sql`now() - make_interval(days => ${days})`)))
      .returning({ id: orders.id })
    return { archived: rows.length }
  }),

  rt('PATCH', /^\/orders\/([0-9a-f-]{36})$/, 'owner', async ({ params, body, user }) => {
    const b = ownerOrderPatch.parse(body)
    const actor: Actor = { id: user!.id, name: user!.name }
    const newItems = b.items !== undefined ? await snapshotItems(b.items) : undefined
    const order = await db().transaction(async (tx) => {
      const [cur] = await tx.select().from(orders).where(eq(orders.id, params[0])).for('update')
      need(cur)
      if (newItems && cur.status === 'delivered') throw new HttpError(400, 'Items of a delivered order are locked — set it back to Taken first')
      const set: Partial<typeof orders.$inferInsert> = textFields(b)
      if (newItems) set.items = newItems
      if (b.amountCents !== undefined) set.amountCents = b.amountCents
      if (b.paymentMethod !== undefined) set.paymentMethod = b.paymentMethod
      if (b.driverCutCents !== undefined) set.driverCutCents = b.driverCutCents
      if (b.ownerOwedCents !== undefined) set.ownerOwedCents = b.ownerOwedCents
      else if (b.amountCents !== undefined || b.driverCutCents !== undefined) {
        const a = set.amountCents ?? cur.amountCents
        set.ownerOwedCents = a != null ? a - (set.driverCutCents ?? cur.driverCutCents ?? 0) : null
      }
      if (b.driverId !== undefined && b.driverId !== null) {
        const [d] = await tx.select().from(users).where(and(eq(users.id, b.driverId), eq(users.role, 'driver'), isNull(users.deletedAt)))
        need(d, 'Driver not found')
        set.driverId = d.id
        set.driverName = d.name
        if (cur.status === 'new' && b.status === undefined) { set.status = 'taken'; set.takenAt = new Date() }
      }
      if (b.driverId === null) { set.driverId = null; set.driverName = null; if (cur.status === 'taken' && !b.status) { set.status = 'new'; set.takenAt = null } }
      if (b.status === 'new') Object.assign(set, { status: 'new', driverId: null, driverName: null, takenAt: null, deliveredAt: null, settledAt: null, settledBy: null })
      if (b.status === 'taken') { set.status = 'taken'; set.deliveredAt = null; set.settledAt = null; set.settledBy = null; set.takenAt = cur.takenAt ?? new Date() }
      if (b.status === 'delivered') { set.status = 'delivered'; set.deliveredAt = cur.deliveredAt ?? new Date(); set.takenAt = cur.takenAt ?? new Date() }

      const finalStatus = set.status ?? cur.status
      const finalDriver = 'driverId' in set ? (set.driverId ?? null) : cur.driverId
      const wasDelivered = cur.status === 'delivered'
      const willDeliver = finalStatus === 'delivered' && !!finalDriver
      const sameDelivery = wasDelivered && willDeliver && finalDriver === cur.driverId
      // keep the driver's stock in step with delivery status changes
      if (wasDelivered && !sameDelivery) await applyDelivery(tx, cur, 'revert', actor)
      if (willDeliver && !sameDelivery) await applyDelivery(tx, { ...cur, items: set.items ?? cur.items }, 'deliver', actor, finalDriver)

      const [o] = await tx.update(orders).set(set).where(eq(orders.id, params[0])).returning()
      return o
    })
    return { order: serialize(order) }
  }),

  rt('DELETE', /^\/orders\/([0-9a-f-]{36})$/, 'owner', async ({ params, user }) => {
    await db().transaction(async (tx) => {
      const [cur] = await tx.select().from(orders).where(eq(orders.id, params[0])).for('update')
      if (!cur) return
      if (cur.status === 'delivered') await applyDelivery(tx, cur, 'revert', { id: user!.id, name: user!.name }) // give the sweets back
      await tx.delete(orders).where(eq(orders.id, params[0]))
    })
    return { ok: true }
  }),

  rt('POST', /^\/orders\/([0-9a-f-]{36})\/archive$/, 'owner', async ({ params, body }) => {
    const { archived } = z.object({ archived: z.boolean().default(true) }).parse(body)
    const [o] = await db().update(orders).set({ archivedAt: archived ? new Date() : null }).where(eq(orders.id, params[0])).returning()
    return { order: serialize(need(o)) }
  }),

  rt('POST', /^\/orders\/([0-9a-f-]{36})\/settle$/, 'owner', async ({ params, body, user }) => {
    const { settled } = z.object({ settled: z.boolean().default(true) }).parse(body)
    const [o] = await db().update(orders).set({ settledAt: settled ? new Date() : null, settledBy: settled ? user!.name : null })
      .where(and(eq(orders.id, params[0]), eq(orders.status, 'delivered'))).returning()
    return { order: serialize(need(o)) }
  }),

  // ----- orders: driver actions -----
  rt('POST', /^\/orders\/([0-9a-f-]{36})\/take$/, 'driver', async ({ params, user }) => {
    // single atomic UPDATE: the first driver to tap wins
    const [o] = await db().update(orders)
      .set({ status: 'taken', driverId: user!.id, driverName: user!.name, takenAt: new Date() })
      .where(and(eq(orders.id, params[0]), eq(orders.status, 'new'), isNull(orders.archivedAt)))
      .returning()
    if (!o) throw new HttpError(409, 'Someone else already took it')
    await Promise.allSettled([notifyStatus(o, 'taken'), push('owner', { title: `🚗 ${user!.name} took #${o.code}`, url: '/app', tag: `o-${o.id}` })])
    return { order: serialize(o) }
  }),

  // driver sets the money on their own delivery (until it is settled); the owner can still change it
  rt('POST', /^\/orders\/([0-9a-f-]{36})\/split$/, 'driver', async ({ params, body, user }) => {
    const b = z.object({
      amountCents: cents.nullish(), paymentMethod: z.enum(['cash', 'zelle']).nullish(),
      driverCutCents: cents.nullish(), ownerOwedCents: z.number().int().min(-10_000_00).max(10_000_00).nullish(),
    }).parse(body)
    const order = await db().transaction(async (tx) => {
      const [cur] = await tx.select().from(orders)
        .where(and(eq(orders.id, params[0]), eq(orders.driverId, user!.id), isNull(orders.settledAt), ne(orders.status, 'new'))).for('update')
      if (!cur) throw new HttpError(409, 'This delivery can no longer be changed')
      const set: Partial<typeof orders.$inferInsert> = {}
      if (b.amountCents !== undefined) set.amountCents = b.amountCents
      if (b.paymentMethod !== undefined) set.paymentMethod = b.paymentMethod
      if (b.driverCutCents !== undefined) set.driverCutCents = b.driverCutCents
      if (b.ownerOwedCents !== undefined) set.ownerOwedCents = b.ownerOwedCents
      else if (b.amountCents !== undefined || b.driverCutCents !== undefined) {
        const a = 'amountCents' in set ? set.amountCents : cur.amountCents
        set.ownerOwedCents = a != null ? a - ((('driverCutCents' in set ? set.driverCutCents : cur.driverCutCents) ?? 0)) : null
      }
      if (!Object.keys(set).length) return cur
      const [o] = await tx.update(orders).set(set).where(eq(orders.id, cur.id)).returning()
      return o
    })
    return { order: serialize(order) }
  }),

  // driver: "I settled this one with the owner" — clears it from Earnings
  rt('POST', /^\/orders\/([0-9a-f-]{36})\/clear$/, 'driver', async ({ params, user }) => {
    const [o] = await db().update(orders).set({ settledAt: new Date(), settledBy: user!.name })
      .where(and(eq(orders.id, params[0]), eq(orders.driverId, user!.id), eq(orders.status, 'delivered'), isNull(orders.settledAt)))
      .returning()
    if (!o) throw new HttpError(409, 'Already cleared')
    await push('owner', { title: `💵 ${user!.name} cleared #${o.code}`, body: o.ownerOwedCents != null ? `Owed to you: $${(o.ownerOwedCents / 100).toFixed(2)}` : undefined, url: '/app', tag: `clear-${user!.id}` }).catch(() => {})
    return { order: serialize(o) }
  }),

  rt('POST', /^\/orders\/([0-9a-f-]{36})\/release$/, 'driver', async ({ params, user }) => {
    const [o] = await db().update(orders)
      .set({ status: 'new', driverId: null, driverName: null, takenAt: null })
      .where(and(eq(orders.id, params[0]), eq(orders.status, 'taken'), eq(orders.driverId, user!.id)))
      .returning()
    if (!o) throw new HttpError(409, 'Cannot release this delivery')
    await push('all', { title: `🍭 #${o.code} is open again`, url: '/app', tag: 'new-order' })
    return { order: serialize(o) }
  }),

  rt('POST', /^\/orders\/([0-9a-f-]{36})\/deliver$/, 'user', async ({ params, user }) => {
    const mine = user!.role === 'driver' ? eq(orders.driverId, user!.id) : undefined
    const actor: Actor = { id: user!.id, name: user!.name }
    // status change and stock deduction commit together (or not at all); a repeat tap finds no 'taken' row and does nothing
    const res = await db().transaction(async (tx) => {
      const [o] = await tx.update(orders)
        .set({ status: 'delivered', deliveredAt: new Date() })
        .where(and(eq(orders.id, params[0]), eq(orders.status, 'taken'), mine))
        .returning()
      if (!o) return null
      const negative = await applyDelivery(tx, o, 'deliver', actor)
      return { o, negative }
    })
    if (!res) throw new HttpError(409, 'Cannot mark this delivery as delivered')
    const { o, negative } = res
    await Promise.allSettled([notifyStatus(o, 'delivered'), push('owner', { title: `✅ #${o.code} delivered`, body: o.driverName ?? undefined, url: '/app', tag: `o-${o.id}` })])
    return { order: serialize(o), negative }
  }),

  // ----- customers (owner): repeat last order -----
  rt('GET', /^\/customers$/, 'owner', async ({ query }) => {
    const q = clean(query.get('q'), 60)
    if (!q) return { customers: [] }
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`
    const d = digits(q)
    const rows = await db().select().from(orders)
      .where(or(sql`${orders.customerName} ilike ${like}`, sql`${orders.phone} ilike ${like}`, d ? sql`regexp_replace(${orders.phone}, '\\D', '', 'g') like ${'%' + d + '%'}` : undefined))
      .orderBy(desc(orders.createdAt)).limit(200)
    const seen = new Map<string, (typeof rows)[number]>()
    for (const r of rows) {
      const key = digits(r.phone) ?? r.customerName?.toLowerCase() ?? r.id
      if (!seen.has(key)) seen.set(key, r)
    }
    return {
      customers: [...seen.values()].slice(0, 8).map((r) => ({
        name: r.customerName, phone: r.phone, address: r.address, items: r.items, itemsText: r.itemsText, lastAt: r.createdAt,
      })),
    }
  }),

  // ----- payouts -----
  rt('GET', /^\/payouts\/me$/, 'driver', async ({ user }) => {
    const [r] = await payoutRows(user!.id)
    const z0 = { dayKept: 0, dayOwed: 0, dayCount: 0, weekKept: 0, weekOwed: 0, weekCount: 0, openKept: 0, openOwed: 0, openCount: 0 }
    const { driverId: _d, driverName: _n, ...rest } = r ?? { ...z0, driverId: null, driverName: '' }
    const open = await db().select().from(orders)
      .where(and(eq(orders.driverId, user!.id), eq(orders.status, 'delivered'), isNull(orders.settledAt)))
      .orderBy(desc(orders.deliveredAt)).limit(300)
    return { summary: rest, open: open.map(serialize) }
  }),

  rt('POST', /^\/payouts\/me\/clear$/, 'driver', async ({ user }) => {
    const rows = await db().update(orders).set({ settledAt: new Date(), settledBy: user!.name })
      .where(and(eq(orders.driverId, user!.id), eq(orders.status, 'delivered'), isNull(orders.settledAt)))
      .returning({ owed: orders.ownerOwedCents })
    if (rows.length) {
      const owed = rows.reduce((s, r) => s + (r.owed ?? 0), 0)
      await push('owner', { title: `💵 ${user!.name} cleared ${rows.length} deliveries`, body: `Owed to you: $${(owed / 100).toFixed(2)}`, url: '/app', tag: `clear-${user!.id}` }).catch(() => {})
    }
    return { cleared: rows.length }
  }),

  rt('GET', /^\/payouts$/, 'owner', async () => ({ drivers: (await payoutRows()).filter((r) => r.driverId) })),

  rt('POST', /^\/payouts\/settle$/, 'owner', async ({ body, user }) => {
    const { driverId } = z.object({ driverId: z.string().uuid() }).parse(body)
    const rows = await db().update(orders).set({ settledAt: new Date(), settledBy: user!.name })
      .where(and(eq(orders.driverId, driverId), eq(orders.status, 'delivered'), isNull(orders.settledAt))).returning({ id: orders.id })
    return { settled: rows.length }
  }),

  // ----- menu admin -----
  rt('GET', /^\/admin\/menu$/, 'owner', async () => {
    const rows = await db().select().from(menuItems).where(eq(menuItems.retired, false)).orderBy(menuItems.sortOrder)
    return { items: rows.map(menuView) }
  }),

  rt('PUT', /^\/admin\/menu\/(\d+)$/, 'owner', async ({ params, body }) => {
    const b = z.object({
      name: z.string().min(1, 'Name is required').max(60).optional(),
      priceCents: cents.optional(),
      active: z.boolean().optional(),
      image: z.string().max(450_000).nullable().optional(), // data URL; null = back to built-in sweet
    }).parse(body)
    const set: Partial<typeof menuItems.$inferInsert> = {}
    if (b.name !== undefined) set.name = clean(b.name, 60) ?? undefined
    if (b.priceCents !== undefined) set.priceCents = b.priceCents
    if (b.active !== undefined) set.active = b.active
    if (b.image !== undefined) {
      if (b.image !== null && !validImage(b.image)) throw new HttpError(400, 'Image must be a PNG, JPEG or WebP')
      set.imageData = b.image
      set.imageVersion = sql`${menuItems.imageVersion} + 1` as unknown as number
    }
    if (!Object.keys(set).length) throw new HttpError(400, 'Nothing to update')
    const [m] = await db().update(menuItems).set(set).where(eq(menuItems.id, Number(params[0]))).returning()
    return { item: menuView(need(m)) }
  }),

  // ----- team (owner) -----
  rt('GET', /^\/users$/, 'owner', async () => {
    const rows = await db().select().from(users).where(isNull(users.deletedAt)).orderBy(users.createdAt)
    return { users: rows.map(publicUser) }
  }),

  rt('POST', /^\/users$/, 'owner', async ({ body }) => {
    const b = z.object({
      username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, 'Username: 3-32 letters, numbers, . _ -'),
      name: z.string().trim().min(1, 'Name is required').max(60),
      phone: z.string().max(40).nullish(),
      password: z.string().min(8, 'Password needs 8+ characters').max(128),
    }).parse(body)
    const [dupe] = await db().select({ id: users.id }).from(users).where(and(eq(users.username, b.username), isNull(users.deletedAt)))
    if (dupe) throw new HttpError(409, 'Username already exists')
    const [u] = await db().insert(users).values({
      username: b.username, name: clean(b.name, 60) ?? b.username, phone: clean(b.phone, 40), role: 'driver', passwordHash: await hashPassword(b.password),
    }).returning()
    return { user: publicUser(u) }
  }),

  rt('POST', /^\/users\/logout-all$/, 'owner', async ({ user }) => {
    const ids = await db().select({ id: users.id }).from(users).where(and(ne(users.id, user!.id), isNull(users.deletedAt)))
    for (const { id } of ids) await destroyUserSessions(id)
    return { ok: true }
  }),

  rt('POST', /^\/users\/([0-9a-f-]{36})\/logout$/, 'owner', async ({ params }) => {
    await destroyUserSessions(params[0])
    return { ok: true }
  }),

  rt('POST', /^\/users\/([0-9a-f-]{36})\/password$/, 'owner', async ({ params, body }) => {
    const { password } = z.object({ password: z.string().min(8, 'Password needs 8+ characters').max(128) }).parse(body)
    const [u] = await db().update(users).set({ passwordHash: await hashPassword(password) })
      .where(and(eq(users.id, params[0]), eq(users.role, 'driver'), isNull(users.deletedAt))).returning({ id: users.id })
    need(u)
    await destroyUserSessions(u.id)
    return { ok: true }
  }),

  rt('DELETE', /^\/users\/([0-9a-f-]{36})$/, 'owner', async ({ params, user }) => {
    const [u] = await db().update(users).set({ deletedAt: new Date() })
      .where(and(eq(users.id, params[0]), eq(users.role, 'driver'), isNull(users.deletedAt))).returning({ id: users.id })
    need(u)
    await destroyUserSessions(u.id)
    await db().delete(pushSubscriptions).where(eq(pushSubscriptions.userId, u.id))
    // deliveries the driver had claimed but not finished go back to the open list
    await db().update(orders).set({ status: 'new', driverId: null, driverName: null, takenAt: null })
      .where(and(eq(orders.driverId, u.id), eq(orders.status, 'taken')))
    // whatever the driver was carrying goes back to the store
    const changes = await db().transaction(async (tx) => {
      const rows = await tx.select().from(stock).where(eq(stock.holder, u.id)).for('update')
      const moves = rows.filter((r) => r.qty > 0).map((r) => ({ sku: r.sku, name: r.name, qty: r.qty }))
      const c = moves.length ? await transfer(tx, { id: user!.id, name: user!.name }, u.id, STORE, moves) : []
      await tx.delete(stock).where(eq(stock.holder, u.id))
      return c
    })
    await alertLow(changes)
    return { ok: true }
  }),

  // ----- push -----
  rt('GET', /^\/push\/key$/, 'user', () => ({ key: process.env.VAPID_PUBLIC_KEY ?? null })),

  rt('POST', /^\/push\/subscribe$/, 'user', async ({ user, body }) => {
    const b = z.object({
      endpoint: z.string().url().max(1000).startsWith('https://'),
      keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
    }).parse(body)
    await db().insert(pushSubscriptions).values({ endpoint: b.endpoint, userId: user!.id, p256dh: b.keys.p256dh, auth: b.keys.auth })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: user!.id, p256dh: b.keys.p256dh, auth: b.keys.auth } })
    return { ok: true }
  }),

  rt('POST', /^\/push\/unsubscribe$/, 'user', async ({ user, body }) => {
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(body)
    await db().delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, user!.id)))
    return { ok: true }
  }),
]

routes.push(...stockRoutes)

export { json }
