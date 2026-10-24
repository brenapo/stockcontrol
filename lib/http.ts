import type { IncomingMessage, ServerResponse } from 'node:http'
import { ZodError } from 'zod'
import { clientIp, readCookie, COOKIE_NAME, sameOrigin, userFromToken, type AuthUser } from './security.js'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export type Req = IncomingMessage & { body?: unknown; query?: Record<string, unknown> }
export type Res = ServerResponse

export type Ctx = {
  req: Req
  res: Res
  user: AuthUser | null
  body: Record<string, unknown>
  params: string[]
  query: URLSearchParams
  ip: string
}

export type Access = 'public' | 'user' | 'owner' | 'driver' | 'shop' | 'shopOrUser'
// The public customer page is OFF unless PUBLIC_ORDERS=true: then 'shop' routes 404 and 'shopOrUser' routes need a login.
export const publicOrdersOn = () => process.env.PUBLIC_ORDERS === 'true'
export type Route = { method: string; pattern: RegExp; access: Access; handler: (c: Ctx) => Promise<unknown> | unknown }

export function json(res: Res, status: number, data: unknown, headers: Record<string, string | string[]> = {}) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(JSON.stringify(data))
}

export async function dispatch(routes: Route[], req: Req, res: Res): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://x')
    // On Vercel every /api/* request is rewritten to the single function with the original path in `__path`;
    // locally (and in tests) the original /api/... URL arrives as is.
    const rewritten = url.searchParams.get('__path')
    const path = rewritten !== null ? `/${rewritten}`.replace(/\/+$/, '') || '/' : url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/'
    const method = (req.method ?? 'GET').toUpperCase()

    let matched: { route: Route; params: string[] } | undefined
    let pathExists = false
    for (const route of routes) {
      const m = route.pattern.exec(path)
      if (!m) continue
      pathExists = true
      if (route.method === method) { matched = { route, params: m.slice(1).map(decodeURIComponent) }; break }
    }
    if (!matched) throw new HttpError(pathExists ? 405 : 404, pathExists ? 'Method not allowed' : 'Not found')

    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req.headers)) throw new HttpError(403, 'Forbidden')

    const { route, params } = matched
    const access = route.access === 'shop' ? (publicOrdersOn() ? 'public' : null)
      : route.access === 'shopOrUser' ? (publicOrdersOn() ? 'public' : 'user')
      : route.access
    if (access === null) throw new HttpError(404, 'Not found')
    let user: AuthUser | null = null
    if (access !== 'public') {
      user = await userFromToken(readCookie(req.headers.cookie, COOKIE_NAME))
      if (!user) throw new HttpError(401, 'Please log in')
      if (access === 'owner' && user.role !== 'owner') throw new HttpError(403, 'Owner only')
      if (access === 'driver' && user.role !== 'driver') throw new HttpError(403, 'Drivers only')
    }
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {}
    const result = await route.handler({ req, res, user, body, params, query: url.searchParams, ip: clientIp(req.headers) })
    if (!res.writableEnded) json(res, 200, result ?? { ok: true })
  } catch (e) {
    if (res.writableEnded) return
    if (e instanceof HttpError) return json(res, e.status, { error: e.message })
    if (e instanceof ZodError) return json(res, 400, { error: e.issues[0]?.message ?? 'Invalid input' })
    console.error(e)
    json(res, 500, { error: 'Something went wrong' })
  }
}

export const rt = (method: string, pattern: RegExp, access: Access, handler: Route['handler']): Route => ({ method, pattern, access, handler })
