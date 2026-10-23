import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { Icon } from '../components/Icon'
import { Logo, useToast } from '../components/ui'

export default function Login() {
  const { user, login } = useAuth()
  const { fail } = useToast()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/app" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try { await login(username, password) } catch (err) { fail(err) } finally { setBusy(false) }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex justify-center"><Logo size={72} text={false} /></div>
      <h1 className="text-center text-4xl font-black text-pink">Sugar Rush</h1>
      <form onSubmit={submit} className="space-y-3">
        <div className="relative">
          <Icon name="user" className="pointer-events-none absolute left-4 top-[16px] text-mute" />
          <input className="field !pl-12" placeholder="Username" autoComplete="username" autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="relative">
          <Icon name="key" className="pointer-events-none absolute left-4 top-[16px] text-mute" />
          <input className="field !pl-12" placeholder="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn btn-pink w-full" disabled={busy || !username || !password}><Icon name="logout" />{busy ? '…' : 'Log in'}</button>
      </form>
      <Link to="/" className="text-center text-base font-bold text-mute">← Order sweets</Link>
    </main>
  )
}
