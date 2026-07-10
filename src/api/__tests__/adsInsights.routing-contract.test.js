import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

import { ADS_DIRECT_BASE } from '../adsInsights'

describe('Ads Insights production routing contract', () => {
  it('uses the backend /api root for direct requests', () => {
    expect(ADS_DIRECT_BASE).toBe('https://ads-insights-9q5s.onrender.com/api')
  })

  it('strips the frontend /api/ads namespace in the Vercel catch-all rewrite', () => {
    const configPath = join(process.cwd(), 'vercel.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    const rewrite = config.rewrites.find((item) => item.source === '/api/ads/:path*')
    const healthRewrite = config.rewrites.find((item) => item.source === '/api/ads/health')

    expect(rewrite?.destination).toBe('https://ads-insights-9q5s.onrender.com/api/:path*')
    expect(healthRewrite?.destination).toBe('https://ads-insights-9q5s.onrender.com/api/ads/health')
  })
})
