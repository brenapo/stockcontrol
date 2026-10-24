import type { LogEntry } from '../types'
import { Icon } from './Icon'

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function line(l: LogEntry): { icon: string; tone: string; text: string } {
  const what = `${l.qty}× ${l.name}`
  switch (l.action) {
    case 'add': return { icon: 'plus', tone: 'bg-mint-soft text-mint-dark', text: `${l.actorName ?? '?'} added ${what} to ${l.toName}` }
    case 'remove': return { icon: 'minus', tone: 'bg-orange-soft text-orange', text: `${l.actorName ?? '?'} removed ${what} from ${l.fromName}` }
    case 'transfer': return { icon: 'swap', tone: 'bg-sky-soft text-sky', text: `${l.actorName ?? '?'} moved ${what}: ${l.fromName} → ${l.toName}` }
    case 'deliver': return { icon: 'check', tone: 'bg-pink-soft text-pink-dark', text: `${l.fromName} delivered ${l.note ?? ''}: −${what}` }
    case 'revert': return { icon: 'refresh', tone: 'bg-grape-soft text-grape', text: `${l.note ?? 'Order'} undone: +${what} back to ${l.toName}` }
  }
}

export default function StockHistory({ log }: { log: LogEntry[] }) {
  if (!log.length) return <p className="py-8 text-center text-lg font-extrabold text-mute">No history</p>
  return (
    <ul className="space-y-2">
      {log.map((l) => {
        const v = line(l)
        return (
          <li key={l.id} className="flex items-start gap-3 rounded-2xl border-2 border-line bg-card p-3">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${v.tone}`}><Icon name={v.icon} size={18} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-base font-bold leading-snug">{v.text}</div>
              <div className="text-sm font-bold text-mute">{when(l.at)}</div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
