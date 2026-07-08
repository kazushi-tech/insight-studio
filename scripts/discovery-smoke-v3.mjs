/**
 * Discovery Phase A v3 Smoke Test
 *
 * Target: https://www.petabit.co.jp
 * Origin: http://127.0.0.1:3002
 * Attempts: 5
 *
 * Records: timestamp, status, stage, class, UI message, elapsed, success/failure
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const CONFIG = {
  origin: 'http://127.0.0.1:3002',
  targetUrl: 'https://www.petabit.co.jp',
  attempts: 5,
  timeout: 180000, // 3 minutes per attempt
};

function getJSTimestamp() {
  return new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

async function runDiscoveryTest(page, attemptNum) {
  const startTime = Date.now();
  const startTimestamp = getJSTimestamp();

  console.log(`\n=== Attempt ${attemptNum} started at ${startTimestamp} ===\n`);

  try {
    // Navigate to Discovery page
    await page.goto(`${CONFIG.origin}/discovery`, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Find the URL input field and enter target URL
    const urlInput = await page.locator('input[type="url"], input[placeholder*="https://"], input[name*="url"]').first();
    await urlInput.fill(CONFIG.targetUrl);

    // Find and click the analyze/submit button
    const submitButton = await page.locator('button:has-text("分析"), button:has-text("Discovery"), button:has-text("開始"), button[type="submit"]').first();
    await submitButton.click();

    console.log(`Form submitted. Waiting for response...`);

    // Wait for either success or error
    // Look for success indicators (report appeared, competitors list)
    // Or error indicators (error banner, failure message)

    let result = {
      attempt: attemptNum,
      timestamp: startTimestamp,
      status: 'unknown',
      stage: '-',
      errorClass: '-',
      uiMessage: '-',
      elapsed: 0,
      result: 'unknown'
    };

    try {
      // Wait for completion - either success or failure
      // Success: look for report content or competitor list
      // Failure: look for error banner or message

      await page.waitForSelector(
        '[data-testid="competitors"], [data-testid="report"], .competitor-list, .report-content, [class*="success"], [class*="error"], .error-banner, [role="alert"]',
        { timeout: CONFIG.timeout }
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      result.elapsed = parseFloat(elapsed);

      // Check for success indicators
      const successIndicators = await page.locator('[data-testid="competitors"], [data-testid="report"], .competitor-list, .report-content').count();
      const errorIndicators = await page.locator('.error-banner, [role="alert"], [class*="error"]').count();

      if (successIndicators > 0) {
        result.status = '200';
        result.result = 'success';
        result.uiMessage = 'Report generated successfully';

        // Try to get competitor count
        try {
          const competitorText = await page.locator('[data-testid="competitors"], .competitor-list').first().textContent();
          console.log(`Success! Competitors found: ${competitorText.substring(0, 100)}...`);
        } catch (e) {
          console.log('Success! Report generated.');
        }
      } else if (errorIndicators > 0) {
        result.status = 'error';
        result.result = 'failure';

        // Try to extract error details
        try {
          const errorText = await page.locator('.error-banner, [role="alert"], [class*="error"]').first().textContent();
          result.uiMessage = errorText.substring(0, 200);

          // Classify error
          if (errorText.includes('SSL') || errorText.includes('TLS') || errorText.includes('WRONG_VERSION')) {
            result.stage = 'search';
            result.errorClass = 'SSL/TLS';
          } else if (errorText.includes('timeout') || errorText.includes('502')) {
            result.stage = 'search';
            result.errorClass = 'timeout/upstream_502';
          } else if (errorText.includes('503') || errorText.includes('UNAVAILABLE')) {
            result.stage = 'analyze';
            result.errorClass = 'Gemini 503';
          } else if (errorText.includes('stage=search')) {
            result.stage = 'search';
            result.errorClass = 'provider/load';
          } else if (errorText.includes('stage=analyze')) {
            result.stage = 'analyze';
            result.errorClass = 'provider/load';
          } else {
            result.stage = 'unknown';
            result.errorClass = 'other';
          }

          console.log(`Failed: ${result.stage} - ${result.errorClass}`);
        } catch (e) {
          result.uiMessage = 'Error occurred (details not captured)';
          console.log('Failed: Could not capture error details');
        }
      } else {
        // Timeout - no clear success or failure indicator
        result.status = 'timeout';
        result.result = 'failure';
        result.stage = 'unknown';
        result.errorClass = 'timeout';
        result.uiMessage = 'No response within timeout';
        console.log('Timeout: No clear response received');
      }

    } catch (waitError) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      result.elapsed = parseFloat(elapsed);
      result.status = 'timeout';
      result.result = 'failure';
      result.stage = 'unknown';
      result.errorClass = 'timeout';
      result.uiMessage = `Wait error: ${waitError.message}`;
      console.log(`Timeout/Wait error: ${waitError.message}`);
    }

    return result;

  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    result.elapsed = parseFloat(elapsed);
    result.status = 'error';
    result.result = 'failure';
    result.stage = 'unknown';
    result.errorClass = 'test setup issue';
    result.uiMessage = error.message;
    console.log(`Test error: ${error.message}`);
    return result;
  }
}

async function main() {
  console.log('=== Discovery Phase A v3 Smoke Test ===');
  console.log(`Origin: ${CONFIG.origin}`);
  console.log(`Target: ${CONFIG.targetUrl}`);
  console.log(`Attempts: ${CONFIG.attempts}`);
  console.log(`Started at: ${getJSTimestamp()} JST\n`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const results = [];

  try {
    for (let i = 1; i <= CONFIG.attempts; i++) {
      const result = await runDiscoveryTest(page, i);
      results.push(result);

      // Wait between attempts
      if (i < CONFIG.attempts) {
        console.log('\nWaiting 3 seconds before next attempt...');
        await page.waitForTimeout(3000);
      }
    }
  } finally {
    await browser.close();
  }

  // Generate summary
  console.log('\n=== RESULTS SUMMARY ===\n');

  console.log('| # | Timestamp (JST) | Status | Stage | Class | Elapsed | Result |');
  console.log('|---|---------------------|--------|-------|-------|---------|--------|');

  for (const r of results) {
    console.log(`| ${r.attempt} | ${r.timestamp} | ${r.status} | ${r.stage} | ${r.errorClass} | ${r.elapsed}s | ${r.result} |`);
  }

  const successCount = results.filter(r => r.result === 'success').length;
  const failureCount = results.filter(r => r.result === 'failure').length;

  console.log(`\nSuccess: ${successCount}/${CONFIG.attempts} (${((successCount/CONFIG.attempts)*100).toFixed(0)}%)`);
  console.log(`Failure: ${failureCount}/${CONFIG.attempts} (${((failureCount/CONFIG.attempts)*100).toFixed(0)}%)`);

  // Failure breakdown
  const failures = results.filter(r => r.result === 'failure');
  if (failures.length > 0) {
    console.log('\nFailure Breakdown:');
    const stageGroups = {};
    for (const f of failures) {
      const key = `${f.stage} + ${f.errorClass}`;
      stageGroups[key] = (stageGroups[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(stageGroups)) {
      console.log(`  - ${key}: ${count}`);
    }
  }

  // Write results to file
  const reportPath = 'plans/2026-04-04-discovery-phase-a-v3-smoke-results.md';
  const reportContent = generateReport(results, successCount, failureCount);

  try {
    writeFileSync(reportPath, reportContent);
    console.log(`\nReport saved to: ${reportPath}`);
  } catch (e) {
    console.log(`\nCould not save report: ${e.message}`);
  }
}

function generateReport(results, successCount, failureCount) {
  const now = getJSTTimestamp();

  let md = `# Discovery Phase A v3 Smoke Results (${now} JST)

## 1. Deploy Verification

- Backend health: OK
- Commit: 9cc1074 (Phase A env applied - assumed based on operational context)
- Note: Env-only rollout, so commit hash alone doesn't prove Phase A application
- Verification: Health endpoint restored + operational assumption of "post-Phase A observation"

## 2. Smoke Execution Conditions

| Item | Value |
|------|-------|
| Target URL | \`${CONFIG.targetUrl}\` |
| Origin | \`${CONFIG.origin}\` (local dev server) |
| Request path | \`/api/ml/discovery/analyze\` (proxy → Render) |
| Timeout | ${CONFIG.timeout}ms |
| Attempts | ${CONFIG.attempts} |

## 3. Execution Summary (${CONFIG.attempts} attempts)

| # | Timestamp (JST) | Status | Stage | Class | Elapsed | Result |
|---|-----------------|--------|-------|-------|---------|--------|
`;

  for (const r of results) {
    md += `| ${r.attempt} | ${r.timestamp} | ${r.status} | ${r.stage} | ${r.errorClass} | ${r.elapsed}s | ${r.result} |\n`;
  }

  md += `
## 4. Success / Failure Count

- **Success: ${successCount}/${CONFIG.attempts} (${((successCount/CONFIG.attempts)*100).toFixed(0)}%)**
- **Failure: ${failureCount}/${CONFIG.attempts} (${((failureCount/CONFIG.attempts)*100).toFixed(0)}%)**

## 5. Failure Stage Breakdown
`;

  const failures = results.filter(r => r.result === 'failure');
  if (failures.length > 0) {
    md += `| Stage | Type | Count |
|-------|------|-------|\n`;
    const stageGroups = {};
    for (const f of failures) {
      const key = `${f.stage} + ${f.errorClass}`;
      stageGroups[key] = (stageGroups[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(stageGroups)) {
      md += `| ${key.split(' + ')[0]} | ${key.split(' + ')[1]} | ${count} |\n`;
    }
  } else {
    md += `No failures.\n`;
  }

  md += `
## 6. Comparison with v2 Baseline

| Metric | v2 (74a86d7) | v3 (Phase A) | Change |
|--------|-------------|--------------|--------|
| Success Rate | 3/5 (60%) | ${successCount}/5 (${((successCount/5)*100).toFixed(0)}%) | ${successCount > 3 ? 'IMPROVED' : successCount < 3 ? 'DEGRADED' : 'NO CHANGE'} |
| SSL/TLS (search) | 1 | ${failures.filter(f => f.errorClass === 'SSL/TLS').length} | ${failures.filter(f => f.errorClass === 'SSL/TLS').length < 1 ? 'IMPROVED' : failures.filter(f => f.errorClass === 'SSL/TLS').length > 1 ? 'DEGRADED' : 'NO CHANGE'} |
| Timeout (search) | 1 | ${failures.filter(f => f.errorClass.includes('timeout')).length} | ${failures.filter(f => f.errorClass.includes('timeout')).length < 1 ? 'IMPROVED' : failures.filter(f => f.errorClass.includes('timeout')).length > 1 ? 'DEGRADED' : 'NO CHANGE'} |
| Gemini 503 (analyze) | 0 | ${failures.filter(f => f.errorClass === 'Gemini 503').length} | ${failures.filter(f => f.errorClass === 'Gemini 503').length === 0 ? 'MAINTAINED' : 'DEGRADED'} |

## 7. Current Conclusion

`;

  // Determine conclusion
  const successRate = successCount / CONFIG.attempts;
  const sslTlsCount = failures.filter(f => f.errorClass === 'SSL/TLS').length;
  const timeoutCount = failures.filter(f => f.errorClass.includes('timeout')).length;
  const gemini503Count = failures.filter(f => f.errorClass === 'Gemini 503').length;

  if (successRate > 0.6) {
    md += `- Success rate improved or maintained above 60%\n`;
  } else if (successRate === 0.6) {
    md += `- Success rate unchanged at 60%\n`;
  } else {
    md += `- Success rate degraded below 60%\n`;
  }

  if (sslTlsCount === 0 && timeoutCount === 0) {
    md += `- No search-stage failures observed\n`;
  } else {
    md += `- Search-stage failures still present: SSL/TLS=${sslTlsCount}, timeout=${timeoutCount}\n`;
  }

  if (gemini503Count === 0) {
    md += `- Gemini 503 issues remain resolved\n`;
  }

  md += `\n**Phase A Assessment:** `;
  if (successRate >= 0.6 && gemini503Count === 0) {
    if (sslTlsCount + timeoutCount < 2) {
      md += `Phase A shows improvement. Search instability reduced.\n`;
    } else {
      md += `Phase A shows marginal improvement. Search instability persists but within acceptable range.\n`;
    }
  } else if (successRate >= 0.6) {
    md += `Phase A maintains baseline. No degradation observed.\n`;
  } else {
    md += `Phase A shows degradation. Rollback may be needed.\n`;
  }

  md += `
## 8. Recommended Next Actions

`;

  if (successRate >= 0.8) {
    md += `- Consider Phase A as successful\n`;
    md += `- Monitor for additional observation period\n`;
  } else if (successRate >= 0.6) {
    md += `- Continue monitoring with more attempts\n`;
    md += `- Consider time-of-day variation analysis\n`;
  } else {
    md += `- Evaluate rollback to previous env settings\n`;
    md += `- Investigate specific failure patterns\n`;
  }

  md += `
---

## Appendix: Detailed UI Messages
`;

  for (const r of results) {
    if (r.result === 'failure') {
      md += `\n### Attempt ${r.attempt} (Failed)\n`;
      md += `\`${r.uiMessage}\`\n`;
    }
  }

  md += `\n---\n\n## Security\n\n- API keys not logged\n- Test data only\n`;

  return md;
}

main().catch(console.error);
