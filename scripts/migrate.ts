import { migrate as migrateNeon } from 'drizzle-orm/neon-http/migrator'
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { getDb } from '../lib/db.js'

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
if (!url) {
  console.warn('db:migrate skipped — DATABASE_URL is not set')
  process.exit(0)
}
const db = getDb()
if (/neon\.tech|neon\.build/.test(url)) await migrateNeon(db, { migrationsFolder: './drizzle' })
else await migratePg(db as unknown as ReturnType<typeof drizzle>, { migrationsFolder: './drizzle' })
console.log('migrations applied')
process.exit(0)
