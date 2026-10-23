import { useState } from 'react'
import { api } from '../api'
import { usePoll } from '../hooks'
import type { MenuItem, Order } from '../types'
import Shell from './Shell'
import Orders from './owner/Orders'
import NewDelivery from './owner/NewDelivery'
import Payouts from './owner/Payouts'
import MenuAdmin from './owner/MenuAdmin'
import Team from './owner/Team'

export default function Owner() {
  const [tab, setTab] = useState('orders')
  const { data: menu, reload: reloadMenu } = usePoll(() => api<{ items: MenuItem[] }>('/admin/menu'), 60_000)
  const { data } = usePoll(() => api<{ orders: Order[] }>('/orders'), 5000)
  const fresh = data?.orders.filter((o) => o.status === 'new').length ?? 0
  const items = (menu?.items ?? []).filter((m) => m.active)

  return (
    <Shell
      tab={tab}
      onTab={setTab}
      tabs={[
        { id: 'orders', label: 'Orders', icon: 'box', badge: fresh },
        { id: 'new', label: 'New', icon: 'plus' },
        { id: 'money', label: 'Payouts', icon: 'wallet' },
        { id: 'menu', label: 'Menu', icon: 'candy' },
        { id: 'team', label: 'Team', icon: 'users' },
      ]}
    >
      {tab === 'orders' && <Orders menu={items} />}
      {tab === 'new' && <NewDelivery menu={items} onCreated={() => setTab('orders')} />}
      {tab === 'money' && <Payouts />}
      {tab === 'menu' && <MenuAdmin items={menu?.items ?? []} reload={reloadMenu} />}
      {tab === 'team' && <Team />}
    </Shell>
  )
}
