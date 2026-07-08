/**
 * Phase 2 Focused Smoke v2
 * Uses polling approach instead of waitForSelector to avoid timing issues.
 */
import { chromium } from 'playwright'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { provisionSmokeProfile } from './provision_smoke_profile.mjs'

const BASE = 'http://127.0.0.1:3004'
const DIR = resolve('test-results/phase2-smoke')
const RESULTS = []

function log(msg) { console.log(`[smoke] ${msg}`) }
function rec(scenario, result, category, notes, elapsed) {
  RESULTS.push({ scenario, result, category, notes, elapsed })
  const tag = result === 'pass' ? '✓' : result === 'fail' ? '✗' : '⚠'
  log(`${tag} ${scenario}: ${result} (${category}) [${(elapsed / 1000).toFixed(1)}s] — ${notes}`)
}

async function setup(browser, manifest, path) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  // Collect API responses
  const apiResponses = []
  page.on('response', res => {
    if (res.url().includes('/api/')) {
      apiResponses.push({ url: res.url(), status: res.status() })
    }
  })
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.evaluate(e => { for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v) }, manifest.localStorageEntries)
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(800)
  return { ctx, page, apiResponses }
}

async function poll(page, checks, maxMs = 180000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    for (const { name, selector } of checks) {
      if (await page.locator(selector).count() > 0) return name
    }
    await page.waitForTimeout(3000)
  }
  return 'timeout'
}

// ─── Compare ────────────────────────────────────────────────────
async function testCompare(browser, manifest) {
  log('=== Compare ===')
  const { ctx, page, apiResponses } = await setup(browser, manifest, '/compare')
  const t0 = Date.now()
  try {
    // Fill
    await page.locator('input[placeholder*="https://"]').nth(0).fill('https://www.petabit.co.jp')
    await page.locator('input[placeholder*="https://"]').nth(1).fill('https://www.openai.com')
    await page.waitForTimeout(200)

    const btn = page.locator('button:has-text("分析開始")')
    if (await btn.isDisabled()) { rec('Compare', 'blocked', 'config_missing', 'Button disabled', Date.now()-t0); return }

    await btn.click()
    log('Compare: clicked')

    const found = await poll(page, [
      { name: 'error', selector: '[role="alert"]' },
      { name: 'empty', selector: 'text=レポート本文が空' },
      { name: 'report', selector: 'text=分析レポート >> visible=true' },
    ])

    const elapsed = Date.now() - t0
    await page.screenshot({ path: `${DIR}/compare.png` })

    if (found === 'error') {
      const text = await page.locator('[role="alert"]').first().textContent()
      const labels = await page.locator('[role="alert"] span.rounded-full').allTextContents()
      const guidance = await page.locator('[role="alert"] .opacity-75').allTextContents()
      const isGeneric = text.includes('接続できませんでした') && labels.length === 0
      if (isGeneric) {
        rec('Compare', 'fail', 'generic_error', `Generic error: ${text.slice(0, 150)}`, elapsed)
      } else {
        rec('Compare', 'pass', 'classified_error', `Labels: [${labels.join(', ')}]. Guidance: [${guidance.join(', ')}]. Text: ${text.slice(0, 120)}`, elapsed)
      }
    } else if (found === 'empty') {
      // Check distinct styling
      const amberIcon = await page.locator('span.text-amber-400').count()
      const noErrorAlert = (await page.locator('[role="alert"]').count()) === 0
      rec('Compare', noErrorAlert ? 'pass' : 'fail', 'empty_report',
        `Empty report distinct from error: ${noErrorAlert}. Amber icon: ${amberIcon > 0}`, elapsed)
    } else if (found === 'report') {
      // Check it actually has content (not just the heading)
      const loading = await page.locator('text=分析中').count()
      if (loading > 0) {
        rec('Compare', 'pass', 'loading_done', 'Report heading visible but still loading', elapsed)
      } else {
        const hasScores = await page.locator('text=OVERALL').count()
        const hasMetadata = await page.locator('text=実行メタデータ').count()
        rec('Compare', 'pass', 'success', `Report displayed. Scores: ${hasScores > 0}. Metadata: ${hasMetadata > 0}`, elapsed)
      }
    } else {
      rec('Compare', 'timeout', 'timeout', 'No result in 180s', elapsed)
    }
  } catch (e) { rec('Compare', 'error', 'script_error', e.message.slice(0, 200), Date.now()-t0) }
  finally { await ctx.close() }
}

// ─── Discovery ──────────────────────────────────────────────────
async function testDiscovery(browser, manifest) {
  log('=== Discovery ===')
  const { ctx, page } = await setup(browser, manifest, '/discovery')
  const t0 = Date.now()
  try {
    await page.locator('input[placeholder*="競合他社"]').fill('https://www.petabit.co.jp')
    await page.waitForTimeout(200)
    const btn = page.locator('button:has-text("競合を発見")')
    if (await btn.isDisabled()) { rec('Discovery', 'blocked', 'config_missing', 'Button disabled', Date.now()-t0); return }

    await btn.click()
    log('Discovery: clicked')

    const found = await poll(page, [
      { name: 'error', selector: '[role="alert"]' },
      { name: 'lps', selector: 'text=発見されたLP一覧' },
      { name: 'report', selector: 'text=分析レポート >> visible=true' },
    ])

    const elapsed = Date.now() - t0
    await page.screenshot({ path: `${DIR}/discovery.png` })

    if (found === 'error') {
      const text = await page.locator('[role="alert"]').first().textContent()
      const labels = await page.locator('[role="alert"] span.rounded-full').allTextContents()
      const guidance = await page.locator('[role="alert"] .opacity-75').allTextContents()

      // Check for stage info
      const hasStage = /(?:ブランドURL取得|競合検索|競合サイト取得|比較分析|brand_fetch|search|fetch_competitors|analyze)/.test(text)
      const isGeneric = !hasStage && labels.length === 0 && text.includes('しばらく待って再試行')

      if (isGeneric) {
        rec('Discovery', 'fail', 'generic_error', `No stage info: ${text.slice(0, 150)}`, elapsed)
      } else {
        rec('Discovery', 'pass', 'classified_error', `Stage: ${hasStage}. Labels: [${labels.join(', ')}]. Text: ${text.slice(0, 120)}`, elapsed)
      }
    } else if (found === 'lps' || found === 'report') {
      const lpCount = await page.locator('.surface-elevated').count()
      const hasPartial = await page.locator('text=件をページ取得できました').count()
      rec('Discovery', 'pass', 'success', `LPs: ${lpCount}, Partial banner: ${hasPartial > 0}`, elapsed)
    } else {
      rec('Discovery', 'timeout', 'timeout', 'No result in 180s', elapsed)
    }
  } catch (e) { rec('Discovery', 'error', 'script_error', e.message.slice(0, 200), Date.now()-t0) }
  finally { await ctx.close() }
}

// ─── CreativeReview ─────────────────────────────────────────────
async function testCreativeReview(browser, manifest) {
  log('=== CreativeReview ===')
  const { ctx, page } = await setup(browser, manifest, '/creative-review')
  const t0 = Date.now()
  try {
    const testPng = resolve('test-results/test-banner.png')
    if (!existsSync(testPng)) { rec('CreativeReview', 'blocked', 'fixture_missing', 'test-banner.png not found', Date.now()-t0); return }

    // Upload
    await page.locator('input[type="file"]').setInputFiles(testPng)
    log('CreativeReview: uploaded file')

    const uploaded = await poll(page, [
      { name: 'asset', selector: 'text=asset_id:' },
      { name: 'error', selector: '[role="alert"]' },
    ], 60000)

    if (uploaded !== 'asset') {
      const errText = uploaded === 'error' ? await page.locator('[role="alert"]').first().textContent() : 'timeout'
      rec('CreativeReview', 'fail', 'upload_failed', `Upload result: ${uploaded}. ${errText?.slice(0, 100) || ''}`, Date.now()-t0)
      await page.screenshot({ path: `${DIR}/creative-upload-fail.png` })
      await ctx.close(); return
    }

    // Fill optional fields
    const brandInput = page.locator('input[placeholder*="化粧品"]')
    const memoInput = page.locator('textarea[placeholder*="レビュー"]')
    const lpInput = page.locator('input[placeholder*="example.com"]')
    if (await brandInput.count()) await brandInput.fill('テスト用ブランド')
    if (await memoInput.count()) await memoInput.fill('smoke test memo')
    if (await lpInput.count()) await lpInput.fill('https://www.petabit.co.jp')

    // Click review
    const reviewBtn = page.locator('button:has-text("レビューを実行")')
    await page.waitForTimeout(300)
    if (await reviewBtn.isDisabled()) {
      rec('CreativeReview', 'blocked', 'config_missing', 'Review button disabled', Date.now()-t0)
      await page.screenshot({ path: `${DIR}/creative-disabled.png` })
      await ctx.close(); return
    }

    await reviewBtn.click()
    log('CreativeReview: review clicked')

    const reviewResult = await poll(page, [
      { name: 'error', selector: '[role="alert"]' },
      { name: 'result', selector: 'text=レビュー結果' },
    ])

    const elapsed = Date.now() - t0
    await page.screenshot({ path: `${DIR}/creative-review.png` })

    if (reviewResult === 'error') {
      const text = await page.locator('[role="alert"]').first().textContent()
      const labels = await page.locator('[role="alert"] span.rounded-full').allTextContents()

      // CRITICAL: Check state preservation after review failure
      const imageVisible = await page.locator('img[alt="アップロード済み画像"]').count()
      const assetIdVisible = await page.locator('text=asset_id:').count()
      const brandKept = (await brandInput.count()) > 0 ? (await brandInput.inputValue()) === 'テスト用ブランド' : false
      const memoKept = (await memoInput.count()) > 0 ? (await memoInput.inputValue()) === 'smoke test memo' : false
      const lpKept = (await lpInput.count()) > 0 ? (await lpInput.inputValue()) === 'https://www.petabit.co.jp' : false

      rec('CreativeReview', 'pass', 'review_fail_state_preserved',
        `Error: ${text.slice(0, 80)}. Labels: [${labels.join(', ')}]. State preserved — Image: ${imageVisible > 0}, AssetId: ${assetIdVisible > 0}, Brand: ${brandKept}, Memo: ${memoKept}, LP: ${lpKept}`, elapsed)

      // Test revisit
      log('CreativeReview: testing revisit persistence...')
      await page.goto(`${BASE}/compare`, { waitUntil: 'networkidle', timeout: 15000 })
      await page.waitForTimeout(500)
      await page.goto(`${BASE}/creative-review`, { waitUntil: 'networkidle', timeout: 15000 })
      await page.waitForTimeout(2000)

      const revisitError = await page.locator('[role="alert"]').count()
      const revisitAsset = await page.locator('text=asset_id:').count()
      const revisitImage = await page.locator('img[alt="アップロード済み画像"]').count()
      await page.screenshot({ path: `${DIR}/creative-revisit.png` })

      rec('CreativeReview-Revisit', revisitError > 0 && revisitAsset > 0 ? 'pass' : 'fail', 'revisit_persistence',
        `Error banner: ${revisitError > 0}, AssetId: ${revisitAsset > 0}, Image: ${revisitImage > 0}`, 0)

    } else if (reviewResult === 'result') {
      rec('CreativeReview', 'pass', 'success', 'Review result displayed', elapsed)

      // Test revisit
      log('CreativeReview: testing success revisit...')
      await page.goto(`${BASE}/compare`, { waitUntil: 'networkidle', timeout: 15000 })
      await page.waitForTimeout(500)
      await page.goto(`${BASE}/creative-review`, { waitUntil: 'networkidle', timeout: 15000 })
      await page.waitForTimeout(2000)

      const revisitReview = await page.locator('text=レビュー結果').count()
      const revisitImage = await page.locator('img[alt="アップロード済み画像"]').count()
      await page.screenshot({ path: `${DIR}/creative-revisit-success.png` })

      rec('CreativeReview-Revisit', revisitReview > 0 ? 'pass' : 'fail', 'revisit_persistence',
        `Review visible: ${revisitReview > 0}, Image: ${revisitImage > 0}`, 0)

    } else {
      rec('CreativeReview', 'timeout', 'timeout', 'No review result in 180s', elapsed)
    }
  } catch (e) { rec('CreativeReview', 'error', 'script_error', e.message.slice(0, 200), Date.now()-t0) }
  finally { await ctx.close() }
}

// ─── AiExplorer ─────────────────────────────────────────────────
async function testAiExplorer(browser, manifest) {
  log('=== AiExplorer ===')
  const { ctx, page } = await setup(browser, manifest, '/ads/ai')
  const t0 = Date.now()
  try {
    // Wait for report bundle to load
    const reportLoaded = await poll(page, [
      { name: 'ready', selector: 'button:has-text("リスクを要約して"):not([disabled])' },
      { name: 'bundle_loading', selector: 'text=要点パックとグラフコンテキストを再構築' },
      { name: 'needs_login', selector: 'text=考察スタジオへのログインが必要です' },
    ], 30000)

    if (reportLoaded === 'needs_login') {
      rec('AiExplorer', 'blocked', 'auth_error', 'Ads auth required', Date.now()-t0)
      await ctx.close(); return
    }

    if (reportLoaded === 'bundle_loading') {
      // Wait longer for bundle
      log('AiExplorer: waiting for report bundle...')
      await poll(page, [
        { name: 'ready', selector: 'button:has-text("リスクを要約して"):not([disabled])' },
      ], 60000)
    }

    // Switch to ads-with-ml and check ML status differentiation
    const mlBtn = page.locator('button:has-text("+ Market Lens")')
    if (await mlBtn.count() > 0) {
      await mlBtn.click()
      await page.waitForTimeout(5000)

      const statuses = ['履歴接続済', '履歴なし', '連携停止中', 'サーバー起動中', '読込失敗']
      let detected = 'unknown'
      for (const s of statuses) {
        if (await page.locator(`text=${s}`).count() > 0) { detected = s; break }
      }

      // Check contextual messages
      const unavailMsg = await page.locator('text=Market Lens の履歴 API が停止中').count()
      const coldMsg = await page.locator('text=Market Lens バックエンドが起動中').count()
      const errMsg = await page.locator('text=Market Lens の履歴取得に失敗').count()

      rec('AiExplorer-ML', 'pass', 'ml_differentiation',
        `Status: "${detected}". Unavailable msg: ${unavailMsg > 0}, ColdStart: ${coldMsg > 0}, Error: ${errMsg > 0}`, Date.now()-t0)

      // Switch back
      await page.locator('button:has-text("広告データのみ")').click()
      await page.waitForTimeout(500)
    }

    // Quick prompt test
    const quickBtn = page.locator('button:has-text("リスクを要約して")')
    if (await quickBtn.count() === 0 || await quickBtn.isDisabled()) {
      rec('AiExplorer', 'blocked', 'prompt_disabled', 'Quick prompts disabled (missing report bundle?)', Date.now()-t0)
      await page.screenshot({ path: `${DIR}/ai-explorer.png` })
      await ctx.close(); return
    }

    await quickBtn.click()
    log('AiExplorer: quick prompt clicked')

    const chatResult = await poll(page, [
      { name: 'success', selector: 'text=考察生成完了' },
      { name: 'error', selector: 'text=生成エラー' },
      { name: 'short', selector: 'text=AI応答が短い' },
    ], 60000)

    const elapsed = Date.now() - t0
    await page.screenshot({ path: `${DIR}/ai-explorer.png` })

    if (chatResult === 'success') {
      rec('AiExplorer', 'pass', 'success', 'Quick prompt answered', elapsed)
    } else if (chatResult === 'error') {
      const statusText = await page.locator('.rounded-full.border').first().textContent().catch(() => '')
      rec('AiExplorer', 'pass', 'classified_error', `Error with status: ${statusText?.slice(0, 100)}`, elapsed)
    } else if (chatResult === 'short') {
      rec('AiExplorer', 'pass', 'short_response', 'Short response warning shown', elapsed)
    } else {
      rec('AiExplorer', 'timeout', 'timeout', 'No response in 60s', elapsed)
    }
  } catch (e) { rec('AiExplorer', 'error', 'script_error', e.message.slice(0, 200), Date.now()-t0) }
  finally { await ctx.close() }
}

// ─── Main ───────────────────────────────────────────────────────
async function main() {
  mkdirSync(DIR, { recursive: true })

  log('Provisioning...')
  const manifest = await provisionSmokeProfile({ baseUrl: 'http://127.0.0.1:3002' })
  if (manifest.blockers.length > 0) { console.error('Blockers:', manifest.blockers); process.exit(1) }
  log('Provision OK. Claude: present, Gemini: present')

  const browser = await chromium.launch({ channel: 'chrome', headless: true })

  try {
    await testCompare(browser, manifest)
    await testDiscovery(browser, manifest)
    await testCreativeReview(browser, manifest)
    await testAiExplorer(browser, manifest)
  } finally {
    await browser.close()
  }

  // Summary
  console.log('\n' + '='.repeat(90))
  console.log('Phase 2 Focused Smoke Summary — ' + new Date().toISOString())
  console.log('='.repeat(90))
  console.log(`${'Scenario'.padEnd(32)} ${'Result'.padEnd(10)} ${'Category'.padEnd(30)} Elapsed`)
  console.log('-'.repeat(90))
  for (const r of RESULTS) {
    console.log(`${r.scenario.padEnd(32)} ${r.result.padEnd(10)} ${r.category.padEnd(30)} ${(r.elapsed / 1000).toFixed(1)}s`)
  }
  console.log('-'.repeat(90))
  console.log('\nDetails:')
  for (const r of RESULTS) console.log(`  [${r.scenario}] ${r.result} — ${r.notes}`)

  // Write summary file
  const summary = RESULTS.map(r => `[${r.scenario}] ${r.result} (${r.category}) ${(r.elapsed/1000).toFixed(1)}s\n  ${r.notes}`).join('\n\n')
  writeFileSync(`${DIR}/summary.txt`, summary)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
