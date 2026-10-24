import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.js'

export type DB = NodePgDatabase<typeof schema>
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]

let cached: DB | undefined

export function connectionString(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

/**
 * Plain node-postgres. On Neon use the pooled connection string (the one Vercel injects as DATABASE_URL);
 * real transactions are required for the stock ledger.
 */
export function getDb(): DB {
  if (cached) return cached
  const pool = new pg.Pool({ connectionString: connectionString(), max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000 })
  pool.on('error', (e) => console.error('pg pool error', e.message))
  cached = drizzle(pool, { schema })
  return cached
}
