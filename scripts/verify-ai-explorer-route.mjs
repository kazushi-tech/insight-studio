import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = process.cwd()
const PORT = 3002
const BASE_URL = `http://127.0.0.1:${PORT}`
const QUESTION = '5月のPV数で一番高かった日はいつ？原因は何だと思う？'
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright')

const answerMarkdown = [
  '## 結論',
  '5月でPV数が最も高かったのは 2026-05-13 で、PV数は 401 です。',
  '',
  '## 数値根拠',
  '- 前日比は +102PV / +34.1% です。',
  '- 期間平均との差は +203.7PV / +103.2% です。',
  '',
  '## 原因として考えられること',
  'source / medium では google / organic、LP軸では厳密なセッションLP定義で https://www.petabit.co.jp/ から始まったセッション群の増加が目立ちます。',
  'campaign属性では (organic) が増えています。ただし、これは広告キャンペーン施策を意味するとは限らず、自然検索流入の増加として見るのが妥当です。',
  '',
  '## まだ断定できないこと',
  'LP原因は厳密なセッションLP定義で見ています。page_location別PVとは別物です。',
  '広告配信、SNS投稿、メルマガ、外部露出の有無はこのデータだけでは確認できないため、原因は断定できません。',
  '',
  '## 次に確認すべきこと',
  '1. 最大日の source / medium 別PV',
  '2. 最大日の page_location 別PV',
  '3. 前週同曜日との比較',
  '',
  '## 打ち手',
  '自然検索で伸びたページの検索クエリと導線を確認し、同系統ページの内部リンクとCTAを優先改善してください。',
].join('\n')

async function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function waitForBodyIncludes(page, needles, timeoutMs = 30_000) {
  const started = Date.now()
  let lastMissing = needles
  while (Date.now() - started < timeoutMs) {
    const text = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
    lastMissing = needles.filter((item) => !text.includes(item))
    if (lastMissing.length === 0) return text
    await page.waitForTimeout(500)
  }
  throw new Error(`Missing body text: ${lastMissing.join(', ')}`)
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  const serverCommand = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', `npm run preview -- --host 127.0.0.1 --port ${PORT}`]]
    : ['npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(PORT)]]
  const server = spawn(serverCommand[0], serverCommand[1], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  const serverLog = []
  server.stdout.on('data', (chunk) => serverLog.push(chunk.toString()))
  server.stderr.on('data', (chunk) => serverLog.push(chunk.toString()))

  let browser
  const result = {
    sidebarNavigatedToNeutralRoute: false,
    neutralRouteOpened: false,
    legacyRouteOpened: false,
    legacyRouteRedirected: false,
    neutralApiCalled: false,
    legacyAdsApiCalled: false,
    reloadSafe: false,
    blockedByClient: [],
    screenshot: path.join(OUTPUT_DIR, 'ai-explorer-insights-mock.png'),
    consoleErrors: [],
  }

  try {
    await waitForServer(`${BASE_URL}/insights/ai`)

    browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()

    page.on('console', (msg) => {
      if (msg.type() === 'error') result.consoleErrors.push(msg.text())
    })
    page.on('requestfailed', (request) => {
      const failure = request.failure()
      if (failure?.errorText === 'net::ERR_ABORTED') return
      result.consoleErrors.push(`request failed: ${request.url()} ${failure?.errorText ?? ''}`)
      if (failure?.errorText?.includes('ERR_BLOCKED_BY_CLIENT')) {
        result.blockedByClient.push(request.url())
      }
    })

    await page.addInitScript(({ question }) => {
      localStorage.setItem('insight-studio-guide-seen', '1')
      localStorage.setItem('is_ads_token', 'test-token')
      localStorage.setItem('is_gemini_key', 'AIza-test-key')
      localStorage.setItem('is_user', JSON.stringify({ role: 'admin', display_name: 'テスト管理者' }))
      localStorage.setItem(
        'insight-studio-current-case',
        JSON.stringify({ case_id: 'petabit', name: 'ペタビット', dataset_id: 'analytics_311324674' }),
      )
      localStorage.setItem('insight-studio-case-authenticated', 'true')
      localStorage.setItem(
        'insight-studio-ads-setup:petabit',
        JSON.stringify({
          version: 3,
          queryTypes: ['pv', 'traffic', 'landing', 'device'],
          periods: ['2026-05'],
          granularity: 'monthly',
          datasetId: 'analytics_311324674',
          completedAt: '2026-05-24T00:00:00.000Z',
        }),
      )
      if (sessionStorage.getItem('is-ai-route-smoke-seeded') !== '1') {
        sessionStorage.setItem(
          'is-draft-ai-explorer',
          JSON.stringify({
            contextMode: 'ads-only',
            messages: [
              { role: 'user', text: question },
              { role: 'assistant', text: 'この回答は表示形式を整えられませんでした。新しいセッションで聞き直してください。' },
            ],
          }),
        )
        sessionStorage.setItem('is-ai-route-smoke-seeded', '1')
      }
    }, { question: QUESTION })

    await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/css',
      body: '',
    }))
    await page.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 204, body: '' }))
    await page.route('**/api/ml/health', (route) => route.fulfill({ json: { status: 'ok' } }))
    await page.route('**/api/ml/scans', (route) => route.fulfill({ json: { scans: [] } }))
    await page.route('**/api/ads/bq/generate_batch', (route) => route.fulfill({
      json: {
        report_md: '## PV分析\n2026-05-13 が 401PV で最大です。',
        chart_data: {
          groups: [
            {
              title: 'PV分析 — 日別推移',
              chartType: 'line',
              labels: ['2026-05-12', '2026-05-13'],
              datasets: [{ label: 'PV数', data: [299, 401] }],
            },
          ],
        },
      },
    }))
    await page.route('**/api/insights/neon/generate', (route) => {
      result.neutralApiCalled = true
      return route.fulfill({
        json: {
          ok: true,
          answer_markdown: answerMarkdown,
          text: answerMarkdown,
          parse_status: 'json',
          fallback_used: false,
          caveats: [
            'セッションLPは user_pseudo_id + ga_session_id ごとの最初の page_view.page_location で定義しています。',
            'campaign属性の (organic) は広告キャンペーン施策名ではありません。',
          ],
          analysis_context: {
            dateRange: { start: '2026-05-01', end: '2026-05-31', timezone: 'Asia/Tokyo' },
            metricFocus: 'page_views',
            sessionLandingPageDiagnostic: {
              method: 'ga4_session_first_page_view',
              sessionKeyMethod: 'user_pseudo_id + ga_session_id',
              landingPageDefinition: 'first page_view.page_location in each GA4 session',
            },
            pvSpikePeak: {
              date: '2026-05-13',
              pageViews: 401,
              previousDayDelta: 102,
              previousDayDeltaRate: 34.1,
              periodAverageDelta: 203.7,
              periodAverageDeltaRate: 103.2,
            },
          },
        },
      })
    })
    await page.route('**/api/ads/neon/generate', (route) => {
      result.legacyAdsApiCalled = true
      return route.abort()
    })

    await page.goto(`${BASE_URL}/`, { waitUntil: 'commit', timeout: 15_000 })
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch((error) => {
      result.consoleErrors.push(`domcontentloaded wait failed: ${error.message}`)
    })
    if (!(await page.locator('#root > *').first().isVisible({ timeout: 10_000 }).catch(() => false))) {
      console.log((await page.content()).slice(0, 1200))
      throw new Error(`App did not render: ${JSON.stringify(result.consoleErrors)}`)
    }
    await page.getByRole('button', { name: /広告分析/ }).click()
    await page.getByRole('link', { name: /AI考察/ }).click()
    await page.waitForURL('**/insights/ai', { timeout: 15_000 })
    result.sidebarNavigatedToNeutralRoute = page.url().endsWith('/insights/ai')
    await page.getByTestId('ai-explorer-v2').waitFor({ state: 'attached', timeout: 15_000 })
    result.neutralRouteOpened = page.url().endsWith('/insights/ai')
    await page.getByText('古い形式の回答です').waitFor()
    await page.getByRole('button', { name: 'セッションをクリア' }).click()
    const questionInput = page.getByRole('textbox', { name: 'AIへの質問を入力' })
    await questionInput.waitFor()
    await page.waitForFunction(() => {
      const input = document.querySelector('input[aria-label="AIへの質問を入力"]')
      return input && !input.disabled
    }, { timeout: 30_000 })
    await questionInput.fill(QUESTION)
    const responsePromise = page.waitForResponse('**/api/insights/neon/generate', { timeout: 30_000 })
    await page.getByRole('button', { name: '送信' }).click()
    const aiResponse = await responsePromise
    if (!aiResponse.ok()) throw new Error(`AI response failed: ${aiResponse.status()} ${aiResponse.url()}`)
    await page.waitForTimeout(1000)
    await waitForBodyIncludes(page, [
      '結論',
      '数値根拠',
      '原因として考えられること',
      'まだ断定できないこと',
      '次に確認すべきこと',
      '打ち手',
      'GA4セッション内で最初に閲覧されたページ（入口ページ）',
      '広告キャンペーン施策を意味するとは限らず',
    ])
    await page.waitForFunction(() => {
      const raw = sessionStorage.getItem('is-draft-ai-explorer') || ''
      return raw.includes('2026-05-13')
    }, { timeout: 30_000 })
    await page.screenshot({ path: result.screenshot, fullPage: true, animations: 'disabled', timeout: 10_000 })

    await page.reload({ waitUntil: 'commit', timeout: 15_000 })
    await waitForBodyIncludes(page, ['結論', '2026-05-13'])
    result.reloadSafe = true

    const legacyResponse = await page.goto(`${BASE_URL}/ads/ai`, { waitUntil: 'commit', timeout: 15_000 })
    result.legacyRouteOpened = Boolean(legacyResponse?.ok()) && result.blockedByClient.length === 0
    await page.waitForURL('**/insights/ai', { timeout: 15_000 })
    result.legacyRouteRedirected = page.url().endsWith('/insights/ai')

    if (!result.sidebarNavigatedToNeutralRoute || !result.neutralRouteOpened || !result.neutralApiCalled || !result.reloadSafe || !result.legacyRouteOpened || !result.legacyRouteRedirected) {
      throw new Error(`Unexpected smoke result: ${JSON.stringify(result)}`)
    }

    console.log(JSON.stringify(result, null, 2))
  } finally {
    if (browser) await browser.close()
    if (process.platform === 'win32' && server.pid) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
      } catch {
        server.kill('SIGTERM')
      }
    } else {
      server.kill('SIGTERM')
    }
    await fs.writeFile(path.join(OUTPUT_DIR, 'vite-dev.log'), serverLog.join(''), 'utf8')
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
