import { useState } from 'react'
import { api } from '../api'
import { usePoll } from '../hooks'
import type { Order, Totals } from '../types'
import Shell from './Shell'
import Open from './driver/Open'
import Mine from './driver/Mine'
import Earnings from './driver/Earnings'

export default function Driver() {
  const [tab, setTab] = useState('open')
  const { data, error, reload } = usePoll(() => api<{ orders: Order[] }>('/orders'), 4000)
  const { data: sum, reload: reloadSum } = usePoll(() => api<{ summary: Totals }>('/payouts/me'), 15_000)
  const open = data?.orders.filter((o) => o.status === 'new') ?? []
  const mine = data?.orders.filter((o) => o.driverId && o.status === 'taken') ?? []
  const done = data?.orders.filter((o) => o.status === 'delivered') ?? []
  const refresh = () => { reload(); reloadSum() }

  return (
    <Shell
      tab={tab}
      onTab={setTab}
      tabs={[
        { id: 'open', label: 'Open', icon: 'box', badge: open.length },
        { id: 'mine', label: 'Mine', icon: 'route', badge: mine.length },
        { id: 'money', label: 'Earnings', icon: 'wallet' },
      ]}
    >
      {tab === 'open' && <Open orders={data ? open : undefined} offline={!!error && !data} onChange={refresh} onTaken={() => setTab('mine')} />}
      {tab === 'mine' && <Mine orders={data ? mine : undefined} done={done} onChange={refresh} />}
      {tab === 'money' && <Earnings summary={sum?.summary} />}
    </Shell>
  )
}
