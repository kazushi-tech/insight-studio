/**
 * Actually send a chat message in AI考察 using the correct input element.
 * The page uses <input> not <textarea>.
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
              if (r.url.includes('/api/') && r.status >= 400) {
                errors.push(`HTTP ${r.status}: ${r.url}`)
                console.log(`  [HTTP ${r.status}] ${r.url.slice(0, 150)}`)
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

  console.log('━━━ AI考察: 実チャットテスト ━━━\n')

  // Navigate
  await send('Page.navigate', { url: 'http://localhost:3002/ads/ai' })
  await sleep(6000)

  // Verify input element
  const inputInfo = await eval_(`JSON.stringify({
    input: !!document.querySelector('input[placeholder*="AI"]'),
    placeholder: document.querySelector('input[placeholder*="AI"]')?.placeholder,
    disabled: document.querySelector('input[placeholder*="AI"]')?.disabled,
    sendDisabled: [...document.querySelectorAll('button')].find(b => b.querySelector('span')?.textContent?.includes('send'))?.disabled,
  })`)
  console.log('Input info:', inputInfo)

  // First, click "コンテキスト更新" to load data
  console.log('\n  Step 1: コンテキスト更新...')
  await eval_(`document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('コンテキスト更新')) b.click() })`)
  await sleep(10000)

  // Check if input is now enabled
  const afterContext = await eval_(`JSON.stringify({
    inputDisabled: document.querySelector('input[placeholder*="AI"]')?.disabled,
    sendDisabled: [...document.querySelectorAll('button')].find(b => b.querySelector('span')?.textContent?.includes('send'))?.disabled,
    promptDisabled: document.querySelector('input')?.disabled,
  })`)
  console.log('  After context update:', afterContext)
  await screenshot('ai-after-context')

  // Type message using the correct <input> element
  console.log('\n  Step 2: メッセージ入力...')
  const typed = await eval_(`(() => {
    // Find the chat input (not URL inputs etc)
    const input = document.querySelector('input[placeholder*="AI"]') ||
                  document.querySelector('.rounded-full input') ||
                  [...document.querySelectorAll('input')].find(i => i.placeholder?.includes('質問'));
    if (!input) return 'no input found';

    // Set value using React-compatible method
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(input, 'PVの推移を分析して');

    // Trigger React events
    const tracker = input._valueTracker;
    if (tracker) tracker.setValue('');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    return 'typed: ' + input.value;
  })()`)
  console.log('  Input:', typed)
  await sleep(500)

  // Check send button state
  const sendState = await eval_(`JSON.stringify({
    inputValue: (document.querySelector('input[placeholder*="AI"]') || document.querySelector('.rounded-full input'))?.value,
    sendDisabled: [...document.querySelectorAll('button')].find(b => b.querySelector('span')?.textContent?.includes('send'))?.disabled,
  })`)
  console.log('  Send state:', sendState)

  // Click send
  console.log('\n  Step 3: 送信...')
  const sendResult = await eval_(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => {
      const span = b.querySelector('span');
      return span && span.textContent.trim() === 'send';
    });
    if (!btn) return 'no send button';
    if (btn.disabled) return 'send button is disabled';
    btn.click();
    return 'clicked';
  })()`)
  console.log('  Send result:', sendResult)

  // If button is still disabled, try pressing Enter
  if (sendResult === 'send button is disabled') {
    console.log('  送信ボタンdisabled — Enterキーで送信試行...')
    await eval_(`(() => {
      const input = document.querySelector('input[placeholder*="AI"]') || document.querySelector('.rounded-full input');
      if (input) {
        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }
    })()`)
  }

  // Wait for response
  console.log('\n  Step 4: 応答待ち (最大60秒)...')
  for (let i = 0; i < 12; i++) {
    await sleep(5000)
    const state = await eval_(`JSON.stringify({
      bodyLength: document.body?.innerText?.length,
      hasAssistant: document.body?.innerText?.includes('分析') || document.body?.innerText?.includes('PV'),
      hasError: document.body?.innerText?.includes('エラー') || document.body?.innerText?.includes('Error'),
      isStreaming: document.body?.innerText?.includes('生成中') || document.body?.innerText?.includes('応答中'),
      lastContent: document.body?.innerText?.slice(-300),
    })`)
    const s = JSON.parse(state || '{}')
    console.log(`    ${(i+1)*5}s: streaming=${s.isStreaming} error=${s.hasError} bodyLen=${s.bodyLength}`)
    if (s.hasError) {
      console.log(`    ERROR DETECTED: ${s.lastContent?.slice(0, 200)}`)
      break
    }
    if (s.isStreaming === false && i > 3) break
  }

  await screenshot('ai-chat-final')

  // Get full page content at the end
  const finalBody = await eval_('document.body?.innerText || ""')
  console.log('\n  Final page content (last 500 chars):')
  console.log(finalBody.slice(-500))

  console.log(`\n━━━ 結果: エラー ${errors.length} 件 ━━━`)
  errors.forEach((e, i) => console.log(`  ${i+1}. ${e}`))

  ws.destroy()
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
