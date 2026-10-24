// Address suggestions via Google Places Autocomplete (New). The API key never leaves the server.
// Without GOOGLE_MAPS_API_KEY this returns nothing and the address field stays plain text.
const LAS_VEGAS = { latitude: 36.1699, longitude: -115.1398 }

export const placesEnabled = () => !!process.env.GOOGLE_MAPS_API_KEY

export async function suggestAddresses(input: string, sessionToken?: string): Promise<string[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) return []
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'suggestions.placePrediction.text.text' },
      body: JSON.stringify({
        input,
        includedRegionCodes: ['us'],
        locationBias: { circle: { center: LAS_VEGAS, radius: 50000 } },
        ...(sessionToken ? { sessionToken } : {}),
      }),
    })
    if (!r.ok) return []
    const j = (await r.json()) as { suggestions?: { placePrediction?: { text?: { text?: string } } }[] }
    return (j.suggestions ?? []).map((s) => s.placePrediction?.text?.text).filter((t): t is string => !!t).slice(0, 5)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}
