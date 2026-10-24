import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import { Icon } from './components/Icon'
import { Logo } from './components/ui'
import Driver from './pages/Driver'
import Login from './pages/Login'
import Owner from './pages/Owner'

function Splash({ offline }: { offline?: boolean }) {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-4">
        <div className={offline ? '' : 'animate-pulse'}><Logo size={88} text={false} /></div>
        {offline && (
          <>
            <div className="flex items-center gap-2 text-lg font-extrabold text-mute"><Icon name="signal" />No connection</div>
            <button className="btn btn-pink" onClick={() => location.reload()}><Icon name="refresh" />Retry</button>
          </>
        )}
      </div>
    </div>
  )
}

function AppGate() {
  const { user, offline } = useAuth()
  if (user === undefined) return <Splash offline={offline} />
  if (!user) return <Login />
  return user.role === 'owner' ? <Owner /> : <Driver />
}

export default function App() {
  return (
    <Routes>
      {/* internal app only: no public pages */}
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/app" element={<AppGate />} />
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
