/**
 * Test real user actions that could produce errors:
 * 1. AI考察: Send an actual chat message and wait for stream response
 * 2. Discovery: Run scan and wait for full completion
 * 3. Creative Review: Check if upload flow works
 * 4. 要点パック: Check for 401/403/404 in actual API responses (not page text)
 */
import http from 'http'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const OUT_DIR = path.resolve('verify_output')
let msgId = 0, ws = null
const pending = new Map()
const captured = { console: [], network: [] }

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(wsUrl)
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
              captured.console.push({ type: m.params.type, text: text.slice(0, 800) })
            }
            if (m.method === 'Runtime.exceptionThrown') {
              captured.console.push({ type: 'EXCEPTION', text: (m.params?.exceptionDetails?.exception?.description || '').slice(0, 800) })
            }
            if (m.method === 'Network.requestWillBeSent') {
              const r = m.params.request
              if (r.url.includes('/api/')) {
                captured.network.push({
                  id: m.params.requestId,
                  url: r.url,
                  method: r.method,
                  phase: 'request',
                  time: Date.now()
                })
              }
            }
            if (m.method === 'Network.responseReceived') {
              const r = m.params.response
              if (r.url.includes('/api/')) {
                captured.network.push({
                  id: m.params.requestId,
                  url: r.url,
                  status: r.status,
                  phase: 'response',
                  time: Date.now()
                })
              }
            }
            if (m.method === 'Network.loadingFailed') {
              const req = captured.network.find(n => n.id === m.params.requestId)
              if (req) {
                captured.network.push({
                  id: m.params.requestId,
                  url: req.url,
                  error: m.params.errorText,
                  phase: 'failed',
                  time: Date.now()
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')) } }, 60000)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
async function eval_(e) { const r = await send('Runtime.evaluate', { expression: e }); return r.result?.result?.value }

async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(r.result.data, 'base64'))
}

function reset() { captured.console.length = 0; captured.network.length = 0 }

function printResults(label) {
  const errors = captured.console.filter(c => c.type === 'error' || c.type === 'EXCEPTION')
  const apiCalls = captured.network.filter(n => n.phase === 'response' || n.phase === 'failed')
  const apiFails = apiCalls.filter(n => (n.status && n.status >= 400) || n.phase === 'failed')

  console.log(`  Console: ${errors.length} errors / ${captured.console.length} total`)
  errors.forEach(e => console.log(`    ❌ ${e.text.slice(0, 300)}`))

  console.log(`  API: ${apiCalls.length} calls / ${apiFails.length} failures`)
  apiCalls.forEach(n => {
    const icon = (n.status >= 400 || n.phase === 'failed') ? '❌' : '✅'
    console.log(`    ${icon} ${n.status || 'FAIL'} ${n.url?.slice(0, 150) || n.error}`)
  })
}

async function main() {
  const pages = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/list', res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    }).on('error', reject)
  })
  const page = pages.find(p => p.type === 'page' && p.url.includes('localhost:3002'))
  await connect(page.webSocketDebuggerUrl)
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Page.enable')

  const BASE = 'http://localhost:3002'

  // ═══════════════════════════════════════════════
  // TEST 1: AI考察 — 実際にチャットメッセージを送信
  // ═══════════════════════════════════════════════
  console.log('━━━ TEST 1: AI考察 チャットメッセージ送信 ━━━')
  reset()
  await send('Page.navigate', { url: BASE + '/ads/ai' })
  await sleep(6000)

  // First click "コンテキスト更新" to load data context
  console.log('  コンテキスト更新クリック...')
  await eval_(`document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('コンテキスト更新')) b.click() })`)
  await sleep(8000)

  // Type a message in the textarea
  console.log('  メッセージ入力: "PV数の推移を教えて"')
  await eval_(`(() => {
    const ta = document.querySelector('textarea');
    if (!ta) { console.log('No textarea found'); return 'no textarea'; }
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, 'PV数の推移を教えて');
    ta.dispatchEvent(new Event('input', {bubbles:true}));
    return 'ok';
  })()`)
  await sleep(500)

  // Click send button
  console.log('  送信ボタンクリック...')
  await eval_(`document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('send') || b.querySelector('span[class*=material]')?.textContent === 'send') b.click() })`)

  // Wait for AI response with streaming
  console.log('  AI応答待ち (最大45秒)...')
  for (let i = 0; i < 9; i++) {
    await sleep(5000)
    const body = await eval_('document.body?.innerText || ""')
    const hasResponse = body.includes('PV') && (body.includes('推移') || body.includes('分析') || body.includes('傾向'))
    const hasError = body.includes('エラー') || body.includes('Error') || body.includes('失敗')
    const isStreaming = body.includes('考え中') || body.includes('応答中') || body.includes('生成中')
    console.log(`    ${(i+1)*5}s: response=${hasResponse} error=${hasError} streaming=${isStreaming}`)
    if (hasResponse || hasError) break
  }

  printResults('AI考察')
  await screenshot('test-ai-chat')

  // ═══════════════════════════════════════════════
  // TEST 2: LP比較分析 — URLを入力して分析
  // ═══════════════════════════════════════════════
  console.log('\n━━━ TEST 2: LP比較分析 ━━━')
  reset()
  await send('Page.navigate', { url: BASE + '/compare' })
  await sleep(5000)

  const compareState = await eval_(`JSON.stringify({
    inputs: document.querySelectorAll('input').length,
    buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean).slice(0, 10),
    body: document.body?.innerText?.slice(0, 300)
  })`)
  console.log('  Compare state:', compareState)
  printResults('LP比較')
  await screenshot('test-compare')

  // ═══════════════════════════════════════════════
  // TEST 3: Creative Review — アップロードフォームの状態確認
  // ═══════════════════════════════════════════════
  console.log('\n━━━ TEST 3: Creative Review ━━━')
  reset()
  await send('Page.navigate', { url: BASE + '/creative-review' })
  await sleep(5000)

  const crState = await eval_(`JSON.stringify({
    fileInput: !!document.querySelector('input[type=file]'),
    dropZone: !!document.querySelector('[class*=drop], [class*=Drop], [class*=upload], [class*=Upload]'),
    buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean).slice(0, 10),
    phases: document.body?.innerText?.match(/Step \\d|ステップ \\d|アップロード|レビュー|バナー|生成/gi) || [],
    body: document.body?.innerText?.slice(0, 500)
  })`)
  console.log('  CR state:', crState)
  printResults('Creative Review')
  await screenshot('test-creative-review-state')

  // ═══════════════════════════════════════════════
  // TEST 4: 設定ページ — API key 状態確認
  // ═══════════════════════════════════════════════
  console.log('\n━━━ TEST 4: 設定ページ ━━━')
  reset()
  await send('Page.navigate', { url: BASE + '/settings' })
  await sleep(3000)

  const settingsState = await eval_(`JSON.stringify({
    body: document.body?.innerText?.slice(0, 800),
    inputs: [...document.querySelectorAll('input')].map(i => ({ type: i.type, placeholder: i.placeholder, hasValue: !!i.value })),
  })`)
  console.log('  Settings:', settingsState)
  printResults('設定')
  await screenshot('test-settings')

  console.log('\n━━━ 完了 ━━━')
  ws.destroy()
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
