import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon, type NeonHttpDatabase } from 'drizzle-orm/neon-http'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.js'

export type DB = NeonHttpDatabase<typeof schema>

let cached: DB | undefined

export function connectionString(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

/** Neon over HTTP in production; plain node-postgres for local/test databases. */
export function getDb(): DB {
  if (cached) return cached
  const url = connectionString()
  if (/neon\.tech|neon\.build/.test(url)) {
    cached = drizzleNeon(neon(url), { schema })
  } else {
    cached = drizzlePg(new pg.Pool({ connectionString: url, max: 5 }), { schema }) as unknown as DB
  }
  return cached
}

export function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[]
}
