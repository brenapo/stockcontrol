import { eq, inArray } from 'drizzle-orm'
import webpush from 'web-push'
import { getDb } from './db.js'
import { pushSubscriptions, users, type OrderItem } from './schema.js'
import { escapeHtml, money } from './util.js'

type OrderLike = {
  code: number
  customerName: string | null
  address: string | null
  itemsText: string | null
  items: OrderItem[]
  amountCents: number | null
  paymentMethod: 'cash' | 'zelle' | null
  driverName?: string | null
}

export function itemsSummary(o: Pick<OrderLike, 'items' | 'itemsText'>): string {
  const parts = o.items.map((i) => `${i.qty}× ${i.name}`)
  if (o.itemsText) parts.push(o.itemsText)
  return parts.join(', ')
}

export async function telegram(html: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // never fail an order because Telegram is down
  }
}

export function orderMessage(o: OrderLike, title: string): string {
  const lines = [`🍭 <b>${escapeHtml(title)} #${o.code}</b>`]
  if (o.customerName) lines.push(`👤 ${escapeHtml(o.customerName)}`)
  if (o.address) lines.push(`📍 ${escapeHtml(o.address)}`)
  const items = itemsSummary(o)
  if (items) lines.push(`🛒 ${escapeHtml(items)}`)
  const pay = [o.amountCents != null ? money(o.amountCents) : '', o.paymentMethod ? (o.paymentMethod === 'zelle' ? 'Zelle' : 'Cash') : '']
    .filter(Boolean).join(' · ')
  if (pay) lines.push(`💵 ${pay}`)
  if (o.driverName) lines.push(`🚗 ${escapeHtml(o.driverName)}`)
  return lines.join('\n')
}

export const notifyNewOrder = (o: OrderLike) => telegram(orderMessage(o, 'New order'))

export async function notifyStatus(o: OrderLike, kind: 'taken' | 'delivered'): Promise<void> {
  if (process.env.TELEGRAM_NOTIFY_STATUS === 'false') return
  await telegram(orderMessage(o, kind === 'taken' ? '🚗 Taken' : '✅ Delivered'))
}

// ---------- web push ----------
let vapidReady: boolean | undefined
function setupVapid(): boolean {
  if (vapidReady !== undefined) return vapidReady
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = process.env
  vapidReady = !!(pub && priv && subject)
  if (vapidReady) webpush.setVapidDetails(subject!, pub!, priv!)
  return vapidReady
}

export async function push(audience: 'all' | 'owner', payload: { title: string; body?: string; url?: string; tag?: string }): Promise<void> {
  if (!setupVapid()) return
  const db = getDb()
  const subs = await db
    .select({ s: pushSubscriptions, role: users.role })
    .from(pushSubscriptions)
    .innerJoin(users, eq(users.id, pushSubscriptions.userId))
  const targets = subs.filter((r) => audience === 'all' || r.role === 'owner')
  const dead: string[] = []
  await Promise.all(
    targets.map(async ({ s }) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 3600, timeout: 5000 },
        )
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) dead.push(s.endpoint)
      }
    }),
  )
  if (dead.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, dead))
}

export const notifyLowStock = (name: string, qty: number, threshold: number) =>
  telegram(`⚠️ <b>Low stock</b>\n${escapeHtml(name)}: <b>${qty}</b> left in the store (alert at ${threshold} or less)`)
