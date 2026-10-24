import { useState } from 'react'
import { api } from '../api'
import { usePoll } from '../hooks'
import type { MenuItem, Order, OwnerStock } from '../types'
import Shell from './Shell'
import Orders from './owner/Orders'
import NewDelivery from './owner/NewDelivery'
import Payouts from './owner/Payouts'
import MenuAdmin from './owner/MenuAdmin'
import Team from './owner/Team'
import Stock from './owner/Stock'

export default function Owner() {
  const [tab, setTab] = useState('orders')
  const [more, setMore] = useState<'menu' | 'team'>('menu')
  const { data: menu, reload: reloadMenu } = usePoll(() => api<{ items: MenuItem[] }>('/admin/menu'), 60_000)
  const { data } = usePoll(() => api<{ orders: Order[] }>('/orders'), 5000)
  const { data: stock, reload: reloadStock } = usePoll(() => api<OwnerStock>('/stock'), 6000)
  const fresh = data?.orders.filter((o) => o.status === 'new').length ?? 0
  const items = (menu?.items ?? []).filter((m) => m.active)

  return (
    <Shell
      tab={tab}
      onTab={setTab}
      tabs={[
        { id: 'orders', label: 'Orders', icon: 'box', badge: fresh },
        { id: 'new', label: 'New', icon: 'plus' },
        { id: 'stock', label: 'Stock', icon: 'layers', badge: stock?.low.length },
        { id: 'money', label: 'Payouts', icon: 'wallet' },
        { id: 'more', label: 'More', icon: 'more' },
      ]}
    >
      {tab === 'orders' && <Orders menu={items} />}
      {tab === 'new' && <NewDelivery menu={items} onCreated={() => setTab('orders')} />}
      {tab === 'stock' && <Stock data={stock} reload={reloadStock} />}
      {tab === 'money' && <Payouts />}
      {tab === 'more' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button className={`btn btn-sm ${more === 'menu' ? 'bg-pink text-white' : 'btn-ghost'}`} onClick={() => setMore('menu')}>Menu</button>
            <button className={`btn btn-sm ${more === 'team' ? 'bg-pink text-white' : 'btn-ghost'}`} onClick={() => setMore('team')}>Team</button>
          </div>
          {more === 'menu' ? <MenuAdmin items={menu?.items ?? []} reload={reloadMenu} /> : <Team />}
        </div>
      )}
    </Shell>
  )
}
