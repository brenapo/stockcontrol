import { useState } from 'react'
import { takeShortcut } from '../shortcut'
import { api } from '../api'
import { usePoll } from '../hooks'
import type { MenuItem, MyStock as MyStockT, Order, Totals } from '../types'
import Shell from './Shell'
import Open from './driver/Open'
import Mine from './driver/Mine'
import Earnings from './driver/Earnings'
import MyStock from './driver/MyStock'

export default function Driver() {
  const [go] = useState(takeShortcut)
  const [tab, setTab] = useState(go ? 'mine' : 'open')
  const { data, error, reload } = usePoll(() => api<{ orders: Order[] }>('/orders'), 4000)
  const { data: sum, reload: reloadSum } = usePoll(() => api<{ summary: Totals }>('/payouts/me'), 15_000)
  const { data: stock, reload: reloadStock } = usePoll(() => api<MyStockT>('/stock/me'), 8000)
  const { data: menuData } = usePoll(() => api<{ items: MenuItem[] }>('/menu'), 300_000)
  const open = data?.orders.filter((o) => o.status === 'new') ?? []
  const mine = data?.orders.filter((o) => o.driverId && o.status === 'taken') ?? []
  const done = data?.orders.filter((o) => o.status === 'delivered') ?? []
  const refresh = () => { reload(); reloadSum(); reloadStock() }
  const neg = stock?.items.filter((i) => i.qty < 0).length

  return (
    <Shell
      tab={tab}
      onTab={setTab}
      tabs={[
        { id: 'open', label: 'Open', icon: 'box', badge: open.length },
        { id: 'mine', label: 'Mine', icon: 'route', badge: mine.length },
        { id: 'stock', label: 'My stock', icon: 'layers', badge: neg },
        { id: 'money', label: 'Earnings', icon: 'wallet' },
      ]}
    >
      {tab === 'open' && <Open orders={data ? open : undefined} offline={!!error && !data} onChange={refresh} onTaken={() => setTab('mine')} />}
      {tab === 'mine' && <Mine orders={data ? mine : undefined} done={done} menu={menuData?.items ?? []} startAdding={go === 'new'} onChange={refresh} />}
      {tab === 'stock' && <MyStock data={stock} reload={reloadStock} />}
      {tab === 'money' && <Earnings summary={sum?.summary} />}
    </Shell>
  )
}
