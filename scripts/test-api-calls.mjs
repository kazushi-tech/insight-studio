/**
 * Actually trigger API-calling features and track ALL network requests/responses.
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
const allConsole = []
const allNetwork = []
const requestMap = new Map()

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
            if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
            if (m.method === 'Runtime.consoleAPICalled') {
              const text = (m.params.args || []).map(a => a.value || a.description || '').join(' ')
              allConsole.push({ type: m.params.type, text: text.slice(0, 500) })
            }
            if (m.method === 'Runtime.exceptionThrown') {
              allConsole.push({ type: 'EXCEPTION', text: (m.params?.exceptionDetails?.exception?.description || '').slice(0, 800) })
            }
            // Track network requests
            if (m.method === 'Network.requestWillBeSent') {
              const r = m.params.request
              if (r.url.includes('/api/') || r.url.includes('localhost:3002/api') || r.url.includes('render.com') || r.url.includes('anthropic')) {
                requestMap.set(m.params.requestId, { url: r.url, method: r.method, time: Date.now() })
              }
            }
            if (m.method === 'Network.responseReceived') {
              const r = m.params.response
              const req = requestMap.get(m.params.requestId)
              if (req || r.status >= 400) {
                allNetwork.push({
                  url: r.url,
                  status: r.status,
                  statusText: r.statusText,
                  method: req?.method || 'GET',
                  elapsed: req ? Date.now() - req.time : null,
                })
              }
            }
            if (m.method === 'Network.loadingFailed') {
              const req = requestMap.get(m.params.requestId)
              if (req) {
                allNetwork.push({
                  url: req.url,
                  status: 'FAILED',
                  error: m.params.errorText,
                  method: req.method,
                })
              }
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
    if (payload.length < 126) { header = Buffer.alloc(6); header[0] = 0x81; header[1] = 0x80 | payload.length; mask.copy(header, 2) }
    else if (payload.length < 65536) { header = Buffer.alloc(8); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); mask.copy(header, 4) }
    else { header = Buffer.alloc(14); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(payload.length), 2); mask.copy(header, 10) }
    const masked = Buffer.alloc(payload.length); for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4]
    pending.set(id, resolve)
    ws.write(Buffer.concat([header, masked]))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout`)) } }, 60000)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
async function eval_(e) { const r = await send('Runtime.evaluate', { expression: e }); return r.result?.result?.value }

async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(r.result.data, 'base64'))
}

function reset() { allConsole.length = 0; allNetwork.length = 0; requestMap.clear() }

function printReport(label) {
  const errors = allConsole.filter(c => c.type === 'error' || c.type === 'EXCEPTION')
  const apiCalls = allNetwork.filter(n => n.url)
  const failures = apiCalls.filter(n => n.status >= 400 || n.status === 'FAILED')

  console.log(`\n  [Console] errors=${errors.length} total=${allConsole.length}`)
  errors.forEach(e => console.log(`    ❌ [${e.type}] ${e.text.slice(0, 300)}`))

  console.log(`  [Network] API calls=${apiCalls.length} failures=${failures.length}`)
  apiCalls.forEach(n => {
    const icon = (n.status >= 400 || n.status === 'FAILED') ? '❌' : '✅'
    console.log(`    ${icon} ${n.method} ${n.status} ${n.url.slice(0, 120)} ${n.elapsed ? `(${n.elapsed}ms)` : ''}`)
  })
}

async function main() {
  await connect()
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Page.enable')

  console.log('=== API呼び出し追跡テスト ===\n')

  // ═══════════════════════════════════════
  // TEST 1: AI考察 — メッセージ送信
  // ═══════════════════════════════════════
  console.log('━━━ TEST 1: AI考察 メッセージ送信 ━━━')
  reset()
  await send('Page.navigate', { url: BASE + '/ads/ai' })
  await sleep(5000)

  // Click "リスクを要約して" quick analysis button
  console.log('  "リスクを要約して" クリック')
  await eval_(`document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('リスクを要約')) b.click() })`)
  console.log('  応答待ち 30秒...')
  await sleep(30000)

  const aiResult = await eval_('document.body?.innerText?.slice(0, 1500) || ""')
  const hasAiResponse = aiResult.includes('リスク') || aiResult.includes('考察') || aiResult.includes('分析')
  console.log(`  AI応答あり: ${hasAiResponse}`)
  printReport('AI考察')
  await screenshot('test-ai-response')

  // ═══════════════════════════════════════
  // TEST 2: Discovery — スキャン完了まで待つ
  // ═══════════════════════════════════════
  console.log('\n━━━ TEST 2: Discovery スキャン完了待ち ━━━')
  reset()
  await send('Page.navigate', { url: BASE + '/discovery' })
  await sleep(5000)

  // Input URL
  await eval_(`(() => {
    const inp = document.querySelector('input');
    if (!inp) return;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(inp, 'https://www.petabit.co.jp');
    inp.dispatchEvent(new Event('input', {bubbles:true}));
    inp.dispatchEvent(new Event('change', {bubbles:true}));
  })()`)
  await sleep(500)

  // Click scan button
  console.log('  スキャンボタンクリック')
  await eval_(`document.querySelectorAll('button').forEach(b => {
    const t = b.textContent;
    if (t.includes('競合') || t.includes('発見') || t.includes('分析')) b.click();
  })`)

  // Wait and poll for completion
  for (let i = 0; i < 12; i++) {
    await sleep(10000)
    const body = await eval_('document.body?.innerText?.slice(0, 500) || ""')
    const isLoading = body.includes('検索中') || body.includes('読み込み中') || body.includes('スキャン中') || body.includes('progress_activity')
    const hasError = body.includes('エラー') || body.includes('失敗') || body.includes('Error')
    console.log(`  ${(i+1)*10}s: loading=${isLoading} error=${hasError}`)
    if (!isLoading || hasError) break
  }

  printReport('Discovery')
  await screenshot('test-discovery-result')

  // ═══════════════════════════════════════
  // TEST 3: グラフ — 再取得
  // ═══════════════════════════════════════
  console.log('\n━━━ TEST 3: グラフ 再取得 ━━━')
  reset()
  await send('Page.navigate', { url: BASE + '/ads/graphs' })
  await sleep(5000)
  console.log('  "再取得" クリック')
  await eval_(`document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('再取得')) b.click() })`)
  await sleep(15000)

  printReport('グラフ')
  await screenshot('test-graphs-result')

  // ═══════════════════════════════════════
  // TEST 4: 要点パック — レポート展開
  // ═══════════════════════════════════════
  console.log('\n━━━ TEST 4: 要点パック レポート展開 ━━━')
  reset()
  await send('Page.navigate', { url: BASE + '/ads/pack' })
  await sleep(5000)
  // Click "全て開く"
  console.log('  "全て開く" クリック')
  await eval_(`document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('全て開く')) b.click() })`)
  await sleep(5000)

  printReport('要点パック')
  await screenshot('test-pack-expand')

  // ═══════════════════════════════════════
  // FINAL SUMMARY
  // ═══════════════════════════════════════
  console.log('\n\n━━━ 最終サマリー ━━━')
  ws.destroy()
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
