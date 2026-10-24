import { afterEach, describe, expect, it, vi } from 'vitest'
import { suggestAddresses } from '../lib/places'

afterEach(() => { vi.unstubAllGlobals(); delete process.env.GOOGLE_MAPS_API_KEY })

describe('address suggestions', () => {
  it('does nothing without a key', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await suggestAddresses('123 Main')).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })

  it('asks Google with the key server-side, biased to Las Vegas, and returns text only', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key'
    const f = vi.fn(async () => new Response(JSON.stringify({ suggestions: [
      { placePrediction: { text: { text: '123 Main St, Las Vegas, NV, USA' } } }, { queryPrediction: {} },
    ] })))
    vi.stubGlobal('fetch', f)
    expect(await suggestAddresses('123 Main', 'abcdef123')).toEqual(['123 Main St, Las Vegas, NV, USA'])
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('places:autocomplete')
    expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-key')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ input: '123 Main', sessionToken: 'abcdef123', includedRegionCodes: ['us'] })
    expect(body.locationBias.circle.center.latitude).toBeCloseTo(36.17, 1)
  })

  it('fails quietly when Google errors', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })))
    expect(await suggestAddresses('123 Main')).toEqual([])
  })
})
