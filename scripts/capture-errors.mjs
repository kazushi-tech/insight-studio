/**
 * Capture all errors from the current browser session.
 * Injects a global error listener and checks for existing issues.
 */
import http from 'http'
import crypto from 'crypto'

const CDP_URL = 'ws://127.0.0.1:9222/devtools/page/9A967EFEC66AB8C20B73DC4DAB3B7142'
let msgId = 0, ws = null
const pending = new Map()
const captured = []

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
              const args = (m.params.args || []).map(a => a.value || a.description || a.preview?.description || '').join(' ')
              captured.push({ type: m.params.type, text: args.slice(0, 800) })
            }
            if (m.method === 'Runtime.exceptionThrown') {
              captured.push({ type: 'EXCEPTION', text: (m.params?.exceptionDetails?.exception?.description || 'unknown').slice(0, 800) })
            }
            if (m.method === 'Network.responseReceived') {
              const r = m.params.response
              if (r.status >= 400) captured.push({ type: 'HTTP_ERROR', text: `${r.status} ${r.url}` })
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout`)) } }, 30000)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
async function eval_(e) { const r = await send('Runtime.evaluate', { expression: e }); return r.result?.result?.value }

async function main() {
  await connect()
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Page.enable')
  await send('Log.enable')

  console.log('=== 各ページで実機能をテスト ===\n')

  // ── 要点パック: 実際にレポート生成ボタンを押して待つ ──
  console.log('━━━ 要点パック: レポート生成テスト ━━━')
  captured.length = 0
  await send('Page.navigate', { url: 'http://localhost:3002/ads/pack' })
  await sleep(5000)

  // Check current state
  const packState = await eval_(`JSON.stringify({
    buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()),
    loading: document.body.innerText.includes('取得中') || document.body.innerText.includes('読み込み'),
    errorText: document.querySelector('[role=alert]')?.textContent || document.querySelector('.error')?.textContent || '',
    bodySnippet: document.body.innerText.slice(0, 800)
  })`)
  console.log('  State:', packState)

  // Click 実行/生成 button
  await eval_(`document.querySelectorAll('button').forEach(b => {
    const t = b.textContent.trim();
    if (t.includes('実行') || t.includes('生成') || t.includes('取得') || t.includes('レポート')) {
      console.log('Clicking:', t);
      b.click();
    }
  })`)
  console.log('  ボタンクリック後 15秒待機...')
  await sleep(15000)

  const packAfter = await eval_(`JSON.stringify({
    loading: document.body.innerText.includes('取得中') || document.body.innerText.includes('読み込み') || document.body.innerText.includes('処理中'),
    errorText: document.querySelector('[role=alert]')?.textContent || '',
    bodySnippet: document.body.innerText.slice(0, 800)
  })`)
  console.log('  After:', packAfter)
  console.log('  Captured:', captured.length, 'messages')
  captured.filter(c => c.type === 'error' || c.type === 'EXCEPTION' || c.type === 'HTTP_ERROR').forEach(c => console.log(`  [${c.type}] ${c.text.slice(0, 300)}`))
  console.log()

  // ── グラフ: 分析実行テスト ──
  console.log('━━━ グラフ: 分析実行テスト ━━━')
  captured.length = 0
  await send('Page.navigate', { url: 'http://localhost:3002/ads/graphs' })
  await sleep(5000)

  const graphState = await eval_(`JSON.stringify({
    buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean),
    selects: [...document.querySelectorAll('select')].map(s => s.value),
    bodySnippet: document.body.innerText.slice(0, 500)
  })`)
  console.log('  State:', graphState)

  // Click analyze
  await eval_(`document.querySelectorAll('button').forEach(b => {
    const t = b.textContent.trim();
    if (t.includes('実行') || t.includes('分析') || t.includes('取得') || t.includes('更新')) { console.log('Clicking:', t); b.click(); }
  })`)
  await sleep(15000)

  const graphAfter = await eval_(`JSON.stringify({
    hasCharts: !!document.querySelector('canvas, svg path, .recharts-wrapper'),
    errorText: document.querySelector('[role=alert]')?.textContent || '',
    bodySnippet: document.body.innerText.slice(0, 500)
  })`)
  console.log('  After:', graphAfter)
  captured.filter(c => c.type === 'error' || c.type === 'EXCEPTION' || c.type === 'HTTP_ERROR').forEach(c => console.log(`  [${c.type}] ${c.text.slice(0, 300)}`))
  console.log()

  // ── AI考察: 考察実行テスト ──
  console.log('━━━ AI考察: 考察実行テスト ━━━')
  captured.length = 0
  await send('Page.navigate', { url: 'http://localhost:3002/ads/ai' })
  await sleep(5000)

  const aiState = await eval_(`JSON.stringify({
    buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean),
    steps: [...document.querySelectorAll('[class*=step], [class*=Step]')].map(e => e.textContent.slice(0,50)),
    bodySnippet: document.body.innerText.slice(0, 500)
  })`)
  console.log('  State:', aiState)

  // Select a topic and click
  await eval_(`document.querySelectorAll('button').forEach(b => {
    const t = b.textContent.trim();
    if (t.includes('トピック') || t.includes('考察') || t.includes('生成') || t.includes('実行') || t.includes('分析')) { console.log('Clicking:', t); b.click(); }
  })`)
  await sleep(15000)

  const aiAfter = await eval_(`JSON.stringify({
    errorText: document.querySelector('[role=alert]')?.textContent || '',
    bodySnippet: document.body.innerText.slice(0, 500)
  })`)
  console.log('  After:', aiAfter)
  captured.filter(c => c.type === 'error' || c.type === 'EXCEPTION' || c.type === 'HTTP_ERROR').forEach(c => console.log(`  [${c.type}] ${c.text.slice(0, 300)}`))
  console.log()

  // ── Discovery: 競合発見テスト ──
  console.log('━━━ Discovery: スキャンテスト ━━━')
  captured.length = 0
  await send('Page.navigate', { url: 'http://localhost:3002/discovery' })
  await sleep(5000)

  // Input URL
  await eval_(`(() => {
    const inp = document.querySelector('input[type=text], input[type=url], input:not([type])');
    if (!inp) return 'no input';
    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSet.call(inp, 'https://www.petabit.co.jp');
    inp.dispatchEvent(new Event('input', {bubbles:true}));
    inp.dispatchEvent(new Event('change', {bubbles:true}));
    return 'set';
  })()`)
  await sleep(500)

  // Click scan
  await eval_(`document.querySelectorAll('button').forEach(b => {
    const t = b.textContent.trim();
    if (t.includes('競合') || t.includes('分析') || t.includes('検索') || t.includes('発見') || t.includes('スキャン')) { console.log('Clicking:', t); b.click(); }
  })`)
  console.log('  スキャン開始 — 20秒待機...')
  await sleep(20000)

  const discAfter = await eval_(`JSON.stringify({
    url: location.href,
    errorText: document.querySelector('[role=alert]')?.textContent || '',
    bodySnippet: document.body.innerText.slice(0, 800)
  })`)
  console.log('  After:', discAfter)
  captured.filter(c => c.type === 'error' || c.type === 'EXCEPTION' || c.type === 'HTTP_ERROR').forEach(c => console.log(`  [${c.type}] ${c.text.slice(0, 300)}`))
  console.log()

  // ── Summary ──
  console.log('━━━ 全キャプチャ一覧 ━━━')
  const allErrs = captured.filter(c => c.type === 'error' || c.type === 'EXCEPTION' || c.type === 'HTTP_ERROR')
  console.log(`エラー総数: ${allErrs.length}`)
  allErrs.forEach((e, i) => console.log(`  ${i+1}. [${e.type}] ${e.text.slice(0, 400)}`))

  ws.destroy()
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
