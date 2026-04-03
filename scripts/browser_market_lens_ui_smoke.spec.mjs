import { test, expect } from '@playwright/test'

const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aQ0AAAAASUVORK5CYII='

function decodeBase64(base64) {
  return Buffer.from(base64, 'base64')
}

async function seedLocalStorage(page) {
  const clientId = process.env.INSIGHT_STUDIO_CLIENT_ID || `ui-smoke-${Date.now()}`
  const localStorageEntries = {
    'insight-studio-guide-seen': '1',
    'insight-studio-client-id': clientId,
  }

  const claudeKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || ''
  const geminiKey = process.env.GEMINI_API_KEY || ''

  if (claudeKey) localStorageEntries.is_claude_key = claudeKey
  if (geminiKey) localStorageEntries.is_gemini_key = geminiKey

  await page.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries || {})) {
      window.localStorage.setItem(key, value)
    }
  }, localStorageEntries)
  return { localStorageEntries }
}

async function readVisibleError(page) {
  const banner = page.locator('text=Market Lens backend に接続できませんでした').first()
  if (await banner.isVisible().catch(() => false)) {
    return (await banner.textContent())?.trim() || ''
  }

  const genericError = page.locator('text=/LLM分析エラー|失敗|エラー|timeout|タイムアウト|Claude 呼び出し|Internal server error/i').first()
  if (await genericError.isVisible().catch(() => false)) {
    return (await genericError.textContent())?.trim() || ''
  }

  return ''
}

async function clickAndCaptureJson(page, click, urlPart) {
  const responsePromise = page.waitForResponse((response) => {
    return response.url().includes(urlPart) && response.request().method() === 'POST'
  }, { timeout: 180000 })

  await click()
  const response = await responsePromise
  const text = await response.text()
  return {
    status: response.status(),
    url: response.url(),
    text: text.slice(0, 800),
  }
}

async function readBodySignal(page) {
  const text = await page.locator('body').innerText().catch(() => '')
  const patterns = [
    /Market Lens backend に接続できませんでした[^\n]*/i,
    /LLM分析エラー[^\n]*/i,
    /Claude 呼び出し[^\n]*/i,
    /Internal server error[^\n]*/i,
    /レビュー失敗[^\n]*/i,
    /画像付きレビューの実行に失敗しました[^\n]*/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[0]
  }
  return ''
}

test.describe.configure({ mode: 'serial' })

test('provisioned browser UI smoke for compare/discovery/creative review', async ({ page }) => {
  test.setTimeout(420000)
  const appBaseUrl = process.env.INSIGHT_STUDIO_BASE_URL || 'http://127.0.0.1:3004'
  const manifest = await seedLocalStorage(page)

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[console:error] ${msg.text()}`)
  })

  console.log(JSON.stringify({
    seededKeys: Object.keys(manifest.localStorageEntries || {}),
    baseUrl: appBaseUrl,
  }, null, 2))

  const compare = {}
  await page.goto(`${appBaseUrl}/compare`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('https://your-site.jp/lp01').fill('https://www.petabit.co.jp')
  await page.getByPlaceholder('https://competitor-a.com/landing').fill('https://www.openai.com')
  await page.getByPlaceholder('https://competitor-b.com/campaign').fill('https://www.anthropic.com')
  compare.response = await clickAndCaptureJson(
    page,
    () => page.getByRole('button', { name: '分析開始' }).click(),
    '/api/ml/scan',
  )
  await page.waitForTimeout(2000)
  compare.error = await readVisibleError(page)
  compare.bodySignal = await readBodySignal(page)
  compare.hasConnectionError = compare.error.includes('Market Lens backend に接続できませんでした')
  compare.reportVisible = await page.locator('text=分析レポート').first().isVisible().catch(() => false)
  console.log(`compare=${JSON.stringify(compare, null, 2)}`)

  const discovery = {}
  await page.goto(`${appBaseUrl}/discovery`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('競合他社のURLを入力').fill('https://www.petabit.co.jp')
  discovery.response = await clickAndCaptureJson(
    page,
    () => page.getByRole('button', { name: '競合を発見' }).click(),
    '/api/ml/discovery/analyze',
  )
  await page.waitForTimeout(2000)
  discovery.error = await readVisibleError(page)
  discovery.bodySignal = await readBodySignal(page)
  discovery.hasConnectionError = discovery.error.includes('Market Lens backend に接続できませんでした')
  discovery.reportVisible = await page.locator('text=分析レポート').first().isVisible().catch(() => false)
  console.log(`discovery=${JSON.stringify(discovery, null, 2)}`)

  const creativeReview = {}
  await page.goto(`${appBaseUrl}/creative-review`, { waitUntil: 'domcontentloaded' })
  await page.locator('input[type="file"]').setInputFiles({
    name: 'probe.png',
    mimeType: 'image/png',
    buffer: decodeBase64(VALID_PNG_BASE64),
  })
  await expect(page.locator('text=/asset_id:/')).toBeVisible({ timeout: 20000 })
  creativeReview.response = await clickAndCaptureJson(
    page,
    () => page.getByRole('button', { name: /バナーレビューを実行|広告\+LP統合レビューを実行/ }).click(),
    '/api/ml/reviews/banner',
  )
  await page.waitForTimeout(1000)
  creativeReview.error = await readVisibleError(page)
  creativeReview.bodySignal = await readBodySignal(page)
  creativeReview.hasConnectionError = creativeReview.error.includes('Market Lens backend に接続できませんでした')
  creativeReview.reviewVisible = await page.locator('text=レビュー結果').first().isVisible().catch(() => false)
  console.log(`creativeReview=${JSON.stringify(creativeReview, null, 2)}`)
})
