// Address suggestions via the ArcGIS World Geocoder `suggest` endpoint (free, no key — same as Route Optimizer).
// Biased to Las Vegas so local addresses come first.
const LAS_VEGAS = '-115.1398,36.1699'

export async function suggestAddresses(input: string): Promise<string[]> {
  const url = new URL('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest')
  url.search = new URLSearchParams({
    text: input, f: 'json', countryCode: 'USA', location: LAS_VEGAS, distance: '80000', maxSuggestions: '5', category: 'Address,Postal',
  }).toString()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) return []
    const j = (await r.json()) as { suggestions?: { text?: string; isCollection?: boolean }[] }
    return (j.suggestions ?? []).filter((s) => !s.isCollection && s.text).map((s) => s.text!).slice(0, 5)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}
