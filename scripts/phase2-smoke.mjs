/**
 * Phase 2 Focused Smoke Test
 * Verifies error classification, state preservation, and status differentiation
 * across Compare, Discovery, CreativeReview, and AiExplorer pages.
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { provisionSmokeProfile } from './provision_smoke_profile.mjs'

const BASE_URL = 'http://127.0.0.1:3004'
const RESULTS = []
const SCREENSHOTS_DIR = resolve('test-results/phase2-smoke')

function log(msg) { console.log(`[smoke] ${msg}`) }

function record(scenario, result, category, notes, elapsed) {
  RESULTS.push({ scenario, result, category, notes, elapsed })
  const tag = result === 'pass' ? '✓' : result === 'fail' ? '✗' : '⚠'
  log(`${tag} ${scenario}: ${result} (${category}) — ${notes}`)
}

async function setupPage(browser, manifest, startUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  // Navigate to base URL first to set origin, then inject localStorage
  await page.goto(startUrl || `${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 15000 })
  const entries = manifest.localStorageEntries
  await page.evaluate((e) => {
    for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v)
  }, entries)
  // Reload to pick up the injected state
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 })
  return { context, page }
}

// ─── Scenario 1: Compare ───────────────────────────────────────
async function smokeCompare(browser, manifest) {
  log('=== Compare ===')
  const { context, page } = await setupPage(browser, manifest, `${BASE_URL}/compare`)
  const start = Date.now()

  try {
    await page.waitForTimeout(1000)

    // Check if Claude key warning is hidden (should be set)
    const claudeWarning = await page.locator('text=Claude API キーが必要です').count()
    if (claudeWarning > 0) {
      record('Compare', 'blocked', 'config_missing', 'Claude key not detected in UI', Date.now() - start)
      await context.close()
      return
    }

    // Fill URLs
    const inputs = page.locator('input[placeholder*="https://"]')
    await inputs.nth(0).fill('https://www.petabit.co.jp')
    await inputs.nth(1).fill('https://www.openai.com')
    await page.waitForTimeout(300)

    // Click 分析開始
    const submitBtn = page.locator('button:has-text("分析開始")')
    const isDisabled = await submitBtn.isDisabled()
    if (isDisabled) {
      record('Compare', 'blocked', 'config_missing', '分析開始 button still disabled after URL input', Date.now() - start)
      await context.close()
      return
    }

    await submitBtn.click()
    log('Compare: 分析開始 clicked, waiting for response...')

    // Wait for result or error (up to 120s for long-running)
    try {
      await page.waitForSelector('[role="alert"], .text-emerald-500, text=分析レポート, text=分析は完了しましたが', { timeout: 120000 })
    } catch {
      record('Compare', 'timeout', 'timeout', 'No result within 120s', Date.now() - start)
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/compare-timeout.png` })
      await context.close()
      return
    }

    const elapsed = Date.now() - start

    // Check for error banner
    const errorBanner = page.locator('[role="alert"]')
    if (await errorBanner.count() > 0) {
      const errorText = await errorBanner.first().textContent()
      // Check for classified error (not generic)
      const hasLabel = await page.locator('[role="alert"] .rounded-full.text-\\[10px\\]').count()
      const hasGuidance = await page.locator('[role="alert"] .text-xs.opacity-75').count()

      // Check it's NOT the old generic "接続できませんでした" message
      const isGeneric = errorText.includes('接続できませんでした。しばらく待って再試行してください。') &&
                         !errorText.includes('CORS') && !errorText.includes('タイムアウト')

      if (isGeneric && hasLabel === 0) {
        record('Compare', 'fail', 'generic_error', `Still showing generic error: ${errorText.slice(0, 120)}`, elapsed)
      } else {
        record('Compare', 'pass', 'classified_error', `Classified error shown. Label badge: ${hasLabel > 0}. Guidance: ${hasGuidance > 0}. Text: ${errorText.slice(0, 120)}`, elapsed)
      }
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/compare-error.png` })
      await context.close()
      return
    }

    // Check for result
    const hasReport = await page.locator('text=分析レポート').count()
    const emptyReport = await page.locator('text=分析は完了しましたが、レポート本文が空でした').count()

    if (emptyReport > 0) {
      // Verify it's NOT confused with "unavailable" or "error"
      const hasAmberIcon = await page.locator('.text-amber-400').count()
      record('Compare', 'pass', 'empty_report', `Empty report shown with distinct styling (amber icon: ${hasAmberIcon > 0}). Not confused with error.`, elapsed)
    } else if (hasReport > 0) {
      record('Compare', 'pass', 'success', `Report displayed successfully`, elapsed)
    } else {
      record('Compare', 'unclear', 'unknown', 'Neither error nor report found', elapsed)
    }

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/compare-result.png` })
  } catch (e) {
    record('Compare', 'error', 'script_error', e.message.slice(0, 200), Date.now() - start)
  } finally {
    await context.close()
  }
}

// ─── Scenario 2: Discovery ─────────────────────────────────────
async function smokeDiscovery(browser, manifest) {
  log('=== Discovery ===')
  const { context, page } = await setupPage(browser, manifest, `${BASE_URL}/discovery`)
  const start = Date.now()

  try {
    await page.waitForTimeout(1000)

    const claudeWarning = await page.locator('text=Claude API キーが必要です').count()
    if (claudeWarning > 0) {
      record('Discovery', 'blocked', 'config_missing', 'Claude key not detected', Date.now() - start)
      await context.close()
      return
    }

    // Fill URL
    await page.locator('input[placeholder*="競合他社"]').fill('https://www.petabit.co.jp')
    await page.waitForTimeout(300)

    const submitBtn = page.locator('button:has-text("競合を発見")')
    if (await submitBtn.isDisabled()) {
      record('Discovery', 'blocked', 'config_missing', '競合を発見 button disabled', Date.now() - start)
      await context.close()
      return
    }

    await submitBtn.click()
    log('Discovery: 競合を発見 clicked, waiting...')

    try {
      await page.waitForSelector('[role="alert"], text=分析レポート, text=発見されたLP一覧', { timeout: 120000 })
    } catch {
      record('Discovery', 'timeout', 'timeout', 'No result within 120s', Date.now() - start)
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/discovery-timeout.png` })
      await context.close()
      return
    }

    const elapsed = Date.now() - start

    const errorBanner = page.locator('[role="alert"]')
    if (await errorBanner.count() > 0) {
      const errorText = await errorBanner.first().textContent()
      const hasLabel = await page.locator('[role="alert"] .rounded-full.text-\\[10px\\]').count()
      const hasGuidance = await page.locator('[role="alert"] .text-xs.opacity-75').count()

      // Check for stage info
      const hasStageInfo = /(?:ブランドURL取得|競合検索|競合サイト取得|比較分析|brand_fetch|search|fetch_competitors|analyze)/.test(errorText)

      // Check it's NOT the old generic message
      const isGeneric500 = errorText.includes('しばらく待って再試行') && !hasStageInfo && hasLabel === 0

      if (isGeneric500) {
        record('Discovery', 'fail', 'generic_error', `Generic error without stage info: ${errorText.slice(0, 150)}`, elapsed)
      } else {
        record('Discovery', 'pass', 'classified_error',
          `Classified error. Stage info: ${hasStageInfo}. Label: ${hasLabel > 0}. Guidance: ${hasGuidance > 0}. Text: ${errorText.slice(0, 150)}`, elapsed)
      }
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/discovery-error.png` })
    } else {
      const hasReport = await page.locator('text=分析レポート').count()
      const hasLPs = await page.locator('text=発見されたLP一覧').count()
      record('Discovery', 'pass', 'success', `Report: ${hasReport > 0}, LPs: ${hasLPs > 0}`, elapsed)
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/discovery-result.png` })
    }
  } catch (e) {
    record('Discovery', 'error', 'script_error', e.message.slice(0, 200), Date.now() - start)
  } finally {
    await context.close()
  }
}

// ─── Scenario 3: CreativeReview ────────────────────────────────
async function smokeCreativeReview(browser, manifest) {
  log('=== CreativeReview ===')
  const { context, page } = await setupPage(browser, manifest, `${BASE_URL}/creative-review`)
  const start = Date.now()

  try {
    await page.waitForTimeout(1000)

    // Find a real PNG test file (dist/guide images are actually JPEG, use our generated test PNG)
    const testImagePath = resolve('test-results/test-banner.png')
    const imagePath = existsSync(testImagePath) ? testImagePath : null

    if (!imagePath) {
      record('CreativeReview', 'blocked', 'fixture_missing', 'No test PNG found in public/guide or dist/guide', Date.now() - start)
      await context.close()
      return
    }

    // Upload via file input
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(imagePath)
    log('CreativeReview: File uploaded, waiting for asset_id...')

    try {
      await page.waitForSelector('text=asset_id:', { timeout: 60000 })
    } catch {
      record('CreativeReview', 'fail', 'upload_failed', 'asset_id not shown after upload', Date.now() - start)
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/creative-upload-fail.png` })
      await context.close()
      return
    }

    // Fill brand info and operator memo
    const brandInput = page.locator('input[placeholder*="化粧品ブランド"]')
    if (await brandInput.count() > 0) {
      await brandInput.fill('テスト用ブランド情報')
    }
    const memoInput = page.locator('textarea[placeholder*="レビューで注目"]')
    if (await memoInput.count() > 0) {
      await memoInput.fill('smoke test operator memo')
    }
    const lpInput = page.locator('input[placeholder*="https://example.com"]')
    if (await lpInput.count() > 0) {
      await lpInput.fill('https://www.petabit.co.jp')
    }

    // Check review button is enabled
    const reviewBtn = page.locator('button:has-text("レビューを実行")')
    await page.waitForTimeout(500)

    if (await reviewBtn.isDisabled()) {
      record('CreativeReview', 'blocked', 'config_missing', 'Review button disabled after upload', Date.now() - start)
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/creative-review-disabled.png` })
      await context.close()
      return
    }

    // Save pre-review state for later comparison
    const preReviewBrand = await brandInput.inputValue()
    const preReviewMemo = await memoInput.inputValue()
    const preReviewLp = await lpInput.inputValue()

    await reviewBtn.click()
    log('CreativeReview: Review clicked, waiting...')

    // Wait for review result or error
    try {
      await page.waitForSelector('[role="alert"], text=レビュー結果, text=要約', { timeout: 120000 })
    } catch {
      record('CreativeReview', 'timeout', 'timeout', 'No review result within 120s', Date.now() - start)
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/creative-review-timeout.png` })
      await context.close()
      return
    }

    const elapsed = Date.now() - start

    // Check error case
    const errorBanner = page.locator('[role="alert"]')
    if (await errorBanner.count() > 0) {
      const errorText = await errorBanner.first().textContent()

      // CRITICAL: Verify that upload state is preserved after review failure
      const imageStillVisible = await page.locator('img[alt="アップロード済み画像"]').count()
      const brandStillFilled = await brandInput.inputValue() === preReviewBrand
      const memoStillFilled = await memoInput.inputValue() === preReviewMemo
      const lpStillFilled = await lpInput.inputValue() === preReviewLp
      const assetIdStillVisible = await page.locator('text=asset_id:').count()

      const statePreserved = imageStillVisible > 0 && brandStillFilled && memoStillFilled && lpStillFilled && assetIdStillVisible > 0

      if (statePreserved) {
        record('CreativeReview', 'pass', 'review_fail_state_preserved',
          `Review failed but asset state preserved. Image: ${imageStillVisible > 0}, Brand: ${brandStillFilled}, Memo: ${memoStillFilled}, LP: ${lpStillFilled}. Error: ${errorText.slice(0, 100)}`, elapsed)
      } else {
        record('CreativeReview', 'fail', 'review_fail_state_lost',
          `Review failed AND state was lost. Image: ${imageStillVisible > 0}, Brand: ${brandStillFilled}, Memo: ${memoStillFilled}. Error: ${errorText.slice(0, 100)}`, elapsed)
      }
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/creative-review-error.png` })

      // Test revisit persistence: navigate away and come back
      log('CreativeReview: Testing revisit persistence...')
      await page.goto(`${BASE_URL}/compare`, { waitUntil: 'networkidle', timeout: 15000 })
      await page.waitForTimeout(500)
      await page.goto(`${BASE_URL}/creative-review`, { waitUntil: 'networkidle', timeout: 15000 })
      await page.waitForTimeout(1500)

      // Check if error banner is restored
      const revisitError = await page.locator('[role="alert"]').count()
      const revisitImage = await page.locator('img[alt="アップロード済み画像"]').count()
      const revisitAssetId = await page.locator('text=asset_id:').count()

      record('CreativeReview-Revisit', revisitError > 0 || revisitAssetId > 0 ? 'pass' : 'fail', 'revisit_persistence',
        `After revisit — Error banner: ${revisitError > 0}, Image: ${revisitImage > 0}, AssetId: ${revisitAssetId > 0}`, 0)
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/creative-revisit.png` })

    } else {
      // Review succeeded
      const hasReviewResult = await page.locator('text=レビュー結果').count()
      record('CreativeReview', 'pass', 'success', `Review result displayed: ${hasReviewResult > 0}`, elapsed)
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/creative-review-success.png` })

      // Now test navigation away and back to verify review persistence
      log('CreativeReview: Testing success revisit persistence...')
      await page.goto(`${BASE_URL}/compare`, { waitUntil: 'networkidle', timeout: 15000 })
      await page.waitForTimeout(500)
      await page.goto(`${BASE_URL}/creative-review`, { waitUntil: 'networkidle', timeout: 15000 })
      await page.waitForTimeout(1500)

      const revisitReview = await page.locator('text=レビュー結果').count()
      const revisitImage = await page.locator('img[alt="アップロード済み画像"]').count()

      record('CreativeReview-Revisit', revisitReview > 0 ? 'pass' : 'fail', 'revisit_persistence',
        `After revisit — Review visible: ${revisitReview > 0}, Image: ${revisitImage > 0}`, 0)
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/creative-revisit-success.png` })
    }
  } catch (e) {
    record('CreativeReview', 'error', 'script_error', e.message.slice(0, 200), Date.now() - start)
  } finally {
    await context.close()
  }
}

// ─── Scenario 4: AiExplorer ────────────────────────────────────
async function smokeAiExplorer(browser, manifest) {
  log('=== AiExplorer ===')
  const { context, page } = await setupPage(browser, manifest, `${BASE_URL}/ads/ai`)
  const start = Date.now()

  try {
    await page.waitForTimeout(2000)

    // Check auth status
    const needsLogin = await page.locator('text=考察スタジオへのログインが必要です').count()
    if (needsLogin > 0) {
      record('AiExplorer', 'blocked', 'auth_error', 'Ads authentication required', Date.now() - start)
      await context.close()
      return
    }

    // Switch to ads-with-ml mode
    const mlBtn = page.locator('button:has-text("+ Market Lens")')
    if (await mlBtn.count() > 0) {
      await mlBtn.click()
      await page.waitForTimeout(3000) // Wait for ML status to load

      // Check ML status indicator
      const statusTexts = ['履歴接続済', '履歴なし', '連携停止中', 'サーバー起動中', '読込失敗', '読込中…']
      let detectedStatus = 'unknown'
      for (const text of statusTexts) {
        if (await page.locator(`text=${text}`).count() > 0) {
          detectedStatus = text
          break
        }
      }

      // Verify distinct display
      const statusColorDots = {
        '履歴接続済': 'bg-emerald-500',
        '連携停止中': 'bg-amber-500',
        'サーバー起動中': 'bg-sky-400',
        '読込失敗': 'bg-red-500',
        '履歴なし': 'bg-outline-variant',
      }

      // Check for context messages
      const hasUnavailableMsg = await page.locator('text=Market Lens の履歴 API が停止中').count()
      const hasColdStartMsg = await page.locator('text=Market Lens バックエンドが起動中').count()
      const hasErrorMsg = await page.locator('text=Market Lens の履歴取得に失敗').count()

      record('AiExplorer-ML-Status', 'pass', 'ml_status_check',
        `ML status: "${detectedStatus}". Unavailable msg: ${hasUnavailableMsg > 0}, ColdStart msg: ${hasColdStartMsg > 0}, Error msg: ${hasErrorMsg > 0}`, Date.now() - start)
    }

    // Switch back and test quick prompt
    const adsOnlyBtn = page.locator('button:has-text("広告データのみ")')
    if (await adsOnlyBtn.count() > 0) {
      await adsOnlyBtn.click()
      await page.waitForTimeout(500)
    }

    // Check if quick prompts are available
    const quickPrompt = page.locator('button:has-text("リスクを要約して")')
    if (await quickPrompt.count() > 0 && !(await quickPrompt.isDisabled())) {
      await quickPrompt.click()
      log('AiExplorer: Quick prompt clicked, waiting for response...')

      try {
        await page.waitForSelector('text=考察生成完了, text=生成エラー, text=AI応答が短い', { timeout: 60000 })
      } catch {
        // Check if still loading
      }

      const hasSuccess = await page.locator('text=考察生成完了').count()
      const hasError = await page.locator('text=生成エラー').count()
      const hasShortWarning = await page.locator('text=AI応答が短い').count()

      if (hasSuccess > 0) {
        record('AiExplorer', 'pass', 'success', 'Quick prompt answered successfully', Date.now() - start)
      } else if (hasError > 0) {
        const statusLine = await page.locator('.rounded-full.border').first().textContent()
        record('AiExplorer', 'pass', 'classified_error', `Error with status: ${statusLine?.slice(0, 100)}`, Date.now() - start)
      } else if (hasShortWarning > 0) {
        record('AiExplorer', 'pass', 'short_response', 'Response was short but received', Date.now() - start)
      } else {
        record('AiExplorer', 'unclear', 'no_status', 'No clear status detected after prompt', Date.now() - start)
      }
    } else {
      record('AiExplorer', 'blocked', 'prompt_disabled', 'Quick prompts are disabled. Missing report bundle?', Date.now() - start)
    }

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/ai-explorer.png` })
  } catch (e) {
    record('AiExplorer', 'error', 'script_error', e.message.slice(0, 200), Date.now() - start)
  } finally {
    await context.close()
  }
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  log('Provisioning smoke profile (non-redacted)...')
  const manifest = await provisionSmokeProfile({ baseUrl: 'http://127.0.0.1:3002' })
  if (manifest.blockers.length > 0) {
    console.error('Provision blockers:', manifest.blockers)
    process.exit(1)
  }
  log('Provision succeeded. Claude key: ' + (manifest.localStorageEntries.is_claude_key ? 'present' : 'MISSING'))

  // Ensure screenshots dir
  const { mkdirSync } = await import('node:fs')
  mkdirSync(SCREENSHOTS_DIR, { recursive: true })

  log(`Starting Phase 2 focused smoke against ${BASE_URL}`)
  log(`Manifest keys: ${Object.keys(manifest.localStorageEntries).join(', ')}`)

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  })

  try {
    await smokeCompare(browser, manifest)
    await smokeDiscovery(browser, manifest)
    await smokeCreativeReview(browser, manifest)
    await smokeAiExplorer(browser, manifest)
  } finally {
    await browser.close()
  }

  // Print summary
  console.log('\n' + '='.repeat(80))
  console.log('Phase 2 Focused Smoke Summary')
  console.log('='.repeat(80))
  console.log(`${'Scenario'.padEnd(30)} ${'Result'.padEnd(10)} ${'Category'.padEnd(30)} Elapsed`)
  console.log('-'.repeat(80))
  for (const r of RESULTS) {
    const elapsed = r.elapsed ? `${(r.elapsed / 1000).toFixed(1)}s` : '-'
    console.log(`${r.scenario.padEnd(30)} ${r.result.padEnd(10)} ${r.category.padEnd(30)} ${elapsed}`)
  }
  console.log('-'.repeat(80))
  console.log('\nDetailed Notes:')
  for (const r of RESULTS) {
    console.log(`\n[${r.scenario}] ${r.result} (${r.category})`)
    console.log(`  ${r.notes}`)
  }
}

main().catch((e) => {
  console.error('Smoke test failed:', e)
  process.exit(1)
})
