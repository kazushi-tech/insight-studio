/**
 * Discovery Phase A v3 Smoke Test — Browser UI
 *
 * Runs 5 attempts against http://127.0.0.1:3002/discovery
 * with target URL https://www.petabit.co.jp
 *
 * Intercepts /discovery/analyze API response for accurate
 * status code and error classification.
 */

import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ORIGIN = 'http://127.0.0.1:3002';
const TARGET_URL = 'https://www.petabit.co.jp';
const ATTEMPTS = 5;
const WAIT_TIMEOUT = 200_000; // 200s — generous for 180s API timeout

/** Read Claude API key from .env (never logged) */
function loadClaudeKey() {
  const envPath = resolve(process.cwd(), '.env');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^Claude_API_KEY\s*=\s*(.+)/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('Claude_API_KEY not found in .env');
}

function jst() {
  return new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function classify(status, body) {
  if (status >= 200 && status < 300) return { stage: 'complete', cls: '-' };
  const msg = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  if (/SSL|TLS|WRONG_VERSION/i.test(msg))
    return { stage: 'search', cls: 'SSL/TLS' };
  if (/timeout|timed?\s*out/i.test(msg) || status === 504)
    return { stage: 'search', cls: 'upstream_timeout' };
  if (status === 502)
    return { stage: 'search', cls: 'upstream_502' };
  if (/503|UNAVAILABLE|overload/i.test(msg))
    return { stage: 'analyze', cls: 'Gemini_503' };
  if (/stage=search/i.test(msg))
    return { stage: 'search', cls: 'provider/load' };
  if (/stage=analyze/i.test(msg))
    return { stage: 'analyze', cls: 'provider/load' };
  return { stage: 'unknown', cls: `http_${status}` };
}

async function runAttempt(page, n) {
  const t0 = Date.now();
  const ts = jst();
  console.log(`\n--- Attempt ${n} @ ${ts} ---`);

  // Set up API response interception
  let apiStatus = null;
  let apiBody = null;
  const apiPromise = page.waitForResponse(
    resp => resp.url().includes('/discovery/analyze'),
    { timeout: WAIT_TIMEOUT }
  ).then(async resp => {
    apiStatus = resp.status();
    try { apiBody = await resp.json(); } catch { apiBody = await resp.text().catch(() => ''); }
  }).catch(e => {
    apiStatus = 0;
    apiBody = `interception_error: ${e.message}`;
  });

  // Navigate and fill form
  await page.goto(`${ORIGIN}/discovery`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(1500);

  const input = page.locator('input[placeholder="競合他社のURLを入力"]');
  await input.fill(TARGET_URL);
  await page.waitForTimeout(300);

  const btn = page.locator('button.button-primary');
  await btn.click();
  console.log('  Submitted. Waiting for API response...');

  // Wait for API response
  await apiPromise;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // Determine result
  const ok = apiStatus >= 200 && apiStatus < 300;
  const { stage, cls } = classify(apiStatus, apiBody);

  // Get UI message
  let uiMsg = '-';
  if (!ok) {
    try {
      await page.waitForSelector('[role="alert"]', { timeout: 5000 });
      uiMsg = (await page.locator('[role="alert"]').first().textContent()).trim().slice(0, 200);
    } catch { uiMsg = typeof apiBody === 'object' ? (apiBody?.detail || apiBody?.message || JSON.stringify(apiBody).slice(0, 200)) : String(apiBody).slice(0, 200); }
  } else {
    // Check for report and competitors
    try {
      await page.waitForSelector('.grid.grid-cols-3, [class*="report"]', { timeout: 10_000 });
      const cardCount = await page.locator('.grid.grid-cols-3 > *').count();
      uiMsg = `Report displayed, ${cardCount} competitor cards`;
    } catch { uiMsg = 'Success (API 2xx)'; }
  }

  // Extract fetched_sites on success
  let sites = [];
  if (ok && apiBody?.fetched_sites) {
    sites = apiBody.fetched_sites
      .filter(s => s.analysis_source !== 'failed')
      .map(s => `${s.domain} (${s.title || '-'})`)
      .slice(0, 6);
  }

  const row = { n, ts, apiStatus, stage, cls, uiMsg, elapsed: parseFloat(elapsed), ok, sites };
  console.log(`  Status: ${apiStatus} | Stage: ${stage} | Class: ${cls} | ${elapsed}s | ${ok ? 'OK' : 'FAIL'}`);
  if (sites.length) console.log(`  Sites: ${sites.join(', ')}`);
  return row;
}

async function main() {
  console.log('=== Discovery Phase A v3 Smoke ===');
  console.log(`Origin: ${ORIGIN}`);
  console.log(`Target: ${TARGET_URL}`);
  console.log(`Attempts: ${ATTEMPTS}`);
  console.log(`Started: ${jst()} JST\n`);

  const claudeKey = loadClaudeKey();
  console.log(`Claude API key: loaded (${claudeKey.length} chars, not displayed)\n`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Inject API key + dismiss guide into localStorage before any navigation
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await page.evaluate((key) => {
    localStorage.setItem('is_claude_key', key);
    localStorage.setItem('insight-studio-guide-seen', '1');
  }, claudeKey);
  console.log('API key + guide-seen injected into localStorage.\n');

  const results = [];

  try {
    for (let i = 1; i <= ATTEMPTS; i++) {
      const r = await runAttempt(page, i);
      results.push(r);
      if (i < ATTEMPTS) {
        console.log('  Waiting 5s before next attempt...');
        await page.waitForTimeout(5000);
      }
    }
  } finally {
    await browser.close();
  }

  // Summary
  const ok = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;

  console.log('\n=== SUMMARY ===\n');
  console.log('| # | Timestamp (JST) | HTTP | Stage | Class | Elapsed | Result |');
  console.log('|---|-----------------|------|-------|-------|---------|--------|');
  for (const r of results) {
    console.log(`| ${r.n} | ${r.ts} | ${r.apiStatus} | ${r.stage} | ${r.cls} | ${r.elapsed}s | ${r.ok ? 'OK' : 'FAIL'} |`);
  }
  console.log(`\nSuccess: ${ok}/${ATTEMPTS} (${((ok / ATTEMPTS) * 100).toFixed(0)}%)`);
  console.log(`Failure: ${fail}/${ATTEMPTS} (${((fail / ATTEMPTS) * 100).toFixed(0)}%)`);

  if (fail > 0) {
    console.log('\nFailure breakdown:');
    const groups = {};
    for (const r of results.filter(r => !r.ok)) {
      const k = `${r.stage} + ${r.cls}`;
      groups[k] = (groups[k] || 0) + 1;
    }
    for (const [k, c] of Object.entries(groups)) console.log(`  ${k}: ${c}`);
  }

  if (ok > 0) {
    console.log('\nSuccessful attempt sites:');
    for (const r of results.filter(r => r.ok && r.sites.length)) {
      console.log(`  Attempt ${r.n}: ${r.sites.join(', ')}`);
    }
  }

  // Output JSON for downstream processing
  console.log('\n=== JSON ===');
  console.log(JSON.stringify({ results, ok, fail, total: ATTEMPTS }, null, 2));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
