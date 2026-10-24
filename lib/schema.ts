import { sql } from 'drizzle-orm'
import {
  boolean, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'

export type OrderItem = { id?: number; sku?: string; name: string; qty: number; priceCents?: number | null; note?: string }

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    name: text('name').notNull(),
    role: text('role', { enum: ['owner', 'driver'] }).notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_username_active').on(t.username).where(sql`${t.deletedAt} is null`)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha256 of the cookie token
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user').on(t.userId)],
)

export const menuItems = pgTable('menu_items', {
  id: serial('id').primaryKey(),
  letter: text('letter').notNull(),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull().default(0),
  imageData: text('image_data'), // uploaded photo as data URL; null = built-in sweet
  imageVersion: integer('image_version').notNull().default(0),
  active: boolean('active').notNull().default(true),
  allowNote: boolean('allow_note').notNull().default(false), // "Other": customer types which sweet
  retired: boolean('retired').notNull().default(false), // old placeholder items, kept so old data stays valid
  sortOrder: integer('sort_order').notNull().default(0),
})

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: serial('code').notNull(),
    status: text('status', { enum: ['new', 'taken', 'delivered'] }).notNull().default('new'),
    source: text('source', { enum: ['customer', 'owner'] }).notNull(),
    customerName: text('customer_name'),
    phone: text('phone'),
    address: text('address'),
    notes: text('notes'),
    itemsText: text('items_text'),
    items: jsonb('items').$type<OrderItem[]>().notNull().default([]),
    amountCents: integer('amount_cents'),
    paymentMethod: text('payment_method', { enum: ['cash', 'zelle'] }),
    driverCutCents: integer('driver_cut_cents'),
    ownerOwedCents: integer('owner_owed_cents'),
    driverId: uuid('driver_id').references(() => users.id, { onDelete: 'set null' }),
    driverName: text('driver_name'),
    takenAt: timestamp('taken_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('orders_status').on(t.status),
    index('orders_driver').on(t.driverId),
    index('orders_phone').on(t.phone),
  ],
)

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
})

export const pushSubscriptions = pgTable('push_subscriptions', {
  endpoint: text('endpoint').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ----- stock -----
// holder is 'store' or a driver's user id. sku is `i<menuItemId>` or `o:<normalised typed name>` for "Other".
export const stock = pgTable(
  'stock',
  {
    holder: text('holder').notNull(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    qty: integer('qty').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.holder, t.sku] })],
)

export const stockLog = pgTable(
  'stock_log',
  {
    id: serial('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    action: text('action', { enum: ['add', 'remove', 'transfer', 'deliver', 'revert'] }).notNull(),
    actorId: uuid('actor_id'),
    actorName: text('actor_name'),
    fromHolder: text('from_holder'),
    fromName: text('from_name'),
    toHolder: text('to_holder'),
    toName: text('to_name'),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    qty: integer('qty').notNull(), // always positive: the amount that moved
    orderId: uuid('order_id'),
    note: text('note'),
  },
  (t) => [index('stock_log_at').on(t.at), index('stock_log_from').on(t.fromHolder), index('stock_log_to').on(t.toHolder)],
)

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
