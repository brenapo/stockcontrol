export type Role = 'owner' | 'driver'
export type Status = 'new' | 'taken' | 'delivered'
export type Pay = 'cash' | 'zelle' | 'pending'

export type User = { id: string; username: string; name: string; role: Role; phone: string | null }
export type MenuItem = { id: number; letter: string; name: string; priceCents: number; active: boolean; allowNote: boolean; imageUrl: string; customImage: boolean }
export type OrderItem = { id?: number; sku?: string; name: string; qty: number; priceCents?: number | null; note?: string }

export type Order = {
  id: string
  code: number
  status: Status
  source: 'customer' | 'owner' | 'driver'
  customerName: string | null
  phone: string | null
  address: string | null
  notes: string | null
  itemsText: string | null
  items: OrderItem[]
  amountCents: number | null
  paymentMethod: Pay | null
  driverCutCents: number | null
  ownerOwedCents: number | null
  driverId: string | null
  driverName: string | null
  takenAt: string | null
  deliveredAt: string | null
  settledAt: string | null
  settledBy?: string | null
  archivedAt: string | null
  createdAt: string
}

export type Totals = {
  dayKept: number; dayOwed: number; dayCount: number
  weekKept: number; weekOwed: number; weekCount: number
  openKept: number; openOwed: number; openCount: number
}
export type DriverTotals = Totals & { driverId: string; driverName: string }

export type StockItem = { sku: string; name: string; itemId: number; imageUrl: string; custom: boolean }
export type OwnerStockItem = StockItem & { store: number; byDriver: Record<string, number>; total: number; low: boolean }
export type OwnerStock = {
  threshold: number
  drivers: { id: string; name: string }[]
  items: OwnerStockItem[]
  otherItemId: number | null
  low: { sku: string; name: string; store: number }[]
}
export type MyStock = { items: (StockItem & { qty: number })[]; otherItemId: number | null }
export type LogEntry = {
  id: number; at: string; action: 'add' | 'remove' | 'transfer' | 'deliver' | 'revert'
  actorName: string | null; fromHolder: string | null; fromName: string | null; toHolder: string | null; toName: string | null
  sku: string; name: string; qty: number; orderId: string | null; note: string | null
}
