import { applyUpdate, useInstall, useUpdateReady } from '../pwa'
import { Icon } from './Icon'

// "New version" bar — everyone sees it, so nobody gets stuck on an old screen
export function UpdateBanner() {
  const ready = useUpdateReady()
  if (!ready) return null
  return (
    <button onClick={applyUpdate} className="mx-4 mb-2 flex w-[calc(100%-2rem)] items-center gap-2 rounded-2xl bg-mint px-4 py-3 text-left font-extrabold text-white shadow-pop">
      <Icon name="refresh" />New version<span className="ml-auto rounded-xl bg-white/25 px-3 py-1">Update</span>
    </button>
  )
}

// Install the app to the home screen (staff screens only)
export function InstallBanner() {
  const { mode, install, dismiss } = useInstall()
  if (!mode) return null
  return (
    <div className="mx-4 mb-2 flex items-center gap-3 rounded-2xl bg-pink-soft px-4 py-3">
      <img src="/icons/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-xl" />
      {mode === 'android' ? (
        <>
          <span className="flex-1 font-extrabold text-pink-dark">Get the app</span>
          <button className="btn btn-sm btn-pink" onClick={install}><Icon name="download" size={20} />Install</button>
        </>
      ) : (
        <span className="flex-1 text-base font-bold leading-snug text-pink-dark">
          Install: tap <Icon name="share" size={18} className="inline -mt-1" /> <b>Share</b>, then <b>Add to Home Screen</b>
        </span>
      )}
      <button className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-pink-dark" onClick={dismiss} aria-label="Not now"><Icon name="x" size={20} /></button>
    </div>
  )
}
