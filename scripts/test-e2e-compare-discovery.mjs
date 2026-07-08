/**
 * E2E tests for LP Compare and Discovery
 */
import http from 'http'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const OUT_DIR = path.resolve('verify_output')
let msgId = 0, ws = null
const pending = new Map()
const errors = []

async function getPageWs() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/list', res => {
      let d = ''; res.on('data', c => d += c)
      res.on('end', () => {
        const p = JSON.parse(d).find(p => p.type === 'page' && p.url.includes('localhost:3002'))
        resolve(p?.webSocketDebuggerUrl)
      })
    }).on('error', reject)
  })
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(wsUrl)
    const key = crypto.randomBytes(16).toString('base64')
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' }
    })
    req.on('upgrade', (_, socket) => {
      ws = socket; let buf = Buffer.alloc(0)
      socket.on('data', chunk => {
        buf = Buffer.concat([buf, chunk])
        while (buf.length >= 2) {
          let off = 2, len = buf[1] & 0x7f
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
          if (buf.length < off + len) return
          const data = buf.slice(off, off + len).toString(); buf = buf.slice(off + len)
          try {
            const m = JSON.parse(data)
            if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
            if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
              const text = (m.params.args || []).map(a => a.value || a.description || '').join(' ')
              errors.push(text.slice(0, 300))
              console.log(`  [CONSOLE ERROR] ${text.slice(0, 200)}`)
            }
            if (m.method === 'Runtime.exceptionThrown') {
              const desc = (m.params?.exceptionDetails?.exception?.description || '').slice(0, 300)
              errors.push(desc)
              console.log(`  [EXCEPTION] ${desc.slice(0, 200)}`)
            }
            if (m.method === 'Network.responseReceived') {
              const r = m.params.response
              if (r.url.includes('/api/')) {
                const icon = r.status >= 400 ? '❌' : '✅'
                console.log(`  [${icon} HTTP ${r.status}] ${r.url.slice(0, 120)}`)
                if (r.status >= 400) errors.push(`HTTP ${r.status}: ${r.url}`)
              }
            }
          } catch {}
        }
      }); resolve()
    })
    req.on('error', reject); req.end()
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
    pending.set(id, resolve); ws.write(Buffer.concat([header, masked]))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')) } }, 60000)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
async function eval_(e) { const r = await send('Runtime.evaluate', { expression: e }); return r.result?.result?.value }
async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(r.result.data, 'base64'))
}

async function main() {
  const wsUrl = await getPageWs()
  await connect(wsUrl)
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Page.enable')

  // ═══════════════════════════════════════════════
  // TEST: LP比較分析
  // ═══════════════════════════════════════════════
  console.log('\n━━━ LP比較分析: 分析実行 ━━━')
  errors.length = 0
  await send('Page.navigate', { url: 'http://localhost:3002/compare' })
  await sleep(5000)

  // Check current state
  const cmpState = await eval_(`JSON.stringify({
    canSubmit: (() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('分析開始'));
      return btn ? !btn.disabled : 'no button';
    })(),
    inputs: [...document.querySelectorAll('input[type=text], input[type=url], input:not([type])')].map(i => ({
      value: i.value.slice(0, 50), placeholder: i.placeholder?.slice(0, 30)
    })),
  })`)
  console.log('  State:', cmpState)

  // If inputs are already filled from previous session, just click 分析開始
  console.log('  分析開始クリック...')
  await eval_(`document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('分析開始')) b.click() })`)

  // Wait for result
  for (let i = 0; i < 18; i++) {
    await sleep(5000)
    const body = await eval_('document.body?.innerText?.slice(0, 500) || ""')
    const isLoading = body.includes('分析中') || body.includes('スキャン中') || body.includes('読み込み') || body.includes('progress_activity')
    const hasResult = body.includes('スコア') || body.includes('パフォーマンス') || body.includes('評価')
    const hasError = body.includes('エラー') || body.includes('Error') || body.includes('失敗') || body.includes('拒否')
    console.log(`    ${(i+1)*5}s: loading=${isLoading} result=${hasResult} error=${hasError}`)
    if (hasError) {
      console.log(`    ERROR: ${body.slice(0, 300)}`)
      break
    }
    if (hasResult && !isLoading) break
    if (!isLoading && i > 2) break
  }

  await screenshot('e2e-compare-final')
  console.log(`  エラー: ${errors.length} 件`)
  errors.forEach(e => console.log(`    ${e}`))

  // ═══════════════════════════════════════════════
  // TEST: Discovery — 競合発見
  // ═══════════════════════════════════════════════
  console.log('\n━━━ Discovery: 競合発見スキャン ━━━')
  errors.length = 0
  await send('Page.navigate', { url: 'http://localhost:3002/discovery' })
  await sleep(5000)

  // Find and fill input
  const discInput = await eval_(`JSON.stringify({
    inputs: [...document.querySelectorAll('input')].map(i => ({ type: i.type, placeholder: i.placeholder?.slice(0,40), value: i.value.slice(0,30) })),
    buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => t.includes('発見') || t.includes('分析') || t.includes('競合')).slice(0,5),
  })`)
  console.log('  Input state:', discInput)

  // Fill URL
  await eval_(`(() => {
    const inp = document.querySelector('input[type=text], input[type=url], input:not([type])');
    if (!inp) return 'no input';
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(inp, 'https://www.petabit.co.jp');
    const tracker = inp._valueTracker;
    if (tracker) tracker.setValue('');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return 'set';
  })()`)
  await sleep(500)

  // Click scan button
  console.log('  スキャン開始...')
  await eval_(`document.querySelectorAll('button').forEach(b => {
    const t = b.textContent;
    if (t.includes('競合') || t.includes('発見') || t.includes('分析') || t.includes('スキャン')) {
      console.log('clicking:', t);
      b.click();
    }
  })`)

  // Wait for completion
  for (let i = 0; i < 18; i++) {
    await sleep(5000)
    const body = await eval_('document.body?.innerText?.slice(0, 500) || ""')
    const isLoading = body.includes('検索中') || body.includes('スキャン') || body.includes('読み込み') || body.includes('progress_activity')
    const hasResult = body.includes('競合') && (body.includes('サイト') || body.includes('比較'))
    const hasError = body.includes('エラー') || body.includes('Error') || body.includes('失敗') || body.includes('拒否') || body.includes('usage-limited')
    console.log(`    ${(i+1)*5}s: loading=${isLoading} result=${hasResult} error=${hasError}`)
    if (hasError) {
      const errBody = await eval_('document.body?.innerText?.slice(0, 800) || ""')
      console.log(`    ERROR: ${errBody.slice(0, 300)}`)
      break
    }
    if (hasResult && !isLoading) break
    if (!isLoading && i > 3) break
  }

  await screenshot('e2e-discovery-final')
  console.log(`  エラー: ${errors.length} 件`)
  errors.forEach(e => console.log(`    ${e}`))

  // ═══════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════
  console.log('\n━━━ E2E結果サマリー ━━━')
  console.log(`エラー合計: ${errors.length}`)
  if (errors.length === 0) console.log('✅ ALL PASS')
  else { console.log('❌ ISSUES FOUND'); errors.forEach((e,i) => console.log(`  ${i+1}. ${e}`)) }

  ws.destroy()
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
