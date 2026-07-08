/**
 * Deep functional verification - checks console errors, network failures,
 * and actually interacts with each page feature.
 */
import http from 'http'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const CDP_URL = 'ws://127.0.0.1:9222/devtools/page/9A967EFEC66AB8C20B73DC4DAB3B7142'
const BASE = 'http://localhost:3002'
const OUT_DIR = path.resolve('verify_output')

let msgId = 0, ws = null
const pending = new Map()
let consoleLog = []
let netErrors = []

function connect() {
  return new Promise((resolve, reject) => {
    const url = new URL(CDP_URL)
    const key = crypto.randomBytes(16).toString('base64')
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' }
    })
    req.on('upgrade', (_, socket) => {
      ws = socket
      let buf = Buffer.alloc(0)
      socket.on('data', chunk => {
        buf = Buffer.concat([buf, chunk])
        while (buf.length >= 2) {
          let off = 2, len = buf[1] & 0x7f
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
          if (buf.length < off + len) return
          const data = buf.slice(off, off + len).toString()
          buf = buf.slice(off + len)
          try {
            const m = JSON.parse(data)
            if (m.id !== undefined && pending.has(m.id)) {
              pending.get(m.id)(m)
              pending.delete(m.id)
            }
            // Console messages
            if (m.method === 'Runtime.consoleAPICalled') {
              const text = (m.params.args || []).map(a => a.value || a.description || '').join(' ')
              consoleLog.push({ type: m.params.type, text: text.slice(0, 500) })
            }
            if (m.method === 'Runtime.exceptionThrown') {
              const desc = m.params?.exceptionDetails?.exception?.description || 'unknown'
              consoleLog.push({ type: 'exception', text: desc.slice(0, 500) })
            }
            // Network responses
            if (m.method === 'Network.responseReceived') {
              const r = m.params.response
              if (r.status >= 400) {
                netErrors.push({ url: r.url, status: r.status })
              }
            }
            if (m.method === 'Network.loadingFailed') {
              netErrors.push({ error: m.params?.errorText || 'failed', blocked: m.params?.blockedReason })
            }
          } catch {}
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
      header = Buffer.alloc(6); header[0] = 0x81; header[1] = 0x80 | payload.length; mask.copy(header, 2)
    } else if (payload.length < 65536) {
      header = Buffer.alloc(8); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); mask.copy(header, 4)
    } else {
      header = Buffer.alloc(14); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(payload.length), 2); mask.copy(header, 10)
    }
    const masked = Buffer.alloc(payload.length)
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4]
    pending.set(id, resolve)
    ws.write(Buffer.concat([header, masked]))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)) } }, 30000)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function eval_(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: false })
  return r.result?.result?.value
}

async function evalAsync(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true })
  return r.result?.result || r.result?.exceptionDetails
}

async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) {
    fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(r.result.data, 'base64'))
  }
}

function resetTracking() {
  consoleLog = []
  netErrors = []
}

function reportErrors(label) {
  const errors = consoleLog.filter(e => e.type === 'error' || e.type === 'exception')
  const warnings = consoleLog.filter(e => e.type === 'warning')
  console.log(`  Console errors: ${errors.length}, warnings: ${warnings.length}`)
  errors.forEach(e => console.log(`    [ERR] ${e.text.slice(0, 200)}`))
  if (netErrors.length > 0) {
    console.log(`  Network errors: ${netErrors.length}`)
    netErrors.forEach(e => console.log(`    [NET] ${e.status || ''} ${e.url || e.error || ''}`))
  }
  return errors.length
}

async function main() {
  console.log('=== Insight Studio 深層動作検証 ===\n')
  await connect()
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Page.enable')

  let totalErrors = 0

  // ──────────────────────────────────────
  // 1. 要点パック - データが実際にロードされるか
  // ──────────────────────────────────────
  console.log('━━━ 1. 要点パック (/ads/pack) ━━━')
  resetTracking()
  await send('Page.navigate', { url: BASE + '/ads/pack' })
  await sleep(8000) // longer wait for API calls
  const packUrl = await eval_('location.href')
  console.log(`  URL: ${packUrl}`)
  // Check if data sections are present
  const packContent = await eval_('document.body?.innerText || ""')
  const hasPackData = packContent.includes('サマリー') || packContent.includes('レポート')
  console.log(`  データ表示: ${hasPackData ? 'あり' : 'なし'}`)
  totalErrors += reportErrors('pack')
  await screenshot('deep-ads_pack')
  console.log()

  // ──────────────────────────────────────
  // 2. グラフ - データフェッチ＋描画
  // ──────────────────────────────────────
  console.log('━━━ 2. グラフ (/ads/graphs) ━━━')
  resetTracking()
  await send('Page.navigate', { url: BASE + '/ads/graphs' })
  await sleep(8000)
  const graphUrl = await eval_('location.href')
  console.log(`  URL: ${graphUrl}`)
  // Try clicking the fetch button if it exists
  const graphHasButton = await eval_('!!document.querySelector("button")')
  if (graphHasButton) {
    console.log('  Fetch ボタン発見 — クリック試行')
    await eval_('document.querySelectorAll("button").forEach(b => { if (b.textContent.includes("取得") || b.textContent.includes("実行") || b.textContent.includes("分析")) b.click() })')
    await sleep(10000)
  }
  const graphContent = await eval_('document.body?.innerText || ""')
  console.log(`  グラフコンテンツ: ${graphContent.slice(0, 200)}`)
  totalErrors += reportErrors('graphs')
  await screenshot('deep-ads_graphs')
  console.log()

  // ──────────────────────────────────────
  // 3. AI考察 - トピック選択＋実行
  // ──────────────────────────────────────
  console.log('━━━ 3. AI考察 (/ads/ai) ━━━')
  resetTracking()
  await send('Page.navigate', { url: BASE + '/ads/ai' })
  await sleep(6000)
  const aiUrl = await eval_('location.href')
  console.log(`  URL: ${aiUrl}`)
  const aiContent = await eval_('document.body?.innerText || ""')
  console.log(`  AI考察コンテンツ: ${aiContent.slice(0, 200)}`)
  // Try clicking generate/analyze button
  const aiHasButton = await eval_('!!document.querySelector("button")')
  if (aiHasButton) {
    console.log('  ボタン発見 — 分析実行クリック試行')
    await eval_('document.querySelectorAll("button").forEach(b => { if (b.textContent.includes("考察") || b.textContent.includes("生成") || b.textContent.includes("分析") || b.textContent.includes("実行")) b.click() })')
    await sleep(10000)
  }
  totalErrors += reportErrors('ai')
  await screenshot('deep-ads_ai')
  console.log()

  // ──────────────────────────────────────
  // 4. Creative Review - ページ表示のみ（画像アップロードは手動）
  // ──────────────────────────────────────
  console.log('━━━ 4. Creative Review (/creative-review) ━━━')
  resetTracking()
  await send('Page.navigate', { url: BASE + '/creative-review' })
  await sleep(5000)
  const crUrl = await eval_('location.href')
  console.log(`  URL: ${crUrl}`)
  const crContent = await eval_('document.body?.innerText || ""')
  const hasBannerText = crContent.includes('バナー生成') || crContent.includes('改善バナー')
  console.log(`  バナー生成テキスト残存: ${hasBannerText ? '❌ あり' : '✅ なし'}`)
  console.log(`  ステップ表示: ${crContent.includes('画像をアップロード') ? 'アップロード✅' : '?'} ${crContent.includes('レビュー') ? 'レビュー✅' : '?'}`)
  totalErrors += reportErrors('creative-review')
  await screenshot('deep-creative_review')
  console.log()

  // ──────────────────────────────────────
  // 5. Discovery - URL入力して分析実行
  // ──────────────────────────────────────
  console.log('━━━ 5. Discovery (/discovery) ━━━')
  resetTracking()
  await send('Page.navigate', { url: BASE + '/discovery' })
  await sleep(5000)
  const discUrl = await eval_('location.href')
  console.log(`  URL: ${discUrl}`)
  // Try inputting a URL and clicking scan
  const hasInput = await eval_('!!document.querySelector("input[type=text], input[type=url], input:not([type])")')
  if (hasInput) {
    console.log('  URL入力フィールド発見 — テストURL入力')
    await eval_('const inp = document.querySelector("input[type=text], input[type=url], input:not([type])"); if(inp){ const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; nativeSet.call(inp, "https://example.com"); inp.dispatchEvent(new Event("input", {bubbles:true})); inp.dispatchEvent(new Event("change", {bubbles:true})); }')
    await sleep(1000)
    // Click scan/analyze button
    await eval_('document.querySelectorAll("button").forEach(b => { if (b.textContent.includes("分析") || b.textContent.includes("検索") || b.textContent.includes("スキャン") || b.textContent.includes("発見")) b.click() })')
    console.log('  分析ボタンクリック — 10秒待機')
    await sleep(10000)
  }
  totalErrors += reportErrors('discovery')
  await screenshot('deep-discovery')
  console.log()

  // ──────────────────────────────────────
  // 6. Dashboard - 全体表示
  // ──────────────────────────────────────
  console.log('━━━ 6. Dashboard (/) ━━━')
  resetTracking()
  await send('Page.navigate', { url: BASE + '/' })
  await sleep(5000)
  const dashContent = await eval_('document.body?.innerText || ""')
  console.log(`  ダッシュボード内容: ${dashContent.slice(0, 300)}`)
  totalErrors += reportErrors('dashboard')
  await screenshot('deep-dashboard')
  console.log()

  // ──────────────────────────────────────
  // Summary
  // ──────────────────────────────────────
  console.log('━━━ 検証サマリー ━━━')
  console.log(`合計コンソールエラー: ${totalErrors}`)
  console.log(totalErrors === 0 ? '✅ ALL CLEAR' : `❌ ${totalErrors} ERRORS FOUND`)

  ws.destroy()
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
