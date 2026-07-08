/**
 * Check the current state of the user's browser - what errors are visible NOW?
 */
import http from 'http'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const OUT_DIR = path.resolve('verify_output')
let CDP_URL = null
let msgId = 0, ws = null
const pending = new Map()

async function getPages() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/list', res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve(JSON.parse(d)))
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')) } }, 30000)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
async function eval_(e) { const r = await send('Runtime.evaluate', { expression: e }); return r.result?.result?.value }

async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(r.result.data, 'base64'))
}

async function main() {
  const pages = await getPages()
  const appPages = pages.filter(p => p.type === 'page' && p.url.includes('localhost:3002'))

  console.log('=== ユーザーブラウザの現在の状態 ===\n')

  for (const page of appPages) {
    console.log(`Page: ${page.url}`)
    CDP_URL = page.webSocketDebuggerUrl
    await connect(CDP_URL)

    // Take current screenshot
    await screenshot('current-state')

    // Get full page content
    const url = await eval_('location.href')
    console.log(`  Current URL: ${url}`)

    // Check for visible error messages
    const errorElements = await eval_(`JSON.stringify({
      alerts: [...document.querySelectorAll('[role=alert]')].map(e => e.textContent.slice(0, 200)),
      errorClasses: [...document.querySelectorAll('[class*=error], [class*=Error], .text-red, [class*=red], [class*=danger], [class*=warning]')].map(e => ({
        tag: e.tagName,
        class: e.className.slice(0, 100),
        text: e.textContent.slice(0, 200),
      })),
      toasts: [...document.querySelectorAll('[class*=toast], [class*=Toast], [class*=notification], [class*=Notification]')].map(e => e.textContent.slice(0, 200)),
      bodyErrors: (document.body?.innerText || '').match(/エラー|error|failed|失敗|拒否|exception|500|404|403|401|timeout/gi) || [],
    })`)
    console.log(`  Error elements: ${errorElements}`)

    // Check for any React error boundary
    const hasErrorBoundary = await eval_('!!document.querySelector("[class*=error-boundary], [class*=ErrorBoundary], [data-error]")')
    console.log(`  Error boundary: ${hasErrorBoundary}`)

    // Get full body text for analysis
    const bodyText = await eval_('document.body?.innerText || ""')
    console.log(`\n  === Full page text ===`)
    console.log(bodyText.slice(0, 2000))
    console.log(`  === End ===\n`)

    ws.destroy()
  }

  // Now navigate to each feature page and check for errors
  console.log('\n=== 各ページの現在のエラー状態チェック ===\n')
  const targetPages = [
    '/ads/pack', '/ads/graphs', '/ads/ai', '/creative-review', '/discovery', '/'
  ]

  // Reconnect to the page
  const mainPage = appPages[0]
  await connect(mainPage.webSocketDebuggerUrl)

  for (const pagePath of targetPages) {
    console.log(`\n--- ${pagePath} ---`)
    await send('Page.navigate', { url: BASE + pagePath })
    await sleep(5000)

    const actualUrl = await eval_('location.href')
    console.log(`  URL: ${actualUrl}`)

    // Look for any error indicators
    const state = await eval_(`JSON.stringify({
      hasAlerts: document.querySelectorAll('[role=alert]').length,
      redText: [...document.querySelectorAll('*')].filter(el => {
        const style = getComputedStyle(el);
        return (style.color.includes('255, 0') || style.color.includes('239, 68') || style.color.includes('220, 38') || style.backgroundColor.includes('254, 226') || style.backgroundColor.includes('254, 202'));
      }).map(el => el.textContent.trim().slice(0, 100)).filter(Boolean).slice(0, 5),
      errorTextInBody: [...new Set((document.body.innerText.match(/.*(?:エラー|Error|error|failed|失敗|拒否|exception).*/gi) || []).map(l => l.trim().slice(0, 150)))].slice(0, 10),
    })`)
    console.log(`  State: ${state}`)

    await screenshot(`state-${pagePath.replace(/\//g, '_').replace(/^_/, '') || 'root'}`)
  }

  ws.destroy()
  process.exit(0)
}

const BASE = 'http://localhost:3002'
main().catch(e => { console.error(e); process.exit(1) })
