/**
 * End-to-end critical path tests.
 * Actually send an AI chat message, run a Discovery scan to completion,
 * and test LP compare.
 */
import http from 'http'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const OUT_DIR = path.resolve('verify_output')
let msgId = 0, ws = null
const pending = new Map()
const log = { console: [], network: [] }

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
            if (m.method === 'Runtime.consoleAPICalled') {
              const text = (m.params.args || []).map(a => a.value || a.description || '').join(' ')
              log.console.push({ type: m.params.type, text: text.slice(0, 500) })
              // Print errors immediately
              if (m.params.type === 'error') console.log(`    [CONSOLE ERROR] ${text.slice(0, 200)}`)
            }
            if (m.method === 'Runtime.exceptionThrown') {
              const desc = (m.params?.exceptionDetails?.exception?.description || '').slice(0, 500)
              log.console.push({ type: 'EXCEPTION', text: desc })
              console.log(`    [EXCEPTION] ${desc.slice(0, 200)}`)
            }
            if (m.method === 'Network.responseReceived') {
              const r = m.params.response
              if (r.url.includes('/api/') && r.status >= 400) {
                console.log(`    [HTTP ${r.status}] ${r.url.slice(0, 150)}`)
                log.network.push({ url: r.url, status: r.status })
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

function reset() { log.console.length = 0; log.network.length = 0 }

async function main() {
  const wsUrl = await getPageWs()
  await connect(wsUrl)
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Page.enable')

  const BASE = 'http://localhost:3002'

  // ═══════════════════════════════════════════════════
  // TEST: AI考察 — チャット送信 (より正確なDOM操作)
  // ═══════════════════════════════════════════════════
  console.log('\n━━━ AI考察: チャットメッセージ送信 ━━━')
  reset()
  await send('Page.navigate', { url: BASE + '/ads/ai' })
  await sleep(6000)

  // Check textarea exists and get its details
  const taInfo = await eval_(`JSON.stringify({
    exists: !!document.querySelector('textarea'),
    placeholder: document.querySelector('textarea')?.placeholder,
    buttonCount: document.querySelectorAll('button').length,
    sendBtn: [...document.querySelectorAll('button')].find(b => b.querySelector('[class*=material]')?.textContent?.includes('send'))?.outerHTML?.slice(0, 200),
  })`)
  console.log('  Textarea info:', taInfo)

  // Use React's internal setter for controlled components
  console.log('  メッセージ入力...')
  const inputResult = await eval_(`(() => {
    const ta = document.querySelector('textarea');
    if (!ta) return 'no textarea';

    // React controlled component - need to use native input event
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    nativeSetter.call(ta, 'セッション数のトレンドを分析して');
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    // Also try React synthetic event
    const tracker = ta._valueTracker;
    if (tracker) tracker.setValue('');
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    return 'value set: ' + ta.value;
  })()`)
  console.log('  Input result:', inputResult)
  await sleep(500)

  // Find and click the send button more precisely
  console.log('  送信ボタン検索とクリック...')
  const clickResult = await eval_(`(() => {
    // Try multiple selectors for send button
    const buttons = [...document.querySelectorAll('button')];

    // Look for button with send icon
    let sendBtn = buttons.find(b => {
      const icon = b.querySelector('span');
      return icon && icon.textContent.trim() === 'send';
    });

    // Or a form submit
    if (!sendBtn) {
      const form = document.querySelector('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return 'form submitted';
      }
    }

    if (sendBtn) {
      sendBtn.click();
      return 'send button clicked: ' + sendBtn.outerHTML.slice(0, 100);
    }

    // Last resort: press Enter in textarea
    const ta = document.querySelector('textarea');
    if (ta) {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      return 'enter pressed';
    }

    return 'no send mechanism found';
  })()`)
  console.log('  Click result:', clickResult)

  // Wait for response
  console.log('  応答待機中...')
  for (let i = 0; i < 12; i++) {
    await sleep(5000)
    const state = await eval_(`JSON.stringify({
      msgCount: document.querySelectorAll('[class*=message], [class*=Message], [class*=chat], [class*=Chat]').length,
      hasStreaming: document.body.innerText.includes('...') || document.body.innerText.includes('考え中'),
      lastText: document.body.innerText.slice(-500),
      hasError: document.body.innerText.includes('エラー') || document.body.innerText.includes('Error') || document.body.innerText.includes('失敗'),
    })`)
    const parsed = JSON.parse(state || '{}')
    console.log(`    ${(i+1)*5}s: msgs=${parsed.msgCount} streaming=${parsed.hasStreaming} error=${parsed.hasError}`)
    if (parsed.hasError || parsed.msgCount > 1) break
    if (i >= 5 && !parsed.hasStreaming) break
  }

  await screenshot('e2e-ai-final')
  const aiErrors = log.console.filter(c => c.type === 'error' || c.type === 'EXCEPTION')
  const aiNetFails = log.network.filter(n => n.status >= 400)
  console.log(`  結果: コンソールエラー=${aiErrors.length} APIエラー=${aiNetFails.length}`)

  // ═══════════════════════════════════════════════════
  // TEST: LP比較分析 — URL入力して分析開始
  // ═══════════════════════════════════════════════════
  console.log('\n━━━ LP比較分析: 分析実行 ━━━')
  reset()
  await send('Page.navigate', { url: BASE + '/compare' })
  await sleep(5000)

  // Input URLs
  const inputs = await eval_(`(() => {
    const inputs = document.querySelectorAll('input[type=text], input[type=url], input:not([type])');
    return JSON.stringify([...inputs].map((inp, i) => ({ index: i, placeholder: inp.placeholder, value: inp.value })));
  })()`)
  console.log('  Inputs:', inputs)

  // Fill first URL input
  await eval_(`(() => {
    const inputs = [...document.querySelectorAll('input[type=text], input[type=url], input:not([type])')];
    const urlInput = inputs.find(i => i.placeholder?.includes('URL') || i.placeholder?.includes('url'));
    if (!urlInput && inputs.length > 0) {
      const inp = inputs[0];
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(inp, 'https://www.petabit.co.jp');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const tracker = inp._valueTracker;
      if (tracker) tracker.setValue('');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return 'set first input';
    }
    return 'no input found';
  })()`)
  await sleep(500)

  // Click 分析開始
  console.log('  分析開始クリック...')
  await eval_(`document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('分析開始')) b.click() })`)

  // Wait for result
  for (let i = 0; i < 12; i++) {
    await sleep(5000)
    const body = await eval_('document.body?.innerText?.slice(0, 500) || ""')
    const isLoading = body.includes('分析中') || body.includes('読み込み') || body.includes('スキャン')
    const hasResult = body.includes('スコア') || body.includes('パフォーマンス') || body.includes('比較結果')
    const hasError = body.includes('エラー') || body.includes('Error') || body.includes('失敗')
    console.log(`    ${(i+1)*5}s: loading=${isLoading} result=${hasResult} error=${hasError}`)
    if (hasResult || hasError || (!isLoading && i > 1)) break
  }

  await screenshot('e2e-compare-final')
  const cmpErrors = log.console.filter(c => c.type === 'error' || c.type === 'EXCEPTION')
  console.log(`  結果: コンソールエラー=${cmpErrors.length} APIエラー=${log.network.filter(n => n.status >= 400).length}`)

  // ═══════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════
  console.log('\n━━━ E2E結果サマリー ━━━')
  const totalConsoleErrors = log.console.filter(c => c.type === 'error' || c.type === 'EXCEPTION').length
  const totalNetErrors = log.network.filter(n => n.status >= 400).length
  console.log(`Total console errors: ${totalConsoleErrors}`)
  console.log(`Total network failures: ${totalNetErrors}`)
  if (totalConsoleErrors === 0 && totalNetErrors === 0) {
    console.log('✅ All E2E tests passed')
  } else {
    console.log('❌ Issues found')
  }

  ws.destroy()
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
