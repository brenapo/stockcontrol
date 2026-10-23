import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { and, eq, gt, sql } from 'drizzle-orm'
import { getDb } from './db.js'
import { rateLimits, sessions, users } from './schema.js'

// ---------- passwords (scrypt) ----------
const N = 16384, R = 8, P = 1, KEYLEN = 64

function scrypt(password: string, salt: Buffer, n = N, r = R, p = P): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))),
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}

const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(KEYLEN).toString('base64')}`

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const hash = stored ?? DUMMY_HASH // constant work for unknown users
  const [alg, n, r, p, salt, key] = hash.split('$')
  if (alg !== 'scrypt') return false
  const expected = Buffer.from(key, 'base64')
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), +n, +r, +p)
  return timingSafeEqual(actual, expected) && stored !== undefined
}

// ---------- sessions ----------
export const COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-sr_session' : 'sr_session'
const SESSION_DAYS = 90
const SESSION_MS = SESSION_DAYS * 24 * 3600 * 1000
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export function cookieHeader(token: string, maxAgeSec: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`
}
export const sessionCookie = (token: string) => cookieHeader(token, SESSION_DAYS * 24 * 3600)
export const clearCookie = () => cookieHeader('', 0)

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return undefined
}

export async function createSession(userId: string, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await getDb().insert(sessions).values({
    id: sha256(token),
    userId,
    userAgent: userAgent?.slice(0, 300),
    expiresAt: new Date(Date.now() + SESSION_MS),
  })
  return token
}

export type AuthUser = { id: string; username: string; name: string; role: 'owner' | 'driver'; phone: string | null }

export async function userFromToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token || token.length > 100) return null
  const db = getDb()
  const id = sha256(token)
  const [row] = await db
    .select({
      id: users.id, username: users.username, name: users.name, role: users.role, phone: users.phone,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()), sql`${users.deletedAt} is null`))
  if (!row) return null
  if (Date.now() - row.lastSeenAt.getTime() > 24 * 3600 * 1000) {
    // sliding expiry: keep phones logged in while they are used
    await db.update(sessions).set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_MS) }).where(eq(sessions.id, id))
  }
  const { lastSeenAt: _l, ...user } = row
  return user
}

export const destroySession = (token: string) => getDb().delete(sessions).where(eq(sessions.id, sha256(token)))
export const destroyUserSessions = (userId: string) => getDb().delete(sessions).where(eq(sessions.userId, userId))

// ---------- rate limiting (Postgres-backed, works across serverless instances) ----------
export async function hit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const db = getDb()
  const resetAt = new Date(Date.now() + windowSec * 1000)
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.resetAt} < now() then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql`case when ${rateLimits.resetAt} < now() then excluded.reset_at else ${rateLimits.resetAt} end`,
      },
    })
    .returning({ count: rateLimits.count })
  if (Math.random() < 0.02) {
    // opportunistic housekeeping so these tables never grow unbounded
    await db.delete(rateLimits).where(sql`${rateLimits.resetAt} < now() - interval '1 day'`)
    await db.delete(sessions).where(sql`${sessions.expiresAt} < now()`)
  }
  return row.count <= limit
}

export function clientIp(headers: Record<string, string | string[] | undefined>): string {
  const h = (k: string) => {
    const v = headers[k]
    return Array.isArray(v) ? v[0] : v
  }
  return (h('x-real-ip') ?? h('x-forwarded-for')?.split(',')[0] ?? 'unknown').trim().slice(0, 64)
}

// ---------- signed anti-bot token for the public order form ----------
function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 16) throw new Error('SESSION_SECRET must be set (16+ chars)')
  return s
}
const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url')

export function makeFormToken(): string {
  const ts = Date.now().toString()
  return `${ts}.${sign(ts)}`
}

/** Valid only if signed by us, at least `minAgeMs` old (humans take time) and not stale. */
export function checkFormToken(token: unknown, minAgeMs = 2500, maxAgeMs = 4 * 3600 * 1000): boolean {
  if (typeof token !== 'string') return false
  const [ts, sig] = token.split('.')
  if (!ts || !sig) return false
  const expected = Buffer.from(sign(ts))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false
  const age = Date.now() - Number(ts)
  return age >= minAgeMs && age <= maxAgeMs
}

// ---------- CSRF: state-changing requests must come from our own origin ----------
export function sameOrigin(headers: Record<string, string | string[] | undefined>): boolean {
  const origin = headers['origin']
  const host = headers['x-forwarded-host'] ?? headers['host']
  if (!origin) return headers['sec-fetch-site'] === undefined || headers['sec-fetch-site'] === 'same-origin' || headers['sec-fetch-site'] === 'none'
  try {
    return new URL(String(origin)).host === String(host).split(',')[0].trim()
  } catch {
    return false
  }
}
