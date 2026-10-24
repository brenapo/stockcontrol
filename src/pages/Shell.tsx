import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { Icon } from '../components/Icon'
import { InstallBanner, UpdateBanner } from '../components/PwaBanners'
import { Logo, useToast } from '../components/ui'
import { useOnline } from '../hooks'
import { disablePush, enablePush, pushEnabled, pushSupported } from '../push'

export type Tab = { id: string; label: string; icon: string; badge?: number }

export default function Shell({ tabs, tab, onTab, children }: { tabs: Tab[]; tab: string; onTab: (id: string) => void; children: ReactNode }) {
  const { user, logout } = useAuth()
  const online = useOnline()
  const { toast, fail } = useToast()
  const [push, setPush] = useState(false)

  useEffect(() => { pushEnabled().then(setPush).catch(() => {}) }, [])

  const togglePush = async () => {
    try {
      if (push) { await disablePush(); setPush(false); toast('Alerts off') }
      else if (await enablePush()) { setPush(true); toast('Alerts on') }
      else toast('Alerts are not available on this device', 'err')
    } catch (e) { fail(e) }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-28">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-surface/90 px-4 pb-2 backdrop-blur" style={{ paddingTop: 'calc(0.6rem + env(safe-area-inset-top))' }}>
        <Link to="/" aria-label="Sweets menu"><Logo size={36} /></Link>
        <div className="flex items-center gap-2">
          <span className="hidden text-base font-extrabold text-mute min-[380px]:inline">{user?.name}</span>
          {pushSupported() && (
            <button className={`btn btn-sm !w-11 !px-0 ${push ? 'btn-pink' : 'btn-ghost'}`} onClick={togglePush} aria-label="Alerts"><Icon name="bell" size={20} /></button>
          )}
          <button className="btn btn-sm btn-ghost !w-11 !px-0" onClick={logout} aria-label="Log out"><Icon name="logout" size={20} /></button>
        </div>
      </header>

      <UpdateBanner />
      <InstallBanner />

      {!online && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-2xl bg-red-600 px-4 py-3 font-extrabold text-white"><Icon name="signal" />No connection</div>
      )}

      <main className="px-4 pt-2">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-line bg-card" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto grid max-w-2xl" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => onTab(t.id)} className={`relative flex min-h-[64px] flex-col items-center justify-center gap-0.5 text-xs font-extrabold ${tab === t.id ? 'text-pink' : 'text-mute'}`} aria-current={tab === t.id}>
              <span className={`grid h-8 w-14 place-items-center rounded-full transition ${tab === t.id ? 'bg-pink-soft' : ''}`}><Icon name={t.icon} size={24} /></span>
              {t.label}
              {!!t.badge && <span className="absolute right-[22%] top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-pink px-1 text-xs font-black text-white">{t.badge}</span>}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
