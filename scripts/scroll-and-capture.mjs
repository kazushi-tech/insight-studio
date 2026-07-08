/**
 * Navigate to each page, scroll through entire content, capture at each scroll position.
 * Also check for any visible red/error elements.
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
        const pages = JSON.parse(d)
        const p = pages.find(p => p.type === 'page' && p.url.includes('localhost:3002'))
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
              errors.push((m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 300))
            }
            if (m.method === 'Runtime.exceptionThrown') {
              errors.push((m.params?.exceptionDetails?.exception?.description || '').slice(0, 300))
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
  const wsUrl = await getPageWs()
  await connect(wsUrl)
  await send('Runtime.enable')
  await send('Network.enable')

  const BASE = 'http://localhost:3002'
  const pages = [
    { path: '/ads/pack', name: 'pack' },
    { path: '/ads/graphs', name: 'graphs' },
    { path: '/ads/ai', name: 'ai' },
    { path: '/creative-review', name: 'creative-review' },
    { path: '/discovery', name: 'discovery' },
    { path: '/', name: 'dashboard' },
  ]

  for (const page of pages) {
    errors.length = 0
    console.log(`\n━━━ ${page.name} (${page.path}) ━━━`)
    await send('Page.navigate', { url: BASE + page.path })
    await sleep(5000)

    // Get page dimensions
    const dims = await eval_('JSON.stringify({ scrollHeight: document.documentElement.scrollHeight, viewportHeight: window.innerHeight })')
    const { scrollHeight, viewportHeight } = JSON.parse(dims || '{}')
    console.log(`  scrollHeight: ${scrollHeight}, viewport: ${viewportHeight}`)

    // Capture at top
    await screenshot(`scroll-${page.name}-top`)

    // Scroll through page and capture
    if (scrollHeight > viewportHeight) {
      const steps = Math.min(Math.ceil(scrollHeight / viewportHeight), 5)
      for (let i = 1; i <= steps; i++) {
        const scrollTo = Math.min(i * viewportHeight, scrollHeight - viewportHeight)
        await eval_(`window.scrollTo(0, ${scrollTo})`)
        await sleep(1000)
        await screenshot(`scroll-${page.name}-${i}`)
      }
      // Reset scroll
      await eval_('window.scrollTo(0, 0)')
    }

    // Report errors
    if (errors.length > 0) {
      console.log(`  ❌ ${errors.length} console errors:`)
      errors.forEach(e => console.log(`    ${e.slice(0, 200)}`))
    } else {
      console.log(`  ✅ No console errors`)
    }
  }

  ws.destroy()
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
