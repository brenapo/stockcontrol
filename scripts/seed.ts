// Idempotent: creates the owner account (if none exists) and the 26 placeholder sweets (if the menu is empty).
import { eq } from 'drizzle-orm'
import { getDb } from '../lib/db.js'
import { menuItems, users } from '../lib/schema.js'
import { hashPassword } from '../lib/security.js'

if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
  console.warn('db:seed skipped — DATABASE_URL is not set')
  process.exit(0)
}
const db = getDb()

const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'owner')).limit(1)
if (!owner) {
  const password = process.env.OWNER_PASSWORD
  if (!password || password.length < 10) {
    console.warn('No owner yet: set OWNER_PASSWORD (10+ chars) and re-run `npm run db:seed` to create the owner login.')
  } else {
    await db.insert(users).values({
      username: (process.env.OWNER_USERNAME ?? 'owner').trim().toLowerCase(),
      name: process.env.OWNER_NAME ?? 'Owner',
      role: 'owner',
      passwordHash: await hashPassword(password),
    })
    console.log('owner account created')
  }
}

const existing = await db.select({ id: menuItems.id }).from(menuItems).limit(1)
if (!existing.length) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  await db.insert(menuItems).values(
    letters.map((l, i) => ({ letter: l, name: `Sweet ${l}`, priceCents: 300, sortOrder: i })),
  )
  console.log('menu seeded (26 items)')
}
process.exit(0)
