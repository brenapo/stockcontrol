import { OrderForm } from '../../components/OrderForm'
import type { MenuItem } from '../../types'

export default function NewDelivery({ menu, onCreated }: { menu: MenuItem[]; onCreated: () => void }) {
  return <OrderForm menu={menu} onSaved={onCreated} />
}
