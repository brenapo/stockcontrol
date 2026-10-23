export type Role = 'owner' | 'driver'
export type Status = 'new' | 'taken' | 'delivered'
export type Pay = 'cash' | 'zelle'

export type User = { id: string; username: string; name: string; role: Role; phone: string | null }
export type MenuItem = { id: number; letter: string; name: string; priceCents: number; active: boolean; imageUrl: string; customImage: boolean }
export type OrderItem = { id?: number; name: string; qty: number; priceCents?: number | null }

export type Order = {
  id: string
  code: number
  status: Status
  source: 'customer' | 'owner'
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
  archivedAt: string | null
  createdAt: string
}

export type Totals = {
  dayKept: number; dayOwed: number; dayCount: number
  weekKept: number; weekOwed: number; weekCount: number
  openKept: number; openOwed: number; openCount: number
}
export type DriverTotals = Totals & { driverId: string; driverName: string }
