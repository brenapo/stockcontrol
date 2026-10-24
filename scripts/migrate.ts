import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'

// Migrations prefer the direct (unpooled) Neon URL when present.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL
if (!url) {
  console.warn('db:migrate skipped — DATABASE_URL is not set')
  process.exit(0)
}
const pool = new pg.Pool({ connectionString: url, max: 1 })
await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
await pool.end()
console.log('migrations applied')
