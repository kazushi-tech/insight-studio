import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

import { ADS_DIRECT_BASE } from '../adsInsights'

describe('Ads Insights production routing contract', () => {
  it('keeps direct requests on the Vercel deployment origin', () => {
    expect(ADS_DIRECT_BASE).toBe('/api/ads')
  })

  it('routes Ads API requests to the Ads backend service', () => {
    const configPath = join(process.cwd(), 'vercel.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    const rewrite = config.rewrites.find((item) => item.source === '/api/ads/(.*)')

    expect(rewrite?.destination).toEqual({ service: 'ads_backend' })
    expect(config.services?.ads_backend?.entrypoint).toBe('vercel_app:app')
  })
})
