import { useRef, useState } from 'react'
import { api } from '../../api'
import { Icon } from '../../components/Icon'
import { Spinner, useToast } from '../../components/ui'
import { fromCents, toCents } from '../../format'
import type { MenuItem } from '../../types'

async function toSquareJpeg(file: File, size = 384): Promise<string> {
  const bmp = await createImageBitmap(file)
  const s = Math.min(bmp.width, bmp.height)
  const c = document.createElement('canvas')
  c.width = c.height = size
  c.getContext('2d')!.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size)
  return c.toDataURL('image/jpeg', 0.85)
}

export default function MenuAdmin({ items, reload }: { items: MenuItem[]; reload: () => void }) {
  if (!items.length) return <Spinner />
  return (
    <div className="space-y-3">
      {items.map((m) => <Row key={m.id} item={m} reload={reload} />)}
    </div>
  )
}

function Row({ item, reload }: { item: MenuItem; reload: () => void }) {
  const { toast, fail } = useToast()
  const [name, setName] = useState(item.name)
  const [price, setPrice] = useState(fromCents(item.priceCents))
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const dirty = name !== item.name || toCents(price) !== item.priceCents

  const put = async (body: Record<string, unknown>, msg = 'Saved') => {
    setBusy(true)
    try { await api(`/admin/menu/${item.id}`, { method: 'PUT', body }); toast(msg); reload() } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const pick = async (f?: File) => {
    if (!f) return
    try { await put({ image: await toSquareJpeg(f) }) } catch (e) { fail(e) }
  }

  return (
    <div className={`card flex items-center gap-3 !p-3 ${item.active ? '' : 'opacity-60'}`}>
      <button className="relative shrink-0" onClick={() => file.current?.click()} aria-label="Change image">
        <img src={item.imageUrl} alt="" className="h-20 w-20 rounded-2xl object-cover" />
        <span className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full bg-pink text-white"><Icon name="camera" size={16} /></span>
      </button>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
      <div className="min-w-0 flex-1 space-y-2">
        <input className="field !min-h-[46px] !rounded-xl !text-base" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Name" />
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-[10px] font-black text-mute">$</span>
            <input className="field !min-h-[46px] !rounded-xl !pl-7 !text-base" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price" />
          </div>
          {dirty ? (
            <button className="btn btn-pink btn-sm" disabled={busy || !name.trim()} onClick={() => put({ name, priceCents: toCents(price) ?? 0 })}><Icon name="check" size={20} /></button>
          ) : (
            <>
              {item.customImage && <button className="btn btn-ghost btn-sm !w-11 !px-0" disabled={busy} onClick={() => put({ image: null }, 'Image reset')} aria-label="Reset image"><Icon name="refresh" size={20} /></button>}
              <button className={`btn btn-sm !w-11 !px-0 ${item.active ? 'bg-mint-soft text-mint-dark dark:text-mint' : 'btn-ghost'}`} disabled={busy} onClick={() => put({ active: !item.active })} aria-label={item.active ? 'Hide' : 'Show'} aria-pressed={item.active}><Icon name="check" size={20} /></button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
