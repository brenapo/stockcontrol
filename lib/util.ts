// Strip control chars / zero-width tricks, collapse whitespace, cap length.
export function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const s = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').trim()
  return s ? s.slice(0, max) : null
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function digits(phone: string | null | undefined): string | null {
  if (!phone) return null
  const d = phone.replace(/\D/g, '')
  return d.length >= 7 ? d : null
}

export const money = (cents: number | null | undefined) =>
  cents == null ? '' : `$${(cents / 100).toFixed(2)}`

export const STORE_TZ = (() => {
  const t = process.env.STORE_TZ || 'America/New_York'
  try { new Intl.DateTimeFormat('en', { timeZone: t }); return t } catch { return 'America/New_York' }
})()

// Built-in sweet image: real photo (public/candy/<key>.webp) when we have one, else the drawn SVG.
const PHOTOS = new Set(['cannoli', 'kitkat', 'eclair', 'xocolat', 'amorade', 'other'])
export const builtInImage = (key: string) => {
  const k = key.toLowerCase()
  return PHOTOS.has(k) ? `/candy/${k}.webp` : `/candy/${k}.svg`
}
