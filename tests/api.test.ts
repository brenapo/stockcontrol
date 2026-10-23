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
    const { menuItems, users } = await import('../lib/schema.js')
    const { hashPassword } = await import('../lib/security.js')
    await db.insert(users).values({ username: 'boss', name: 'Boss', role: 'owner', passwordHash: await hashPassword('correct-horse-1') })
    await db.insert(menuItems).values(['A', 'B', 'C'].map((l, i) => ({ letter: l, name: `Sweet ${l}`, priceCents: 300 + i * 100, sortOrder: i })))
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

  it('serves the public menu and nothing private', async () => {
    const r = await call(null, 'GET', '/menu')
    expect(r.json.items).toHaveLength(3)
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
      ['POST', '/orders', { amountCents: 100 }], ['PUT', '/admin/menu/1', { name: 'x' }], ['GET', '/admin/menu', undefined],
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
    expect(o.items[0]).toMatchObject({ id: 2, qty: 3, priceCents: 400 })
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
    const r = await call('owner', 'PUT', '/admin/menu/1', { name: 'Gummy', priceCents: 450 })
    expect(r.json.item).toMatchObject({ name: 'Gummy', priceCents: 450 })
    expect((await call('owner', 'PUT', '/admin/menu/1', { image: 'data:image/svg+xml;base64,PHN2Zz4=' })).status).toBe(400)
    expect((await call('owner', 'PUT', '/admin/menu/1', { image: 'data:image/png;base64,AAAA' })).status).toBe(400) // wrong magic bytes
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const ok = await call('owner', 'PUT', '/admin/menu/1', { image: png })
    expect(ok.json.item.imageUrl).toMatch(/^\/api\/menu-image\/1\?v=1$/)
    const img = await fetch(base + ok.json.item.imageUrl)
    expect(img.headers.get('content-type')).toBe('image/png')
    expect(img.headers.get('x-content-type-options')).toBe('nosniff')
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
    await call('owner', 'DELETE', `/users/${dan.id}`)
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
