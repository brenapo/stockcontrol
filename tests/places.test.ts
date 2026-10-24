import { afterEach, describe, expect, it, vi } from 'vitest'
import { suggestAddresses } from '../lib/places'

afterEach(() => vi.unstubAllGlobals())

describe('address suggestions (ArcGIS)', () => {
  it('asks ArcGIS biased to Las Vegas, no key, and returns address text only', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ suggestions: [
      { text: '123 Main St, Las Vegas, NV, 89101, USA', isCollection: false }, { text: 'Main St Coffee', isCollection: true },
    ] })))
    vi.stubGlobal('fetch', f)
    expect(await suggestAddresses('123 Main')).toEqual(['123 Main St, Las Vegas, NV, 89101, USA'])
    const url = new URL(String((f.mock.calls[0] as unknown as [URL])[0]))
    expect(url.hostname).toBe('geocode.arcgis.com')
    expect(url.searchParams.get('text')).toBe('123 Main')
    expect(url.searchParams.get('location')).toBe('-115.1398,36.1699')
    expect(url.searchParams.get('countryCode')).toBe('USA')
    expect(url.searchParams.has('token')).toBe(false)
  })

  it('fails quietly when the service errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    expect(await suggestAddresses('123 Main')).toEqual([])
  })
})
