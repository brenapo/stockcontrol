import { Icon } from './Icon'
import { smsUrl, whatsappUrl, intlDigits, mapsUrl } from '../contact'
import { money, summary, timeAgo } from '../format'
import type { Order, Status } from '../types'

const STATUS: Record<Status, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-pink-soft text-pink-dark' },
  taken: { label: 'Taken', cls: 'bg-sky-soft text-sky' },
  delivered: { label: 'Delivered', cls: 'bg-mint-soft text-mint-dark' },
}

export function StatusChip({ o }: { o: Order }) {
  const s = STATUS[o.status]
  return (
    <span className={`chip ${s.cls}`}>
      {o.status === 'taken' && o.driverName ? `Taken · ${o.driverName}` : o.status === 'delivered' && o.driverName ? `Delivered · ${o.driverName}` : s.label}
    </span>
  )
}

export function ContactButtons({ phone }: { phone: string | null }) {
  if (!intlDigits(phone)) return null
  return (
    <div className="grid grid-cols-2 gap-2">
      <a className="btn btn-sm btn-sky" href={smsUrl(phone!)}><Icon name="sms" size={20} />SMS</a>
      <a className="btn btn-sm btn-mint" href={whatsappUrl(phone!)} target="_blank" rel="noopener noreferrer"><Icon name="whatsapp" size={20} />WhatsApp</a>
    </div>
  )
}

export function MapsButton({ address }: { address: string | null }) {
  if (!address) return null
  return (
    <a className="btn btn-sm btn-ghost" href={mapsUrl(address)} target="_blank" rel="noopener noreferrer">
      <Icon name="pin" size={20} />Maps
    </a>
  )
}

export function Money({ o }: { o: Order }) {
  const hasAny = o.amountCents != null || o.paymentMethod || o.driverCutCents != null || o.ownerOwedCents != null
  if (!hasAny) return null
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <Cell label="Collect" tone={o.paymentMethod === 'pending' ? 'bg-orange-soft' : 'bg-sun-soft'} value={money(o.amountCents)} sub={o.paymentMethod ? (o.paymentMethod === 'zelle' ? 'Zelle' : o.paymentMethod === 'pending' ? 'Pending' : 'Cash') : undefined} icon={o.paymentMethod === 'zelle' ? 'bank' : o.paymentMethod === 'pending' ? 'clock' : 'cash'} />
      <Cell label="You keep" tone="bg-mint-soft" value={money(o.driverCutCents)} />
      <Cell label="Pass to owner" tone="bg-grape-soft" value={money(o.ownerOwedCents)} />
    </div>
  )
}

function Cell({ label, value, tone, sub, icon }: { label: string; value: string; tone: string; sub?: string; icon?: string }) {
  return (
    <div className={`rounded-2xl px-1 py-2 ${tone}`}>
      <div className="text-[11px] font-extrabold uppercase leading-tight text-mute">{label}</div>
      <div className="text-xl font-black">{value}</div>
      {sub && <div className="flex items-center justify-center gap-1 text-xs font-extrabold text-mute">{icon && <Icon name={icon} size={14} />}{sub}</div>}
    </div>
  )
}

export function OrderBody({ o, showPhone = true }: { o: Order; showPhone?: boolean }) {
  const items = summary(o)
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-black text-mute">#{o.code}</span>
        <StatusChip o={o} />
        {o.source === 'driver' && <span className="chip bg-sun-soft text-ink">Driver's customer</span>}
        <span className="ml-auto text-sm font-bold text-mute">{timeAgo(o.createdAt)}</span>
      </div>
      {o.customerName && <div className="text-xl font-black leading-tight">{o.customerName}</div>}
      {o.address && <div className="flex gap-1.5 text-lg font-bold leading-snug"><Icon name="pin" className="mt-1 shrink-0 text-pink" size={20} />{o.address}</div>}
      {items && <div className="flex gap-1.5 text-base"><Icon name="cart" className="mt-0.5 shrink-0 text-mute" size={20} />{items}</div>}
      {o.notes && <div className="rounded-xl bg-orange-soft px-3 py-2 text-base">{o.notes}</div>}
      {showPhone && o.phone && <div className="flex items-center gap-1.5 text-base font-bold text-mute"><Icon name="phone" size={18} />{o.phone}</div>}
    </div>
  )
}
