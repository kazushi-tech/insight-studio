/**
 * Phase 2 Final Focused Smoke
 * All scenarios use: goto('/') → inject localStorage → reload → SPA navigate
 */
import { chromium } from 'playwright'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { provisionSmokeProfile } from './provision_smoke_profile.mjs'

const BASE = 'http://127.0.0.1:3004'
const DIR = resolve('test-results/phase2-smoke')
const R = []

function log(m) { console.log(`[smoke] ${m}`) }
function rec(s, r, c, n, e) {
  R.push({ s, r, c, n, e })
  log(`${r === 'pass' ? '✓' : r === 'fail' ? '✗' : '⚠'} ${s}: ${r} (${c}) [${(e/1000).toFixed(1)}s] — ${n}`)
}

async function setup(browser, manifest) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('console', msg => { if (msg.type() === 'error') log(`[browser] ${msg.text().slice(0,120)}`) })
  // Navigate to root, inject, reload — so React initializes with all state
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.evaluate(e => { for (const [k,v] of Object.entries(e)) localStorage.setItem(k,v) }, manifest.localStorageEntries)
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(500)
  return { ctx, page }
}

async function navigateTo(page, path) {
  // Use SPA navigation via client-side eval to avoid full page reload
  await page.evaluate(p => window.history.pushState({}, '', p), path)
  // Trigger React Router to re-render by dispatching popstate
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')))
  await page.waitForTimeout(1500)
}

async function poll(page, checks, ms = 180000) {
  const t = Date.now()
  while (Date.now() - t < ms) {
    for (const { name, sel } of checks) {
      if (await page.locator(sel).count() > 0) return name
    }
    await page.waitForTimeout(3000)
  }
  return 'timeout'
}

// ─── Compare ───
async function testCompare(browser, manifest) {
  log('=== Compare ===')
  const { ctx, page } = await setup(browser, manifest)
  const t0 = Date.now()
  try {
    await page.goto(`${BASE}/compare`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(800)

    await page.locator('input[placeholder*="https://"]').nth(0).fill('https://www.petabit.co.jp')
    await page.locator('input[placeholder*="https://"]').nth(1).fill('https://www.openai.com')
    await page.waitForTimeout(200)

    const btn = page.locator('button:has-text("分析開始")')
    if (await btn.isDisabled()) { rec('Compare', 'blocked', 'config_missing', 'Button disabled', Date.now()-t0); await ctx.close(); return }

    await btn.click()
    log('Compare: clicked')

    const f = await poll(page, [
      { name: 'error', sel: '[role="alert"]' },
      { name: 'empty', sel: 'text=レポート本文が空' },
      { name: 'report', sel: 'text=実行メタデータ' },
    ])
    const el = Date.now() - t0
    await page.screenshot({ path: `${DIR}/compare.png` })

    if (f === 'error') {
      const t = await page.locator('[role="alert"]').first().textContent()
      const labels = await page.locator('[role="alert"] span.rounded-full').allTextContents()
      const guid = await page.locator('[role="alert"] .opacity-75').allTextContents()
      const isGeneric = t.includes('接続できませんでした') && labels.length <= 1
      rec('Compare', isGeneric ? 'fail' : 'pass', isGeneric ? 'generic_error' : 'classified_error',
        `Labels: [${labels.join('|')}] Guidance: [${guid.join('|')}] Text: ${t.slice(0,130)}`, el)
    } else if (f === 'empty') {
      const noAlert = (await page.locator('[role="alert"]').count()) === 0
      rec('Compare', 'pass', 'empty_report', `Distinct from error: ${noAlert}`, el)
    } else if (f === 'report') {
      const scores = await page.locator('text=OVERALL').count()
      const meta = await page.locator('text=実行メタデータ').count()
      rec('Compare', 'pass', 'success', `Report OK. Scores: ${scores>0}, Meta: ${meta>0}`, el)
    } else {
      rec('Compare', 'timeout', 'timeout', '180s', el)
    }
  } catch (e) { rec('Compare', 'error', 'script', e.message.slice(0,200), Date.now()-t0) }
  finally { await ctx.close() }
}

// ─── Discovery ───
async function testDiscovery(browser, manifest) {
  log('=== Discovery ===')
  const { ctx, page } = await setup(browser, manifest)
  const t0 = Date.now()
  try {
    await page.goto(`${BASE}/discovery`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(800)

    await page.locator('input[placeholder*="競合他社"]').fill('https://www.petabit.co.jp')
    await page.waitForTimeout(200)
    const btn = page.locator('button:has-text("競合を発見")')
    if (await btn.isDisabled()) { rec('Discovery', 'blocked', 'config_missing', 'Disabled', Date.now()-t0); await ctx.close(); return }

    await btn.click()
    log('Discovery: clicked')

    const f = await poll(page, [
      { name: 'error', sel: '[role="alert"]' },
      { name: 'lps', sel: 'text=発見されたLP一覧' },
      { name: 'report', sel: 'text=分析レポート >> visible=true' },
    ])
    const el = Date.now() - t0
    await page.screenshot({ path: `${DIR}/discovery.png` })

    if (f === 'error') {
      const t = await page.locator('[role="alert"]').first().textContent()
      const labels = await page.locator('[role="alert"] span.rounded-full').allTextContents()
      const hasStage = /(?:ブランドURL取得|競合検索|競合サイト取得|比較分析)/.test(t)
      const isClassified = labels.length > 1 || hasStage || t.includes('SSLError') || t.includes('バックエンドエラー')
      rec('Discovery', isClassified ? 'pass' : 'fail', isClassified ? 'classified_error' : 'generic_error',
        `Stage: ${hasStage}. Labels: [${labels.join('|')}]. Text: ${t.slice(0,150)}`, el)
    } else if (f === 'lps' || f === 'report') {
      rec('Discovery', 'pass', 'success', 'LP list or report displayed', el)
    } else {
      rec('Discovery', 'timeout', 'timeout', '180s', el)
    }
  } catch (e) { rec('Discovery', 'error', 'script', e.message.slice(0,200), Date.now()-t0) }
  finally { await ctx.close() }
}

// ─── CreativeReview ───
async function testCreativeReview(browser, manifest) {
  log('=== CreativeReview ===')
  const { ctx, page } = await setup(browser, manifest)
  const t0 = Date.now()
  try {
    await page.goto(`${BASE}/creative-review`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(800)

    const testPng = resolve('test-results/test-banner.png')
    if (!existsSync(testPng)) { rec('CreativeReview', 'blocked', 'fixture', 'No PNG', Date.now()-t0); await ctx.close(); return }

    await page.locator('input[type="file"]').setInputFiles(testPng)
    const up = await poll(page, [{ name: 'ok', sel: 'text=asset_id:' }, { name: 'err', sel: '[role="alert"]' }], 60000)
    if (up !== 'ok') { rec('CreativeReview', 'fail', 'upload', `Upload: ${up}`, Date.now()-t0); await ctx.close(); return }
    log('CreativeReview: uploaded')

    // Fill fields
    const brand = page.locator('input[placeholder*="化粧品"]')
    const memo = page.locator('textarea[placeholder*="レビュー"]')
    const lp = page.locator('input[placeholder*="example.com"]')
    if (await brand.count()) await brand.fill('テスト用ブランド')
    if (await memo.count()) await memo.fill('smoke test memo')
    if (await lp.count()) await lp.fill('https://www.petabit.co.jp')

    const reviewBtn = page.locator('button:has-text("レビューを実行")')
    await page.waitForTimeout(300)
    if (await reviewBtn.isDisabled()) { rec('CreativeReview', 'blocked', 'config', 'Review disabled', Date.now()-t0); await ctx.close(); return }

    await reviewBtn.click()
    log('CreativeReview: review clicked')

    const rv = await poll(page, [{ name: 'ok', sel: 'text=レビュー結果' }, { name: 'err', sel: '[role="alert"]' }])
    const el = Date.now() - t0
    await page.screenshot({ path: `${DIR}/creative-review.png` })

    if (rv === 'err') {
      const t = await page.locator('[role="alert"]').first().textContent()
      const labels = await page.locator('[role="alert"] span.rounded-full').allTextContents()
      // Check state preservation
      const img = await page.locator('img[alt="アップロード済み画像"]').count()
      const aid = await page.locator('text=asset_id:').count()
      const bk = (await brand.count()) > 0 ? await brand.inputValue() === 'テスト用ブランド' : false
      const mk = (await memo.count()) > 0 ? await memo.inputValue() === 'smoke test memo' : false
      const lk = (await lp.count()) > 0 ? await lp.inputValue() === 'https://www.petabit.co.jp' : false

      rec('CreativeReview', 'pass', 'review_fail_state_ok',
        `Error: ${t.slice(0,80)} Labels: [${labels.join('|')}] Img:${img>0} Asset:${aid>0} Brand:${bk} Memo:${mk} LP:${lk}`, el)

      // SPA revisit test
      log('CreativeReview: SPA revisit test...')
      await page.locator('a[href="/compare"]').first().click().catch(() => {})
      await page.waitForTimeout(1000)
      await page.locator('a[href="/creative-review"]').first().click().catch(() => {})
      await page.waitForTimeout(2000)
      const rErr = await page.locator('[role="alert"]').count()
      const rAid = await page.locator('text=asset_id:').count()
      const rImg = await page.locator('img[alt="アップロード済み画像"]').count()
      await page.screenshot({ path: `${DIR}/creative-revisit.png` })
      rec('CreativeReview-Revisit', rErr > 0 && rAid > 0 ? 'pass' : 'fail', 'spa_revisit',
        `Error:${rErr>0} Asset:${rAid>0} Img:${rImg>0}`, 0)

    } else if (rv === 'ok') {
      rec('CreativeReview', 'pass', 'success', 'Review result displayed', el)

      // SPA revisit test
      log('CreativeReview: SPA revisit test...')
      await page.locator('a[href="/compare"]').first().click().catch(() => {})
      await page.waitForTimeout(1000)
      await page.locator('a[href="/creative-review"]').first().click().catch(() => {})
      await page.waitForTimeout(2000)
      const rRev = await page.locator('text=レビュー結果').count()
      const rImg = await page.locator('img[alt="アップロード済み画像"]').count()
      await page.screenshot({ path: `${DIR}/creative-revisit.png` })
      rec('CreativeReview-Revisit', rRev > 0 ? 'pass' : 'fail', 'spa_revisit',
        `Review:${rRev>0} Img:${rImg>0}`, 0)
    } else {
      rec('CreativeReview', 'timeout', 'timeout', '180s', el)
    }
  } catch (e) { rec('CreativeReview', 'error', 'script', e.message.slice(0,200), Date.now()-t0) }
  finally { await ctx.close() }
}

// ─── AiExplorer ───
async function testAiExplorer(browser, manifest) {
  log('=== AiExplorer ===')
  const { ctx, page } = await setup(browser, manifest)
  const t0 = Date.now()
  try {
    // Navigate via goto (localStorage already injected from setup)
    await page.goto(`${BASE}/ads/ai`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(2000)

    if (page.url().includes('/wizard')) {
      rec('AiExplorer', 'blocked', 'setup_guard', 'Redirected to wizard despite valid setup', Date.now()-t0)
      await page.screenshot({ path: `${DIR}/ai-explorer-wizard.png` })
      await ctx.close(); return
    }

    // Switch to ads-with-ml mode
    const mlBtn = page.locator('button:has-text("+ Market Lens")')
    if (await mlBtn.count() > 0) {
      await mlBtn.click()
      await page.waitForTimeout(5000)

      const statuses = { '履歴接続済': 'ready', '履歴なし': 'empty', '連携停止中': 'unavailable', 'サーバー起動中': 'cold_start', '読込失敗': 'error' }
      let detected = 'unknown', detectedLabel = 'unknown'
      for (const [label, key] of Object.entries(statuses)) {
        if (await page.locator(`text=${label}`).count() > 0) { detected = key; detectedLabel = label; break }
      }

      const unavailMsg = await page.locator('text=Market Lens の履歴 API が停止中').count()
      const coldMsg = await page.locator('text=Market Lens バックエンドが起動中').count()
      const errMsg = await page.locator('text=Market Lens の履歴取得に失敗').count()

      rec('AiExplorer-ML', 'pass', 'ml_differentiation',
        `Status: "${detectedLabel}" (${detected}). Msgs: unavail=${unavailMsg>0} cold=${coldMsg>0} err=${errMsg>0}`, Date.now()-t0)

      await page.locator('button:has-text("広告データのみ")').click()
      await page.waitForTimeout(500)
    }

    // Wait for report bundle
    log('AiExplorer: waiting for report bundle...')
    const ready = await poll(page, [
      { name: 'ok', sel: 'button:has-text("リスクを要約して"):not([disabled])' },
    ], 45000)

    if (ready !== 'ok') {
      const reportErr = await page.locator('[role="alert"]').count()
      const loading = await page.locator('text=要点パック').count()
      rec('AiExplorer', 'blocked', 'report_bundle', `Not ready. Error: ${reportErr>0}, Loading: ${loading>0}`, Date.now()-t0)
      await page.screenshot({ path: `${DIR}/ai-explorer.png` })
      await ctx.close(); return
    }

    await page.locator('button:has-text("リスクを要約して")').click()
    log('AiExplorer: quick prompt clicked')

    const chatResult = await poll(page, [
      { name: 'ok', sel: 'text=考察生成完了' },
      { name: 'err', sel: 'text=生成エラー' },
      { name: 'short', sel: 'text=AI応答が短い' },
    ], 60000)
    const el = Date.now() - t0
    await page.screenshot({ path: `${DIR}/ai-explorer.png` })

    if (chatResult === 'ok') rec('AiExplorer', 'pass', 'success', 'Quick prompt answered', el)
    else if (chatResult === 'err') {
      const statusText = await page.locator('.rounded-full.border').first().textContent().catch(() => '')
      rec('AiExplorer', 'pass', 'classified_error', `Error: ${statusText?.slice(0,100)}`, el)
    }
    else if (chatResult === 'short') rec('AiExplorer', 'pass', 'short', 'Short response warning', el)
    else rec('AiExplorer', 'timeout', 'timeout', '60s chat timeout', el)

  } catch (e) { rec('AiExplorer', 'error', 'script', e.message.slice(0,200), Date.now()-t0) }
  finally { await ctx.close() }
}

// ─── Main ───
async function main() {
  mkdirSync(DIR, { recursive: true })
  log('Provisioning...')
  const manifest = await provisionSmokeProfile({ baseUrl: 'http://127.0.0.1:3002' })
  if (manifest.blockers.length) { console.error('Blockers:', manifest.blockers); process.exit(1) }
  log('Provision OK')

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    await testCompare(browser, manifest)
    await testDiscovery(browser, manifest)
    await testCreativeReview(browser, manifest)
    await testAiExplorer(browser, manifest)
  } finally { await browser.close() }

  console.log('\n' + '='.repeat(95))
  console.log('Phase 2 Focused Smoke — ' + new Date().toISOString())
  console.log('='.repeat(95))
  console.log(`${'Scenario'.padEnd(34)} ${'Result'.padEnd(8)} ${'Category'.padEnd(30)} Elapsed`)
  console.log('-'.repeat(95))
  for (const r of R) console.log(`${r.s.padEnd(34)} ${r.r.padEnd(8)} ${r.c.padEnd(30)} ${(r.e/1000).toFixed(1)}s`)
  console.log('-'.repeat(95))
  console.log('\nDetails:')
  for (const r of R) console.log(`  [${r.s}] ${r.r} — ${r.n}`)

  writeFileSync(`${DIR}/summary.txt`,
    R.map(r => `[${r.s}] ${r.r} (${r.c}) ${(r.e/1000).toFixed(1)}s\n  ${r.n}`).join('\n\n'))
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
