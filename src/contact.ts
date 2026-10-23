/** Normalise a phone number to international digits (assumes US/Canada for 10-digit numbers). */
export function intlDigits(phone: string | null | undefined): string | null {
  if (!phone) return null
  const d = phone.replace(/\D/g, '')
  if (d.length < 7) return null
  return d.length === 10 ? `1${d}` : d
}
export const smsUrl = (phone: string) => `sms:+${intlDigits(phone)}`
export const whatsappUrl = (phone: string) => `https://wa.me/${intlDigits(phone)}`

export const isApple = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const enc = encodeURIComponent
export const googleMapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${enc(address)}`
export const appleMapsUrl = (address: string) => `https://maps.apple.com/?daddr=${enc(address)}`
export const mapsUrl = (address: string) => (isApple() ? appleMapsUrl(address) : googleMapsUrl(address))

export const MAX_STOPS = 10
export function googleRouteUrl(addresses: string[]): string {
  const stops = addresses.slice(0, MAX_STOPS)
  const q = new URLSearchParams({ api: '1', travelmode: 'driving', destination: stops[stops.length - 1] })
  if (stops.length > 1) q.set('waypoints', stops.slice(0, -1).join('|'))
  return `https://www.google.com/maps/dir/?${q}`
}
export function appleRouteUrl(addresses: string[]): string {
  const stops = addresses.slice(0, MAX_STOPS)
  return `https://maps.apple.com/?saddr=Current%20Location&daddr=${stops.map(enc).join('+to:')}`
}
