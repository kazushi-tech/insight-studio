/**
 * CDP-based full page verification script.
 * Navigates to every major route, captures screenshots + checks for errors.
 */
import http from 'http'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const CDP_URL = 'ws://127.0.0.1:9222/devtools/page/9A967EFEC66AB8C20B73DC4DAB3B7142'
const BASE = 'http://localhost:3002'
const OUT_DIR = path.resolve('verify_output')

const PAGES = [
  { path: '/ads/pack', name: '要点パック' },
  { path: '/ads/graphs', name: 'グラフ' },
  { path: '/ads/ai', name: 'AI考察' },
  { path: '/creative-review', name: 'クリエイティブレビュー' },
  { path: '/discovery', name: 'Discovery' },
  { path: '/compare', name: 'LP比較分析' },
  { path: '/', name: 'Dashboard' },
  { path: '/settings', name: '設定' },
]

let msgId = 0, ws = null
const pending = new Map()
let pageConsoleErrors = []

function connect() {
  return new Promise((resolve, reject) => {
    const url = new URL(CDP_URL)
    const key = crypto.randomBytes(16).toString('base64')
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname,
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
              pageConsoleErrors.push(text.slice(0, 200))
            }
            if (m.method === 'Runtime.exceptionThrown') {
              pageConsoleErrors.push((m.params?.exceptionDetails?.exception?.description || 'exception').slice(0, 200))
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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)) } }, 30000)
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
async function eval_(e) { const r = await send('Runtime.evaluate', { expression: e }); return r.result?.result?.value }

async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) {
    fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(r.result.data, 'base64'))
    return true
  }
  return false
}

async function main() {
  console.log('=== Insight Studio 全ページ動作検証 ===\n')
  await connect()
  await send('Runtime.enable')
  await send('Page.enable')

  const results = []

  for (const page of PAGES) {
    pageConsoleErrors = []
    console.log(`--- ${page.name} (${page.path}) ---`)
    await send('Page.navigate', { url: BASE + page.path })
    await sleep(4000)

    const url = await eval_('location.href')
    const h1 = await eval_('document.querySelector("h1")?.textContent || "no h1"')
    const bodySnippet = await eval_('document.body?.innerText?.slice(0, 300) || ""')

    const redirected = url ? !url.includes(page.path) : true
    const ssName = page.path.replace(/\//g, '_').replace(/^_/, '') || 'root'
    await screenshot(`verify-${ssName}`)

    const errCount = pageConsoleErrors.length
    results.push({ name: page.name, path: page.path, url, redirected, h1, errCount, errors: [...pageConsoleErrors] })

    console.log(`  URL: ${url}`)
    console.log(`  Redirected: ${redirected}`)
    console.log(`  H1: ${h1}`)
    console.log(`  Body: ${(bodySnippet || '').slice(0, 120)}`)
    console.log(`  Console errors: ${errCount}`)
    if (errCount > 0) pageConsoleErrors.forEach(e => console.log(`    ⚠ ${e.slice(0, 120)}`))
    console.log()
  }

  // Banner generation text check
  console.log('--- バナー生成テキスト残存チェック ---')
  await send('Page.navigate', { url: BASE + '/creative-review' })
  await sleep(3000)
  const hasBanner = await eval_('document.body.innerText.includes("バナー生成") || document.body.innerText.includes("改善バナー")')
  console.log(`  バナー生成/改善バナー テキスト: ${hasBanner ? '❌ 残存' : '✅ なし'}`)
  console.log()

  // Summary
  console.log('=== 検証サマリー ===')
  let allPass = true
  for (const r of results) {
    const ok = !r.redirected && r.errCount === 0
    if (!ok) allPass = false
    console.log(`${ok ? '✅' : '❌'} ${r.name} (${r.path}) → ${r.url}${r.errCount > 0 ? ` [${r.errCount} errors]` : ''}${r.redirected ? ' [REDIRECTED]' : ''}`)
  }
  if (hasBanner) { allPass = false; console.log('❌ バナー生成テキスト残存') }
  else { console.log('✅ バナー生成テキスト完全除去') }
  console.log(`\n全体: ${allPass ? '✅ ALL PASS' : '❌ ISSUES FOUND'}`)

  ws.destroy()
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
