// Lost the owner password? Run with OWNER_PASSWORD (and optionally OWNER_USERNAME) set:
//   OWNER_PASSWORD='new-strong-password' npm run db:reset-owner
import { eq } from 'drizzle-orm'
import { getDb } from '../lib/db.js'
import { sessions, users } from '../lib/schema.js'
import { hashPassword } from '../lib/security.js'

const password = process.env.OWNER_PASSWORD
if (!password || password.length < 10) {
  console.error('Set OWNER_PASSWORD (10+ characters).')
  process.exit(1)
}
const db = getDb()
const [owner] = await db.select().from(users).where(eq(users.role, 'owner')).limit(1)
if (!owner) {
  console.error('No owner exists yet — run `npm run db:seed` instead.')
  process.exit(1)
}
await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, owner.id))
await db.delete(sessions).where(eq(sessions.userId, owner.id))
console.log(`password reset for "${owner.username}"; existing sessions were signed out`)
process.exit(0)
