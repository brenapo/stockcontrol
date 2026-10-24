// Integration tests against a real Postgres. Run with:
//   TEST_DATABASE_URL=postgres://... npm test
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const url = process.env.TEST_DATABASE_URL
const d = url ? describe : describe.skip

d('Sugar Rush API', () => {
  let server: Server
  let base = ''
  const jars: Record<string, string> = {}

  async function call(who: string | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { origin: base, ...extra }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (who && jars[who]) headers.cookie = jars[who]
    const res = await fetch(base + '/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
    const sc = res.headers.get('set-cookie')
    if (who && sc) jars[who] = sc.split(';')[0]
    const text = await res.text()
    let json: any = {}
    try { json = JSON.parse(text) } catch { /* binary */ }
    return { status: res.status, json, res }
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url
    process.env.SESSION_SECRET = 'test-secret-test-secret'
    process.env.NODE_ENV = 'test'
    const { getDb } = await import('../lib/db.js')
    const { sql } = await import('drizzle-orm')
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    const db = getDb()
    await db.execute(sql`drop schema if exists public cascade`)
    await db.execute(sql`create schema public`)
    await db.execute(sql`drop schema if exists drizzle cascade`)
    await migrate(db as any, { migrationsFolder: './drizzle' })
    const { users } = await import('../lib/schema.js')
    const { hashPassword } = await import('../lib/security.js')
    await db.insert(users).values({ username: 'boss', name: 'Boss', role: 'owner', passwordHash: await hashPassword('correct-horse-1') })
    const { dispatch } = await import('../lib/http.js')
    const { routes } = await import('../lib/routes.js')
    server = createServer(async (req: any, res) => {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c)
      const raw = Buffer.concat(chunks).toString()
      req.body = raw ? JSON.parse(raw) : undefined
      await dispatch(routes, req, res)
    })
    await new Promise<void>((r) => server.listen(0, r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => server?.close())

  it('routes the Vercel rewrite form (/api/index?__path=...) like the plain URL', async () => {
    const r = await fetch(`${base}/api/index?__path=public%2Ftoken`)
    expect(r.status).toBe(200)
    expect((await r.json()).token).toMatch(/\./)
    const nested = await fetch(`${base}/api/index?__path=stock%2Fme`)
    expect(nested.status).toBe(401) // found, but needs a login
    expect((await fetch(`${base}/api/index?__path=`)).status).toBe(404) // bare /api has no route
  })

  it('address suggestions: short queries return nothing without calling out', async () => {
    const r = await call(null, 'GET', '/places?q=12')
    expect(r.status).toBe(200)
    expect(r.json.suggestions).toEqual([])
  })

  it('serves the public menu and nothing private', async () => {
    const r = await call(null, 'GET', '/menu')
    expect(r.json.items.map((i: any) => i.name)).toEqual(['Cannoli', 'Key Lime Pie', 'Éclair', 'Maria Mole', 'Xocolat', 'Amorade', 'Other'])
    expect((await call(null, 'GET', '/orders')).status).toBe(401)
    expect((await call(null, 'GET', '/users')).status).toBe(401)
    expect((await call(null, 'GET', '/customers?q=a')).status).toBe(401)
    expect((await call(null, 'GET', '/payouts')).status).toBe(401)
  })

  it('rejects bad logins and logs the owner in', async () => {
    expect((await call('owner', 'POST', '/auth/login', { username: 'boss', password: 'nope' })).status).toBe(401)
    expect((await call('owner', 'POST', '/auth/login', { username: 'ghost', password: 'nope' })).status).toBe(401)
    const ok = await call('owner', 'POST', '/auth/login', { username: 'Boss', password: 'correct-horse-1' })
    expect(ok.status).toBe(200)
    expect(ok.res.headers.get('set-cookie')).toMatch(/HttpOnly/)
    expect(ok.res.headers.get('set-cookie')).toMatch(/SameSite=Lax/)
    expect(JSON.stringify(ok.json)).not.toMatch(/hash/i)
  })

  it('blocks cross-origin writes (CSRF)', async () => {
    const r = await call('owner', 'POST', '/orders', {}, { origin: 'https://evil.example' })
    expect(r.status).toBe(403)
  })

  it('owner creates drivers; drivers cannot write amounts/menu/users', async () => {
    expect((await call('owner', 'POST', '/users', { username: 'dan', name: 'Dan', password: 'driverpass1' })).status).toBe(200)
    expect((await call('owner', 'POST', '/users', { username: 'eve', name: 'Eve', password: 'driverpass2' })).status).toBe(200)
    expect((await call('owner', 'POST', '/users', { username: 'dan', name: 'Dup', password: 'driverpass1' })).status).toBe(409)
    expect((await call('owner', 'POST', '/users', { username: 'x', name: 'Short', password: 'driverpass1' })).status).toBe(400)
    await call('dan', 'POST', '/auth/login', { username: 'dan', password: 'driverpass1' })
    await call('eve', 'POST', '/auth/login', { username: 'eve', password: 'driverpass2' })
    for (const [m, p, b] of [
      ['PUT', '/admin/menu/1', { name: 'x' }], ['GET', '/admin/menu', undefined],
      ['POST', '/users', { username: 'zed', name: 'Z', password: 'longenough1' }], ['GET', '/users', undefined],
      ['GET', '/payouts', undefined], ['POST', '/payouts/settle', { driverId: '00000000-0000-4000-8000-000000000000' }],
      ['GET', '/customers?q=ab', undefined], ['POST', '/users/logout-all', undefined],
    ] as const) {
      expect((await call('dan', m, p, b)).status, `${m} ${p}`).toBe(403)
    }
  })

  let orderId = ''
  it('customer order: honeypot, token, rate limit, no price tampering', async () => {
    const early = await call(null, 'POST', '/public/order', { token: (await call(null, 'GET', '/public/token')).json.token, items: [{ id: 1, qty: 1 }] })
    expect(early.status).toBe(400) // submitted instantly = bot-like
    await new Promise((r) => setTimeout(r, 2600))
    const token = (await call(null, 'GET', '/public/token')).json.token
    await new Promise((r) => setTimeout(r, 2600))
    expect((await call(null, 'POST', '/public/order', { token: 'forged.token', items: [{ id: 1, qty: 1 }] })).status).toBe(400)
    expect((await call(null, 'POST', '/public/order', { token, items: [] })).status).toBe(400)
    const r = await call(null, 'POST', '/public/order', {
      token, customerName: '<b>Cat</b>', phone: '(555) 010-0101', address: '1 Candy Ln', items: [{ id: 2, qty: 3 }],
      amountCents: 1, priceCents: 1, status: 'delivered', driverCutCents: 500,
    })
    expect(r.status).toBe(200)
    const list = await call('owner', 'GET', '/orders')
    const o = list.json.orders.find((x: any) => x.code === r.json.code)
    orderId = o.id
    expect(o.status).toBe('new')
    expect(o.amountCents).toBeNull() // customers cannot set money fields
    expect(o.driverCutCents).toBeNull()
    expect(o.items[0]).toMatchObject({ id: 2, sku: 'i2', name: 'Key Lime Pie', qty: 3, priceCents: 300 })
    const hp = await call(null, 'POST', '/public/order', { token, website: 'http://spam', items: [{ id: 1, qty: 1 }] })
    expect(hp.status).toBe(200)
    expect((await call('owner', 'GET', '/orders')).json.orders).toHaveLength(1) // honeypot created nothing
    // rate limit kicks in after 5 attempts per IP
    const codes: number[] = []
    for (let i = 0; i < 6; i++) codes.push((await call(null, 'POST', '/public/order', { token, items: [{ id: 1, qty: 1 }] })).status)
    expect(codes).toContain(429)
  })

  it('owner sets money; owed auto-fills; drivers see their view; first driver to tap wins', async () => {
    const p = await call('owner', 'PATCH', `/orders/${orderId}`, { amountCents: 2500, paymentMethod: 'zelle', driverCutCents: 500 })
    expect(p.json.order).toMatchObject({ amountCents: 2500, paymentMethod: 'zelle', driverCutCents: 500, ownerOwedCents: 2000 })
    const mk = await call('owner', 'POST', '/orders', { customerName: 'Walk-in', address: '2 Sugar St', amountCents: 1000, driverCutCents: 200, ownerOwedCents: 700 })
    expect(mk.json.order.ownerOwedCents).toBe(700) // editable override respected

    const [a, b] = await Promise.all([call('dan', 'POST', `/orders/${orderId}/take`), call('eve', 'POST', `/orders/${orderId}/take`)])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const winner = a.status === 200 ? 'dan' : 'eve'
    const loser = winner === 'dan' ? 'eve' : 'dan'
    expect((await call(loser, 'POST', `/orders/${orderId}/deliver`)).status).toBe(409)
    const loserList = (await call(loser, 'GET', '/orders')).json.orders
    expect(loserList.map((o: any) => o.id)).not.toContain(orderId) // other drivers don't see claimed orders
    const winList = (await call(winner, 'GET', '/orders')).json.orders
    expect(winList.map((o: any) => o.id)).toContain(orderId)
    expect((await call(winner, 'POST', `/orders/${orderId}/deliver`)).status).toBe(200)
    expect((await call(winner, 'POST', `/orders/${orderId}/deliver`)).status).toBe(409)
    // payouts
    const me = (await call(winner, 'GET', '/payouts/me')).json.summary
    expect(me).toMatchObject({ dayKept: 500, dayOwed: 2000, weekKept: 500, weekOwed: 2000, openOwed: 2000 })
    const all = (await call('owner', 'GET', '/payouts')).json.drivers
    expect(all).toHaveLength(1)
    const driverId = all[0].driverId
    expect((await call('owner', 'POST', '/payouts/settle', { driverId })).json.settled).toBe(1)
    expect((await call(winner, 'GET', '/payouts/me')).json.summary.openOwed).toBe(0)
    expect((await call(winner, 'GET', '/payouts/me')).json.summary.weekOwed).toBe(2000) // still counted in the week
  })

  it('search, repeat-last-order lookup, archive', async () => {
    expect((await call('owner', 'GET', '/orders?q=candy')).json.orders).toHaveLength(1)
    expect((await call('owner', 'GET', '/orders?q=%25')).json.orders).toHaveLength(0) // % is escaped, not a wildcard
    const c = (await call('owner', 'GET', '/customers?q=0101')).json.customers
    expect(c[0]).toMatchObject({ address: '1 Candy Ln' })
    expect(c[0].items[0]).toMatchObject({ id: 2, qty: 3 })
    expect((await call('owner', 'POST', `/orders/${orderId}/archive`, { archived: true })).status).toBe(200)
    expect((await call('owner', 'GET', '/orders')).json.orders.map((o: any) => o.id)).not.toContain(orderId)
    expect((await call('owner', 'GET', '/orders?archived=1')).json.orders.map((o: any) => o.id)).toContain(orderId)
  })

  it('menu admin: rename, price, image validation, image is served safely', async () => {
    const r = await call('owner', 'PUT', '/admin/menu/6', { name: 'Amorade!', priceCents: 450 })
    expect(r.json.item).toMatchObject({ name: 'Amorade!', priceCents: 450 })
    await call('owner', 'PUT', '/admin/menu/6', { name: 'Amorade', priceCents: 300 })
    expect((await call('owner', 'PUT', '/admin/menu/1', { image: 'data:image/svg+xml;base64,PHN2Zz4=' })).status).toBe(400)
    expect((await call('owner', 'PUT', '/admin/menu/1', { image: 'data:image/png;base64,AAAA' })).status).toBe(400) // wrong magic bytes
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const ok = await call('owner', 'PUT', '/admin/menu/1', { image: png })
    expect(ok.json.item.imageUrl).toMatch(/^\/api\/menu-image\/1\?v=1$/)
    const img = await fetch(base + ok.json.item.imageUrl)
    expect(img.headers.get('content-type')).toBe('image/png')
    expect(img.headers.get('x-content-type-options')).toBe('nosniff')
  })


  // ---------------------------------------------------------------- stock
  let eveId = '', danId = ''
  const stockOf = async (who: string, itemId: number, holder: string) => {
    const r = await call(who, 'GET', '/stock')
    const it = r.json.items.find((i: any) => i.itemId === itemId && !i.custom)
    return holder === 'store' ? it.store : (it.byDriver[holder] ?? 0)
  }

  it('real menu: Other asks for a name, retired placeholders stay hidden', async () => {
    const menu = (await call(null, 'GET', '/menu')).json.items
    expect(menu.find((i: any) => i.name === 'Other').allowNote).toBe(true)
    expect(menu.some((i: any) => i.letter.length === 1)).toBe(false)
    expect((await call('owner', 'GET', '/admin/menu')).json.items).toHaveLength(7)
    const users = (await call('owner', 'GET', '/users')).json.users
    eveId = users.find((u: any) => u.username === 'eve').id
    danId = users.find((u: any) => u.username === 'dan').id
  })

  it('stock: only the owner touches the store; drivers only touch their own', async () => {
    for (const [m, p, b] of [
      ['GET', '/stock', undefined],
      ['POST', '/stock/adjust', { holder: 'store', itemId: 1, delta: 1 }],
      ['POST', '/stock/adjust', { holder: danId, itemId: 1, delta: 1 }],
      ['POST', '/stock/transfer', { from: 'store', to: danId, items: [{ itemId: 1, qty: 1 }] }],
      ['PUT', '/stock/settings', { lowThreshold: 1 }],
    ] as const) expect((await call('eve', m, p, b)).status, `${m} ${p}`).toBe(403)
    expect((await call(null, 'GET', '/stock')).status).toBe(401)
    expect((await call('owner', 'GET', '/stock/me')).status).toBe(403)
    // a driver with no holder given adjusts their own stock, never the store
    expect((await call('eve', 'POST', '/stock/adjust', { itemId: 1, delta: 2 })).json.qty).toBe(2)
    expect(await stockOf('owner', 1, 'store')).toBe(0)
    expect((await call('eve', 'POST', '/stock/adjust', { itemId: 1, delta: -5 })).status).toBe(409) // cannot go below zero by hand
    expect((await call('eve', 'POST', '/stock/adjust', { itemId: 1, set: 0 })).json.qty).toBe(0)
    expect((await call('owner', 'POST', '/stock/adjust', { holder: 'store', itemId: 1 })).status).toBe(400)
    expect((await call('owner', 'POST', '/stock/adjust', { holder: 'store', itemId: 7, delta: 1 })).status).toBe(400) // Other needs a name
  })

  it('stock: owner fills the store; concurrent taps never lose an update', async () => {
    expect((await call('owner', 'POST', '/stock/adjust', { holder: 'store', itemId: 1, set: 20 })).json.qty).toBe(20)
    expect((await call('owner', 'POST', '/stock/adjust', { holder: 'store', itemId: 2, set: 10 })).json.qty).toBe(10)
    await call('owner', 'POST', '/stock/adjust', { holder: 'store', itemId: 7, name: 'Strawberry Tart', delta: 4 })
    const taps = await Promise.all(Array.from({ length: 20 }, () => call('owner', 'POST', '/stock/adjust', { holder: 'store', itemId: 1, delta: 1 })))
    expect(taps.every((t) => t.status === 200)).toBe(true)
    expect(await stockOf('owner', 1, 'store')).toBe(40)
    const ov = (await call('owner', 'GET', '/stock')).json
    const tart = ov.items.find((i: any) => i.custom)
    expect(tart).toMatchObject({ name: 'Strawberry Tart', store: 4, total: 4 })
  })

  it('stock: give to driver / take back are all-or-nothing and race-safe', async () => {
    const give = (to: string, items: any[]) => call('owner', 'POST', '/stock/transfer', { from: 'store', to, items })
    expect((await give(eveId, [{ itemId: 1, qty: 5 }, { itemId: 2, qty: 2 }])).status).toBe(200)
    expect(await stockOf('owner', 1, eveId)).toBe(5)
    expect(await stockOf('owner', 1, 'store')).toBe(35)
    // one line too big => nothing moves at all
    const bad = await give(eveId, [{ itemId: 1, qty: 1 }, { itemId: 2, qty: 999 }])
    expect(bad.status).toBe(409)
    expect(await stockOf('owner', 1, 'store')).toBe(35)
    expect(await stockOf('owner', 1, eveId)).toBe(5)
    // store has 8 of item 2: three parallel gives of 3 => exactly two succeed, never negative
    const race = await Promise.all([1, 2, 3].map(() => give(danId, [{ itemId: 2, qty: 3 }])))
    expect(race.map((r) => r.status).sort()).toEqual([200, 200, 409])
    expect(await stockOf('owner', 2, 'store')).toBe(2)
    // take back from the driver; cannot take back more than they carry
    expect((await call('owner', 'POST', '/stock/transfer', { from: eveId, to: 'store', items: [{ itemId: 1, qty: 1 }] })).status).toBe(200)
    expect(await stockOf('owner', 1, 'store')).toBe(36)
    expect((await call('owner', 'POST', '/stock/transfer', { from: eveId, to: 'store', items: [{ itemId: 1, qty: 50 }] })).status).toBe(409)
    expect((await call('owner', 'POST', '/stock/transfer', { from: 'store', to: 'store', items: [{ itemId: 1, qty: 1 }] })).status).toBe(400)
    // driver sees their own stock
    const mine = (await call('eve', 'GET', '/stock/me')).json.items
    expect(mine.find((i: any) => i.itemId === 1).qty).toBe(4)
    expect(mine.find((i: any) => i.itemId === 2).qty).toBe(2)
    // driver adjusts own stock
    expect((await call('eve', 'POST', '/stock/adjust', { itemId: 1, delta: 3 })).json.qty).toBe(7)
  })

  it('stock: delivering subtracts from the driver once, goes negative visibly, and reverts', async () => {
    const mk = await call('owner', 'POST', '/orders', {
      customerName: 'Stock Test', address: '9 Cannoli Rd', amountCents: 2000, driverCutCents: 300,
      items: [{ id: 1, qty: 2 }, { id: 7, qty: 1, note: 'strawberry  TART' }],
    })
    const o = mk.json.order
    expect(o.items.map((i: any) => i.sku)).toEqual(['i1', 'o:strawberry tart'])
    expect((await call('eve', 'POST', `/orders/${o.id}/take`)).status).toBe(200)
    const d = await call('eve', 'POST', `/orders/${o.id}/deliver`)
    expect(d.status).toBe(200)
    expect(d.json.negative).toHaveLength(1)
    expect(d.json.negative[0].qty).toBe(-1)
    expect(await stockOf('owner', 1, eveId)).toBe(5) // 7 - 2
    // double tap / second request does nothing
    expect((await call('eve', 'POST', `/orders/${o.id}/deliver`)).status).toBe(409)
    expect(await stockOf('owner', 1, eveId)).toBe(5)
    // "Other" is tracked by the typed name: the driver is at -1 and the owner can see it
    const ov = (await call('owner', 'GET', '/stock')).json
    expect(ov.items.find((i: any) => i.custom).byDriver[eveId]).toBe(-1)
    expect(ov.items.find((i: any) => i.custom).total).toBe(3) // 4 in store + (-1) with eve
    // two simultaneous deliver taps on a fresh order deduct exactly once
    const o2 = (await call('owner', 'POST', '/orders', { items: [{ id: 1, qty: 1 }] })).json.order
    await call('eve', 'POST', `/orders/${o2.id}/take`)
    const dd = await Promise.all([call('eve', 'POST', `/orders/${o2.id}/deliver`), call('eve', 'POST', `/orders/${o2.id}/deliver`)])
    expect(dd.map((r) => r.status).sort()).toEqual([200, 409])
    expect(await stockOf('owner', 1, eveId)).toBe(4)
    // delivered orders: items are locked; un-delivering gives the sweets back
    expect((await call('owner', 'PATCH', `/orders/${o2.id}`, { items: [{ id: 2, qty: 1 }] })).status).toBe(400)
    expect((await call('owner', 'PATCH', `/orders/${o2.id}`, { status: 'taken' })).status).toBe(200)
    expect(await stockOf('owner', 1, eveId)).toBe(5)
    expect((await call('owner', 'PATCH', `/orders/${o2.id}`, { status: 'delivered' })).status).toBe(200)
    expect(await stockOf('owner', 1, eveId)).toBe(4)
    expect((await call('owner', 'DELETE', `/orders/${o2.id}`)).status).toBe(200) // deleting a delivered order returns its sweets
    expect(await stockOf('owner', 1, eveId)).toBe(5)
    // orders from before stock tracking (no sku on the items) never touch stock
    const { getDb } = await import('../lib/db.js')
    const { orders } = await import('../lib/schema.js')
    const [legacy] = await getDb().insert(orders).values({ source: 'customer', status: 'taken', driverId: eveId, driverName: 'Eve', items: [{ id: 1, name: 'Sweet A', qty: 9 }] }).returning()
    expect((await call('eve', 'POST', `/orders/${legacy.id}/deliver`)).status).toBe(200)
    expect(await stockOf('owner', 1, eveId)).toBe(5)
  })

  it('stock: history log and overview agree with what happened', async () => {
    const log = (await call('owner', 'GET', `/stock/log?holder=${eveId}`)).json.log
    const actions = new Set(log.map((l: any) => l.action))
    for (const a of ['add', 'remove', 'transfer', 'deliver', 'revert']) expect(actions.has(a), a).toBe(true)
    const del = log.find((l: any) => l.action === 'deliver' && l.sku === 'i1' && l.qty === 2)
    expect(del).toMatchObject({ fromName: 'Eve', qty: 2, actorName: 'Eve' })
    expect(log.find((l: any) => l.action === 'transfer' && l.qty === 5)).toMatchObject({ fromName: 'Store', toName: 'Eve', actorName: 'Boss' })
    // a driver sees only their own history
    const dlog = (await call('eve', 'GET', '/stock/log?holder=store')).json.log
    expect(dlog.length).toBeGreaterThan(0)
    expect(dlog.every((l: any) => l.fromHolder === eveId || l.toHolder === eveId)).toBe(true)
    // date filter (store time zone)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    expect((await call('owner', 'GET', `/stock/log?from=${today}&to=${today}`)).json.log.length).toBeGreaterThan(0)
    expect((await call('owner', 'GET', '/stock/log?from=2000-01-01&to=2000-01-02')).json.log).toHaveLength(0)
    expect((await call('owner', 'GET', '/stock/log?from=nonsense')).status).toBe(400)
    // overview totals = store + all drivers, per sweet
    const ov = (await call('owner', 'GET', '/stock')).json
    for (const it of ov.items) expect(it.total).toBe(it.store + Object.values<number>(it.byDriver).reduce((a, b) => a + b, 0))
  })

  it('stock: low-stock threshold is owner-editable and flags the overview', async () => {
    expect((await call('owner', 'GET', '/stock')).json.threshold).toBe(5)
    expect((await call('owner', 'GET', '/stock')).json.low.map((l: any) => l.name)).toContain('Key Lime Pie') // 2 left in the store
    expect((await call('owner', 'PUT', '/stock/settings', { lowThreshold: 1 })).json.threshold).toBe(1)
    expect((await call('owner', 'GET', '/stock')).json.low.map((l: any) => l.name)).not.toContain('Key Lime Pie')
    expect((await call('owner', 'PUT', '/stock/settings', { lowThreshold: 5 })).status).toBe(200)
  })

  it('drivers add their own deliveries: assigned to them, no split, stock goes down', async () => {
    expect((await call('dan', 'POST', '/orders', {})).status).toBe(400) // empty
    const r = await call('dan', 'POST', '/orders', {
      customerName: 'Neighbor', address: '9 Fudge Ave', items: [{ id: 1, qty: 1 }], amountCents: 900, paymentMethod: 'cash',
      driverCutCents: 900, ownerOwedCents: 0, status: 'delivered', driverId: '00000000-0000-4000-8000-000000000000',
    })
    expect(r.status).toBe(200)
    const o = r.json.order
    expect(o).toMatchObject({ source: 'driver', status: 'taken', driverName: 'Dan', amountCents: 900, paymentMethod: 'cash', driverCutCents: null, ownerOwedCents: null })
    // not offered to other drivers; owner sees it
    expect((await call('eve', 'GET', '/orders')).json.orders.map((x: any) => x.id)).not.toContain(o.id)
    expect((await call('owner', 'GET', '/orders')).json.orders.map((x: any) => x.id)).toContain(o.id)
    const before = (await call('dan', 'GET', '/stock/me')).json.items.find((i: any) => i.sku === 'i1')?.qty ?? 0
    expect((await call('dan', 'POST', `/orders/${o.id}/deliver`)).status).toBe(200)
    expect((await call('dan', 'GET', '/stock/me')).json.items.find((i: any) => i.sku === 'i1').qty).toBe(before - 1)
    // owner sets the split afterwards
    const p = await call('owner', 'PATCH', `/orders/${o.id}`, { driverCutCents: 300 })
    expect(p.json.order).toMatchObject({ driverCutCents: 300, ownerOwedCents: 600 })
  })

  it('Earnings: delivered orders wait with their date until the driver clears them', async () => {
    const me = (await call('dan', 'GET', '/payouts/me')).json
    expect(me.open.length).toBeGreaterThan(0)
    expect(me.open.every((o: any) => o.status === 'delivered' && o.deliveredAt && !o.settledAt)).toBe(true)
    const first = me.open[0]
    expect((await call('eve', 'POST', `/orders/${first.id}/clear`)).status).toBe(409) // not hers
    expect((await call('dan', 'POST', `/orders/${first.id}/clear`)).json.order).toMatchObject({ settledBy: 'Dan' })
    expect((await call('dan', 'POST', `/orders/${first.id}/clear`)).status).toBe(409) // already cleared
    expect((await call('dan', 'GET', '/payouts/me')).json.open.map((o: any) => o.id)).not.toContain(first.id)
    await call('dan', 'POST', '/payouts/me/clear')
    expect((await call('dan', 'GET', '/payouts/me')).json.open).toHaveLength(0)
    expect((await call('dan', 'POST', '/payouts/me/clear', undefined)).status).toBe(200)
  })

  it('quantities go in steps of 0.5 for orders and stock', async () => {
    // eve sets her Éclair (item 3) stock to 4, then logs a delivery of 1.5
    expect((await call('eve', 'POST', '/stock/adjust', { itemId: 3, set: 4 })).json.qty).toBe(4)
    expect((await call('eve', 'POST', '/stock/adjust', { itemId: 3, delta: 0.25 })).status).toBe(400) // not a half step
    expect((await call('eve', 'POST', '/stock/adjust', { itemId: 3, delta: -0.5 })).json.qty).toBe(3.5)
    expect((await call('eve', 'POST', '/orders', { address: '5 Half Way', items: [{ id: 3, qty: 1.3 }] })).status).toBe(400)
    const r = await call('eve', 'POST', '/orders', { address: '5 Half Way', items: [{ id: 3, qty: 1.5 }, { id: 3, qty: 1 }] })
    expect(r.json.order.items[0]).toMatchObject({ sku: 'i3', qty: 2.5 }) // merged
    expect((await call('eve', 'POST', `/orders/${r.json.order.id}/deliver`)).status).toBe(200)
    expect((await call('eve', 'GET', '/stock/me')).json.items.find((i: any) => i.sku === 'i3').qty).toBe(1)
    const log = (await call('owner', 'GET', '/stock/log')).json
    expect(JSON.stringify(log)).toContain('2.5')
  })

  it('force logout, password reset and removal kill sessions', async () => {
    const users = (await call('owner', 'GET', '/users')).json.users
    const dan = users.find((u: any) => u.username === 'dan')
    expect((await call('dan', 'GET', '/auth/me')).status).toBe(200)
    await call('owner', 'POST', `/users/${dan.id}/logout`)
    expect((await call('dan', 'GET', '/auth/me')).status).toBe(401)
    await call('dan', 'POST', '/auth/login', { username: 'dan', password: 'driverpass1' })
    await call('owner', 'POST', `/users/${dan.id}/password`, { password: 'brandnewpass1' })
    expect((await call('dan', 'GET', '/auth/me')).status).toBe(401)
    expect((await call('dan', 'POST', '/auth/login', { username: 'dan', password: 'driverpass1' })).status).toBe(401)
    expect((await call('dan', 'POST', '/auth/login', { username: 'dan', password: 'brandnewpass1' })).status).toBe(200)
    const before = await stockOf('owner', 2, 'store')
    const danHad = await stockOf('owner', 2, dan.id) // may include a delivery from the earlier claim-race test
    await call('owner', 'DELETE', `/users/${dan.id}`)
    expect(await stockOf('owner', 2, 'store')).toBe(before + danHad) // what dan was carrying went back to the store
    expect((await call('dan', 'GET', '/auth/me')).status).toBe(401)
    expect((await call('dan', 'POST', '/auth/login', { username: 'dan', password: 'brandnewpass1' })).status).toBe(401)
    // the owner cannot be removed through the drivers endpoints
    const owner = (await call('owner', 'GET', '/auth/me')).json.user
    expect((await call('owner', 'DELETE', `/users/${owner.id}`)).status).toBe(404)
    expect((await call('owner', 'POST', '/auth/logout')).status).toBe(200)
    expect((await call('owner', 'GET', '/auth/me')).status).toBe(401)
  })

  it('login is rate limited', async () => {
    const codes: number[] = []
    for (let i = 0; i < 10; i++) codes.push((await call(null, 'POST', '/auth/login', { username: 'boss', password: 'wrong' + i })).status)
    expect(codes).toContain(429)
  })
})
