/**
 * Image2 UI completion smoke via Chrome DevTools Protocol.
 *
 * Prerequisite:
 *   1. npm run dev -- --host 127.0.0.1
 *   2. node scripts/image2-ui-cdp-verify.mjs
 *
 * The script injects stable API mocks in the browser before navigation so the
 * core Compare / Discovery / Creative Review / Ads Graphs flows can be checked
 * without live provider keys or external backend state.
 */
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import { spawn } from 'child_process'
import path from 'path'

const BASE_URL = process.env.IMAGE2_VERIFY_BASE_URL || 'http://127.0.0.1:3002'
const DEBUG_PORT = Number(process.env.IMAGE2_VERIFY_CDP_PORT || 9222)
const OUT_DIR = path.resolve('verify_output')
const RESULT_PATH = path.join(OUT_DIR, 'image2-cdp-results.json')

fs.mkdirSync(OUT_DIR, { recursive: true })

let msgId = 0
let ws = null
let chromeProcess = null
const pending = new Map()
const consoleErrors = []
const networkErrors = []

const MOCK_REPORT_MD = `# 分析レポート

## 結論
自社LPは訴求の方向性は合っていますが、CTAと信頼要素の提示順に改善余地があります。

## 次のアクション
1. ファーストビューのCTAを1つに統一
2. 初回特典と保証をCTA付近へ配置
3. 競合と同じ評価軸でLP-CVRを確認
`

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getChromeCandidates() {
  const envChrome = process.env.CHROME_PATH
  return [
    envChrome,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean)
}

async function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (error) {
          reject(error)
        }
      })
    }).on('error', reject)
  })
}

async function findPageWs() {
  const pages = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
  const page = pages.find((item) => item.type === 'page') || pages[0]
  return page?.webSocketDebuggerUrl || null
}

async function ensureBrowser() {
  try {
    const existing = await findPageWs()
    if (existing) return existing
  } catch {
    // Launch below.
  }

  const executable = getChromeCandidates().find((candidate) => fs.existsSync(candidate))
  if (!executable) {
    throw new Error('Chrome/Edge executable was not found. Set CHROME_PATH or start Chrome with remote debugging.')
  }

  chromeProcess = spawn(executable, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], {
    stdio: 'ignore',
    detached: true,
  })
  chromeProcess.unref()

  for (let i = 0; i < 30; i += 1) {
    try {
      const wsUrl = await findPageWs()
      if (wsUrl) return wsUrl
    } catch {
      await sleep(500)
    }
  }
  throw new Error('Chrome remote debugging did not become ready.')
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(wsUrl)
    const key = crypto.randomBytes(16).toString('base64')
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    })

    req.on('upgrade', (_, socket) => {
      ws = socket
      let buffer = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
        while (buffer.length >= 2) {
          let offset = 2
          let length = buffer[1] & 0x7f
          if (length === 126) {
            if (buffer.length < 4) return
            length = buffer.readUInt16BE(2)
            offset = 4
          } else if (length === 127) {
            if (buffer.length < 10) return
            length = Number(buffer.readBigUInt64BE(2))
            offset = 10
          }
          if (buffer.length < offset + length) return
          const data = buffer.slice(offset, offset + length).toString()
          buffer = buffer.slice(offset + length)
          try {
            const message = JSON.parse(data)
            if (message.id !== undefined && pending.has(message.id)) {
              pending.get(message.id)(message)
              pending.delete(message.id)
            }
            if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
              const text = (message.params.args || []).map((arg) => arg.value || arg.description || '').join(' ')
              consoleErrors.push(text.slice(0, 500))
            }
            if (message.method === 'Runtime.exceptionThrown') {
              consoleErrors.push((message.params?.exceptionDetails?.exception?.description || 'exception').slice(0, 500))
            }
            if (message.method === 'Network.responseReceived') {
              const response = message.params.response
              if (response.status >= 400) {
                networkErrors.push(`${response.status} ${response.url}`)
              }
            }
          } catch {
            // Ignore malformed CDP frames.
          }
        }
      })
      resolve()
    })
    req.on('error', reject)
    req.end()
  })
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    const payload = Buffer.from(JSON.stringify({ id, method, params }))
    const mask = crypto.randomBytes(4)
    let header
    if (payload.length < 126) {
      header = Buffer.alloc(6)
      header[0] = 0x81
      header[1] = 0x80 | payload.length
      mask.copy(header, 2)
    } else if (payload.length < 65536) {
      header = Buffer.alloc(8)
      header[0] = 0x81
      header[1] = 0x80 | 126
      header.writeUInt16BE(payload.length, 2)
      mask.copy(header, 4)
    } else {
      header = Buffer.alloc(14)
      header[0] = 0x81
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(payload.length), 2)
      mask.copy(header, 10)
    }
    const masked = Buffer.alloc(payload.length)
    for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i % 4]
    pending.set(id, resolve)
    ws.write(Buffer.concat([header, masked]))
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }
    }, 30000)
  })
}

async function evalJson(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  const value = response.result?.result?.value
  return typeof value === 'string' ? JSON.parse(value) : value
}

async function evalValue(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  return response.result?.result?.value
}

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
}

async function navigate(pathname) {
  await send('Page.navigate', { url: `${BASE_URL}${pathname}` })
  await waitFor(() => 'document.readyState === "complete"', 10000)
  await sleep(700)
}

async function waitFor(predicateFactory, timeout = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const expression = typeof predicateFactory === 'function' ? predicateFactory() : predicateFactory
    const ok = await evalValue(`Boolean(${expression})`).catch(() => false)
    if (ok) return true
    await sleep(300)
  }
  return false
}

async function clickByText(text, selector = 'button,a') {
  return evalValue(`(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((el) => el.textContent.includes(${JSON.stringify(text)}) && !el.disabled);
    if (!target) return false;
    target.click();
    return true;
  })()`)
}

async function fillInput(selector, value) {
  return evalValue(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`)
}

function mockInjectionSource() {
  const setupState = {
    version: 3,
    queryTypes: ['search', 'landing'],
    periods: ['2026-04', '2026-05'],
    granularity: 'daily',
    datasetId: 'analytics_image2_verify',
    completedAt: '2026-05-06T00:00:00.000Z',
  }
  const user = { role: 'admin', display_name: '検証ユーザー' }
  const chartGroups = [
    {
      title: 'CVR推移',
      chart_type: 'line',
      labels: ['05/01', '05/02', '05/03', '05/04', '05/05', '05/06', '05/07', '05/08'],
      datasets: [{ label: 'CVR', data: [2.1, 2.4, 2.2, 2.8, 3.0, 2.7, 3.2, 3.4] }],
    },
    {
      title: 'CPA推移',
      chart_type: 'bar',
      labels: ['05/01', '05/02', '05/03', '05/04', '05/05', '05/06', '05/07', '05/08'],
      datasets: [{ label: 'CPA', data: [4100, 3980, 4200, 3900, 3650, 3840, 3720, 3600] }],
    },
    {
      title: 'LP別CVR',
      chart_type: 'bar',
      labels: ['LP-A', 'LP-B', 'LP-C'],
      datasets: [{ label: 'CVR', data: [1.9, 3.1, 2.6] }],
    },
  ]

  const source = `
(() => {
  const setupState = ${JSON.stringify(setupState)};
  const chartGroups = ${JSON.stringify(chartGroups)};
  const reportMd = ${JSON.stringify(MOCK_REPORT_MD)};
  localStorage.setItem('insight-studio-guide-seen', '1');
  localStorage.setItem('is_ads_token', 'image2-mock-token');
  localStorage.setItem('is_user', ${JSON.stringify(JSON.stringify(user))});
  sessionStorage.setItem('is_gemini_key', 'AI' + 'za_TEST_ONLY_NOT_A_REAL_KEY');
  localStorage.setItem('insight-studio-current-case', JSON.stringify({ case_id: 'petabit', name: 'ペタビット', dataset_id: setupState.datasetId }));
  localStorage.setItem('insight-studio-case-authenticated', 'true');
  localStorage.setItem('insight-studio-ads-setup:petabit', JSON.stringify(setupState));

  const originalFetch = window.fetch.bind(window);
  const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }));
  const text = (body, status = 200) => Promise.resolve(new Response(body, { status }));

  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input?.url;
    const url = new URL(raw, location.origin);
    const p = url.pathname;

    if (p.endsWith('/health')) return json({ ok: true, status: 'ok' });
    if (p.endsWith('/bq/generate_batch')) {
      return json({
        report_md: reportMd,
        chart_data: { groups: chartGroups },
      });
    }
    if (p.endsWith('/neon/generate')) {
      return json({ text: 'CVR推移とLP別CVRを見ると、CPA改善はLP-Bの訴求維持とLP-Aの導線修正が優先です。' });
    }
    if (p.endsWith('/scan/jobs') && (init.method || 'GET').toUpperCase() === 'POST') {
      return json({ job_id: 'mock-scan', poll_url: '/scan/jobs/mock-scan', retry_after_sec: 1, status: 'queued' }, 202);
    }
    if (p.endsWith('/scan/jobs/mock-scan')) {
      return json({
        status: 'completed',
        result: {
          run_id: 'mock-scan',
          report_md: reportMd,
          summary: 'CTAと信頼要素の提示順に改善余地があります。',
          scores: { ux: 78, conversion: 74, brand: 82, trust: 76, seo: 71 },
          extracted: [{ url: 'https://example.com/lp', title: '自社LP', h1: '広告LP' }],
        },
      });
    }
    if (p.endsWith('/scans')) {
      return json({ scans: [] });
    }
    if (p.endsWith('/discovery/jobs') && (init.method || 'GET').toUpperCase() === 'POST') {
      return json({ job_id: 'mock-discovery', poll_url: '/discovery/jobs/mock-discovery', retry_after_sec: 1, stage: 'queued' }, 202);
    }
    if (p.endsWith('/discovery/jobs/mock-discovery')) {
      return json({
        status: 'completed',
        stage: 'complete',
        progress_pct: 100,
        result: {
          search_id: 'mock-discovery',
          brand_url: 'https://example.com',
          report_md: '# 発見レポート\\n\\n直接競合2件、参考1件、対象外1件を分類しました。\\n\\n## 次に比較する競合\\nMori Cartを競合LP分析へ送ります。',
          fetched_sites: [
            { url: 'https://mori-cart.example/lp', title: 'Mori Cart', score: 88, tier: 'direct', analysis_source: 'ai' },
            { url: 'https://kumo-living.example/lp', title: 'Kumo Living', score: 81, tier: 'direct', analysis_source: 'ai' },
            { url: 'https://sora-tool.example', title: 'Sora Tool', score: 20, tier: 'out_of_scope', analysis_source: 'search_result_fallback' },
          ],
        },
      });
    }
    if (p.endsWith('/discovery/jobs/mock-discovery/report.json') || p.endsWith('/scans/mock-scan/report.json')) {
      return json({ version: 'v0', kind: p.includes('discovery') ? 'discovery' : 'compare', summary: { title: '検証レポート' } });
    }
    if (p.endsWith('/assets') && (init.method || 'GET').toUpperCase() === 'POST') {
      return json({ asset_id: 'mock-asset', file_name: 'demo-creative-interior-300x250.png', mime_type: 'image/png', size_bytes: 18432, width: 300, height: 250 });
    }
    if (p.endsWith('/assets/mock-asset/download')) {
      return originalFetch('/demo-creatives/demo-creative-interior-300x250.png');
    }
    if (p.endsWith('/reviews/banner')) {
      return json({
        run_id: 'mock-review',
        review: {
          review_type: 'banner_review',
          summary: '価格訴求は明確です。CTAの視認性とターゲット訴求を強めると改善できます。',
          target_hypothesis: '小型家具を探す単身者',
          message_angle: '週末限定の割引訴求',
          good_points: [{ point: '価格訴求', reason: '割引率が一目で伝わります。' }],
          improvements: [{ point: 'CTA強化', reason: '押す理由が弱いです。', action: 'ボタン直前に保証文を追加します。' }],
          evidence: [{ evidence_type: 'visual', evidence_source: 'mock creative', evidence_text: 'CTAが背景に溶けています。' }],
          rubric_scores: [
            { rubric_id: 'visual_impact', score: 4, comment: '視認性は十分です。' },
            { rubric_id: 'message_clarity', score: 3, comment: '誰向けかを補足できます。' },
            { rubric_id: 'cta_effectiveness', score: 3, comment: '改善余地があります。' },
            { rubric_id: 'brand_consistency', score: 4, comment: '配色は安定しています。' },
          ],
        },
      });
    }

    return originalFetch(input, init);
  };
})();
`
  return source
}

async function installMocks() {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: mockInjectionSource() })
  await send('Runtime.evaluate', { expression: mockInjectionSource(), awaitPromise: true })
}

async function getLayoutState(rightSelector) {
  return evalJson(`JSON.stringify((() => {
    const node = ${rightSelector};
    const rect = node ? node.getBoundingClientRect() : null;
    const inViewport = rect
      ? rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.top >= -1 && rect.width > 0
      : false;
    return {
      url: location.pathname,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      rightRect: rect ? { left: rect.left, right: rect.right, top: rect.top, width: rect.width, height: rect.height } : null,
      rightInViewport: inViewport,
      navText: [...document.querySelectorAll('aside nav a span.japanese-text')].map((el) => el.textContent.trim()),
      wideElements: [...document.querySelectorAll('body *')]
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return { tag: el.tagName, className: String(el.className || '').slice(0, 120), text: (el.textContent || '').trim().slice(0, 80), left: rect.left, right: rect.right, width: rect.width };
        })
        .filter((item) => item.width > 0 && (item.right > window.innerWidth + 1 || item.left < -1))
        .sort((a, b) => b.right - a.right)
        .slice(0, 8),
      body: document.body.innerText.slice(0, 5000),
    };
  })())`)
}

function assertResult(results, name, passed, detail) {
  results.push({ name, passed: Boolean(passed), detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`)
  if (!passed) console.log(JSON.stringify(detail, null, 2))
}

async function verifyViewport(width, height) {
  const results = []
  console.log(`\\n=== viewport ${width}x${height} ===`)
  await setViewport(width, height)

  await navigate('/')
  const nav = await getLayoutState('document.querySelector("[data-testid=\\"ads-graph-ai-rail\\"]")')
  const expectedNav = ['ダッシュボード', '競合LP分析', '競合発見', 'バナーレビュー', '広告グラフ', 'AI考察', '設定', 'プロジェクト']
  assertResult(results, '左ナビ日本語化', expectedNav.every((label) => nav.navText.includes(label)), nav.navText)

  await navigate('/ads/graphs')
  await waitFor('document.querySelectorAll("canvas").length >= 1 && document.querySelector("[data-testid=\\"ads-graph-ai-rail\\"]")', 15000)
  const before = await evalJson(`JSON.stringify({
    canvasCount: document.querySelectorAll('canvas').length,
    pressed: [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent.trim()),
    pointCopy: document.body.innerText.includes('直近30日間'),
  })`)
  await clickByText('7日間')
  await sleep(500)
  const after7 = await evalJson(`JSON.stringify({
    pressed: [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent.trim()),
    pointCopy: document.body.innerText.includes('直近7日間'),
  })`)
  await clickByText('90日間')
  await sleep(500)
  const after90 = await evalJson(`JSON.stringify({
    pressed: [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent.trim()),
    pointCopy: document.body.innerText.includes('直近90日間'),
  })`)
  await fillInput('#graph-ai-draft', 'CVR低下の原因を確認したい')
  await clickByText('右カラムで質問する')
  await waitFor('document.body.innerText.includes("CVR推移とLP別CVR")', 8000)
  const adsLayout = await getLayoutState('document.querySelector("[data-testid=\\"ads-graph-ai-rail\\"]")')
  assertResult(results, '/ads/graphs 期間選択と右カラム', adsLayout.rightInViewport && !adsLayout.horizontalScroll && before.canvasCount >= 1 && after7.pointCopy && after90.pointCopy, {
    before,
    after7,
    after90,
    layout: adsLayout,
  })

  await navigate('/compare')
  await evalValue(`(() => {
    const values = ['https://example.com/lp', 'https://mori-cart.example/lp', 'https://kumo-living.example/lp'];
    const inputs = [...document.querySelectorAll('input[type="url"]')].slice(0, 3);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    inputs.forEach((input, index) => {
      setter.call(input, values[index]);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return inputs.length;
  })()`)
  await clickByText('分析開始')
  await waitFor('document.body.innerText.includes("分析レポート") && document.body.innerText.includes("次のアクション")', 15000)
  const compareLayout = await getLayoutState('document.querySelector("section aside")')
  assertResult(results, '/compare 入力から結果表示', compareLayout.rightInViewport && !compareLayout.horizontalScroll && compareLayout.body.includes('分析レポート') && compareLayout.body.includes('Image2方向反映済み'), compareLayout)

  await navigate('/discovery')
  await fillInput('input[name="discovery-brand-url"]', 'https://example.com')
  await clickByText('競合を発見')
  await waitFor('document.body.innerText.includes("直接競合") && document.body.innerText.includes("競合LP分析へ送る")', 15000)
  const discoveryLayout = await getLayoutState('document.querySelector("section aside")')
  assertResult(results, '/discovery 入力から候補分類', discoveryLayout.rightInViewport && !discoveryLayout.horizontalScroll && discoveryLayout.body.includes('直接競合') && discoveryLayout.body.includes('競合発見'), discoveryLayout)

  await navigate('/creative-review')
  await clickByText('この架空デモ素材でレビューする')
  await waitFor('document.body.innerText.includes("レビュー設定") && document.body.innerText.includes("mock-asset")', 12000)
  await clickByText('バナーレビューを実行')
  await waitFor('document.body.innerText.includes("レビュー結果") && document.body.innerText.includes("CTA強化")', 15000)
  const creativeLayout = await getLayoutState('document.querySelector("section aside") || document.querySelector(".xl\\\\:col-span-7")')
  assertResult(results, '/creative-review デモ素材からレビュー結果', !creativeLayout.horizontalScroll && creativeLayout.body.includes('レビュー結果') && creativeLayout.body.includes('AIに質問'), creativeLayout)

  await navigate('/debug/ui-ux-review')
  const debugState = await evalJson(`JSON.stringify({
    tabs: [...document.querySelectorAll('[role="tab"]')].map((el) => el.textContent.trim()),
    imageCount: document.querySelectorAll('img[src^="/ux-mockups/"]').length,
    hasImage2: document.body.innerText.includes('GPT Image2'),
  })`)
  assertResult(results, '/debug/ui-ux-review Image2ボード', debugState.tabs.includes('競合LP分析') && debugState.imageCount >= 2 && debugState.hasImage2, debugState)

  return results
}

async function main() {
  const wsUrl = await ensureBrowser()
  await connect(wsUrl)
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Page.enable')
  await installMocks()

  const allResults = []
  for (const [width, height] of [[1920, 1080], [1366, 768]]) {
    const viewportResults = await verifyViewport(width, height)
    allResults.push({ viewport: `${width}x${height}`, results: viewportResults })
  }

  const payload = {
    baseUrl: BASE_URL,
    generatedAt: new Date().toISOString(),
    consoleErrors,
    networkErrors,
    viewports: allResults,
    passed: allResults.every((group) => group.results.every((item) => item.passed)) && consoleErrors.length === 0 && networkErrors.length === 0,
  }
  fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2))
  console.log(`\\nresults: ${RESULT_PATH}`)
  console.log(`consoleErrors=${consoleErrors.length} networkErrors=${networkErrors.length}`)
  if (!payload.passed) process.exitCode = 1

  if (ws) ws.destroy()
  if (chromeProcess) chromeProcess.kill()
}

main().catch((error) => {
  console.error(error)
  if (ws) ws.destroy()
  if (chromeProcess) chromeProcess.kill()
  process.exit(1)
})
