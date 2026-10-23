import { useState } from 'react'
import { api } from '../../api'
import { Icon } from '../../components/Icon'
import { Sheet, Spinner, useToast } from '../../components/ui'
import { usePoll } from '../../hooks'
import type { User } from '../../types'

export default function Team() {
  const { toast, fail } = useToast()
  const { data, reload } = usePoll(() => api<{ users: User[] }>('/users'), 30_000)
  const [adding, setAdding] = useState(false)
  const [resetFor, setResetFor] = useState<User | null>(null)
  const [mine, setMine] = useState(false)

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast(msg); reload() } catch (e) { fail(e) }
  }
  if (!data) return <Spinner />
  const drivers = data.users.filter((u) => u.role === 'driver')

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-pink" onClick={() => setAdding(true)}><Icon name="plus" />Driver</button>
        <button className="btn btn-ghost" onClick={() => confirm('Log out every driver on every phone?') && act(() => api('/users/logout-all', { method: 'POST' }), 'Everyone logged out')}>
          <Icon name="logout" />Log out all
        </button>
      </div>

      {drivers.map((u) => (
        <div key={u.id} className="card space-y-3">
          <div>
            <div className="text-xl font-black">{u.name}</div>
            <div className="text-base font-bold text-mute">@{u.username}{u.phone ? ` · ${u.phone}` : ''}</div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button className="btn btn-sm btn-ghost" onClick={() => setResetFor(u)} aria-label="New password"><Icon name="key" size={20} /></button>
            <button className="btn btn-sm btn-ghost" onClick={() => act(() => api(`/users/${u.id}/logout`, { method: 'POST' }), 'Logged out')} aria-label="Force logout"><Icon name="logout" size={20} /></button>
            <button className="btn btn-sm btn-ghost text-red-600" onClick={() => confirm(`Remove ${u.name}?`) && act(() => api(`/users/${u.id}`, { method: 'DELETE' }), 'Removed')} aria-label="Remove"><Icon name="trash" size={20} /></button>
          </div>
        </div>
      ))}

      <button className="btn btn-ghost w-full" onClick={() => setMine(true)}><Icon name="lock" />My password</button>

      {adding && <AddDriver onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload() }} />}
      {resetFor && <Password title={resetFor.name} path={`/users/${resetFor.id}/password`} onClose={() => setResetFor(null)} />}
      {mine && <Password title="My password" path="/auth/password" withCurrent onClose={() => setMine(false)} />}
    </div>
  )
}

function AddDriver({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast, fail } = useToast()
  const [f, setF] = useState({ name: '', username: '', phone: '', password: '' })
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try { await api('/users', { body: f }); toast('Driver added'); onDone() } catch (e) { fail(e) } finally { setBusy(false) }
  }
  return (
    <Sheet title="New driver" onClose={onClose}>
      <div className="space-y-3">
        <input className="field" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="field" placeholder="Username" autoCapitalize="none" autoCorrect="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        <input className="field" placeholder="Phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <input className="field" placeholder="Password (8+)" type="text" autoComplete="off" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <button className="btn btn-pink w-full" disabled={busy || !f.name || !f.username || f.password.length < 8} onClick={submit}><Icon name="check" />Add</button>
      </div>
    </Sheet>
  )
}

function Password({ title, path, withCurrent, onClose }: { title: string; path: string; withCurrent?: boolean; onClose: () => void }) {
  const { toast, fail } = useToast()
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await api(path, { body: withCurrent ? { current, next: pw } : { password: pw } })
      toast('Password changed')
      onClose()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="space-y-3">
        {withCurrent && <input className="field" type="password" placeholder="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
        <input className="field" type={withCurrent ? 'password' : 'text'} placeholder="New password (8+)" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn btn-pink w-full" disabled={busy || pw.length < 8} onClick={submit}><Icon name="check" />Save</button>
      </div>
    </Sheet>
  )
}
