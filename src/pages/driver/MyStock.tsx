import { api } from '../../api'
import { Icon } from '../../components/Icon'
import StockHistory from '../../components/StockHistory'
import StockList from '../../components/StockList'
import { Spinner } from '../../components/ui'
import { usePoll } from '../../hooks'
import type { LogEntry, MyStock as MyStockT } from '../../types'

export default function MyStock({ data, reload }: { data?: MyStockT; reload: () => void }) {
  const { data: hist, reload: reloadHist } = usePoll(() => api<{ log: LogEntry[] }>('/stock/log'), 15_000)
  if (!data) return <Spinner />
  const negative = data.items.filter((i) => i.qty < 0)
  const changed = () => { reload(); reloadHist() }
  return (
    <div className="space-y-3">
      {negative.length > 0 && (
        <div className="flex items-center gap-2 rounded-2xl bg-red-600 px-4 py-3 font-extrabold text-white">
          <Icon name="bell" />{negative.map((n) => `${n.name} ${n.qty}`).join(' · ')}
        </div>
      )}
      <StockList holder="me" rows={data.items} otherItemId={data.otherItemId} onChanged={changed} />
      <details className="card">
        <summary className="flex cursor-pointer items-center gap-2 text-lg font-extrabold"><Icon name="clock" size={20} />History</summary>
        <div className="mt-3">{hist ? <StockHistory log={hist.log} /> : <Spinner />}</div>
      </details>
    </div>
  )
}
