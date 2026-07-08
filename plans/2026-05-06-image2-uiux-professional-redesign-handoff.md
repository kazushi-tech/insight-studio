# Handoff: GPT Image2 UI/UX Full Redesign + Professional Report Quality Verification

Date: 2026-05-06 JST
Repo: `C:\Users\PEM N-266\work\insight-studio`
Recommended start branch: `origin/codex/image2-direct-reflection`
Current latest relevant commits:
- `d497a64 Save AI report history after Gemini answers`
- `8869dcf Fix live Image2 flow verification issues`

## Paste This Into The Next Session

次セッションでは、`C:\Users\PEM N-266\work\insight-studio` で作業してください。

最初に `AGENTS.md` を読み、日本語・一人称「わらわ」・アンドロイド少女口調を守ってください。秘密値は絶対に表示しないでください。

目的は、Insight Studio の `Compare / Discovery / Creative Review / Ads Graphs / Ads AI` を、GPT Image2.0 で生成した理想UIの方向に本当に作り直し、実ブラウザで全操作を最後まで通し、右カラムで証跡を確認できる状態にし、問題なければコミット・push・PR・CI・マージ・Vercel/Render本番確認まで一貫して完了することです。

重要: 現在の状態は「Gemini APIキーを使った実操作証跡はある」が、「GPT Image2.0画像通りの完成UI」「全画面でAIチャット右カラムが揃っている」「広告運用プロ品質のレポート精度」とはまだ断言できません。成功扱いにせず、必ず再設計・再検証してください。

タスク量が多い場合は、Codexのsub-agent/Agent teamsが使えるなら分担してください。推奨分担は、UI実装、レポート品質/プロンプト改善、Playwright/CDP検証、デプロイ確認です。該当するskillがある場合は `browser-use` / `playwright` / `ui-design-review` / `ads-test` / `ads-deploy` / `codex-review` を使ってください。

## Current Truth

### Verified

Gemini APIキーを使った実ブラウザ検証は実施済みです。秘密値は伏せ字で確認されています。

Evidence gallery:
- Browser page: `output/playwright/gemini-verification-gallery.html`
- It contains 5 screenshots and was opened in the in-app browser.

Screenshots:
- `output/playwright/gemini-discovery-report-result.png`
- `output/playwright/gemini-compare-report-result.png`
- `output/playwright/gemini-ads-ai-answer-result.png`
- `output/playwright/gemini-report-history-drawer.png`
- `output/playwright/gemini-creative-review-result.png`

Summary JSON:
- `output/playwright/gemini-report-history-summary.json`
- `output/playwright/gemini-creative-review-summary.json`

Observed provider proof from the prior session:
- Discovery: `/api/ml/discovery/jobs`, provider `google`, model `gemini-3-flash-preview`, API key redacted as `[redacted:AIza]`
- Compare: `/api/ml/scan/jobs`, provider `google`, model `gemini-3-flash-preview`, API key redacted as `[redacted:AIza]`
- Ads AI: `/api/ads/neon/generate`, provider `google`, model `gemini-3-flash-preview`, mode `question`, report context present
- Creative Review: `/api/ml/reviews/banner`, provider `google`, API key redacted

Verification commands already passed in the prior session:
- `npm run build`
- `npm run lint`
- `npm test -- src/components/report-history/__tests__/ReportHistoryDrawer.test.jsx src/components/ai-explorer/v2/__tests__/InsightTimeline.test.jsx`
- Earlier targeted tests: `Discovery.polling`, `UiUxReview`, `InsightTimeline`

### Not Yet Good Enough

Do not call the current UI "Image2 complete". It is not proven.

Open concerns:
- Graphical charts and report graphics may not match the GPT Image2.0 visual direction strongly enough.
- `Compare / Discovery / Creative Review / Ads Graphs / Ads AI` do not yet have one clearly consistent right-column AI assistant pattern.
- Some current guide panels are visual improvements, but not necessarily a full product-grade redesign.
- The Ads AI answer shown in the evidence still says detailed BigQuery data is not acquired and gives a framework rather than a data-backed answer. This is not high-confidence advertising-operator quality.
- Compare evidence used `petabit.co.jp` alongside credit-card sites in one run, which is not a coherent professional competitor set.
- Discovery evidence classifies only a small candidate set and may still need stricter market-fit validation.
- Creative Review works, but the output should be checked against professional creative-review criteria, not just "schema passed".

## Required Outcome

The next session must deliver all of the following:

1. GPT Image2.0 UI/UX generation or regeneration for the actual product states.
2. React implementation reflecting those generated images, not just small label changes.
3. A consistent right-column AI assistant/chat rail across all relevant screens.
4. Graphical chart/report surfaces that are visible, legible, and similar to the generated image direction.
5. Professional-grade report output for advertising operations.
6. Full browser verification with real inputs, real Gemini requests, screenshots, JSON evidence, and a browser-openable gallery.
7. Commit and push.
8. If clean, PR/CI/merge and production verification on Vercel and Render.

## Start Commands

Run from the repo root:

```powershell
git fetch origin
git switch -c codex/image2-uiux-professional-redesign origin/codex/image2-direct-reflection
git status --short
git log --oneline -5
```

Do not reset or delete unrelated untracked files. The worktree may contain many existing untracked artifacts.

## Must Inspect First

Read these files before changing code:

```text
AGENTS.md
src/pages/Compare.jsx
src/pages/Discovery.jsx
src/pages/CreativeReview.jsx
src/pages/AnalysisGraphs.jsx
src/pages/AiExplorer.jsx
src/components/ai-explorer/v2/InsightTimeline.jsx
src/components/report-history/
src/components/Layout.jsx
src/pages/debug/UiUxReview.jsx
vite.config.js
vercel.json
render.yaml
```

Also inspect existing GPT Image2/Image2 direction assets:

```powershell
rg --files public src output plans | rg "ux-mockups|Image2|image2|ui-ux-review|mockup|gallery"
```

Use `/debug/ui-ux-review` to view the image board. If the current assets are too weak or do not cover the states below, generate new GPT Image2.0 images during the session.

## GPT Image2.0 Generation Scope

Generate or regenerate UI direction images for these concrete states:

- `/compare`: before input, running, result report with right AI rail.
- `/discovery`: URL input, discovered candidates, classified result, report and compare handoff.
- `/creative-review`: uploaded creative, right AI guide, score/radar, evidence, improvement actions.
- `/ads/graphs`: 1 graph per wide card, period selector, right AI rail at wide viewport, horizontal AI panel under 1536px.
- `/ads/ai`: full report chat, report history drawer, context chips, answer sections.

Do not make marketing landing-page hero art. These should be app screens or high-fidelity UI references for a SaaS dashboard.

Image prompt requirements:
- Japanese advertising analytics SaaS.
- Botanical green `#003925`, warm off-white `#fafaf5`, restrained gold accent.
- Desktop dashboard, dense but calm operational UI.
- No decorative gradient blobs or vague hero illustrations.
- Real product states: charts, report cards, action boards, right AI assistant rail, evidence chips, tabs, controls.
- Avoid unreadable fake text as much as possible; focus on layout, hierarchy, chart forms, spacing.

## UI Implementation Requirements

### Shared Layout

Implement a shared, reliable right AI rail pattern rather than one-off fixed panels.

Expected behavior:
- At `1920x1080` and `1366x768`, the right AI rail must remain inside the viewport.
- Prefer a reserved grid column plus `position: sticky`.
- Avoid `position: fixed` for the rail unless the containing layout reserves space.
- No horizontal scroll at body level.
- No text overflow in buttons, cards, rail chips, or chart labels.
- All rail labels must be Japanese.

Suggested abstraction:
- `src/components/ai-assistant/AiContextRail.jsx`
- `src/components/ai-assistant/AiContextRail.module.css` or matching existing styling pattern.

Every relevant page should pass a clear context:
- screen name
- current user input
- report status
- suggested questions
- primary action
- CTA to `/ads/ai` with question/context handoff when appropriate

### Compare

Must verify:
- URL input for self and competitors.
- Analyze start.
- Loading/running state.
- Result report.
- Image2 guide or visually equivalent action board.
- Right AI rail with questions.
- Report content quality.

Professional report criteria:
- Competitor set must be coherent for the chosen brand.
- Do not compare unrelated industries unless explicitly labeled as reference/out-of-scope.
- Must show acquisition implication: CTA, offer, trust proof, funnel stage, likely channel, KPI impact.
- Must distinguish observed facts, AI inference, and missing evidence.

### Discovery

Must verify:
- URL input.
- Discovery start.
- Candidate classification.
- Result report.
- Compare handoff.
- Right AI rail visible.

Professional report criteria:
- Classify candidates into `direct / adjacent / reference / out-of-scope`.
- Out-of-scope candidates must not drive the main recommendations.
- The report must state the target market in one sentence before recommendations.
- Include reason traces for why each candidate was accepted or excluded.

### Creative Review

Must verify:
- Image or demo creative input.
- Review execution.
- Result report.
- Right AI rail visible.
- Evidence and improvement actions visible.

Professional report criteria:
- Score must map to actual creative dimensions: visual impact, message clarity, CTA prominence, brand fit, compliance risk.
- Must include concrete revision actions and A/B test ideas.
- Must identify missing evidence as missing, not fabricate.

### Ads Graphs

Must verify:
- Graphs remain one wide card per row.
- Period selector changes selected state and graph point count or displayed data.
- At `1536px+`, right AI rail is visible.
- Under `1536px`, AI panel becomes top/bottom horizontal panel.
- No old English labels such as `Python Generated Charts` unless intentionally kept and paired with Japanese. Prefer Japanese-only labels for final.

Graph quality:
- Charts must be recognizably graphical and useful, not placeholder boxes.
- Axis labels, legends, metric labels, and selected period must be readable.
- Cards must show enough width to inspect trends.

### Ads AI

Must verify:
- Question input works.
- Gemini generation uses report context.
- Answer is visible.
- Report history is saved after answer.
- History drawer shows item count, preview, restore.

Professional answer criteria:
- If real BigQuery summary is missing, the UI must say so clearly and avoid overconfident recommendations.
- If data exists, answer must cite trend, period, metric movement, and action priority.
- It must not claim precise CVR/CPA movements unless the context contains them.

## Backend / Prompt / Contract Work

UI-only changes are not enough if reports are weak.

Inspect:

```text
backends/market-lens-ai/web/app/
backends/ads-insights/web/app/
src/api/
src/lib/
```

Fix if needed:
- Provider labels and payload provider must match.
- Gemini prompts must require structured evidence, confidence, missing-data flags, and market-fit classification.
- Validation failures should show recoverable UI states and preferably one structured repair attempt.
- Report renderer should make missing evidence visible, not hide it.

## Browser Verification Plan

Use both Playwright and in-app browser.

Local services expected:
- Frontend Vite: `http://127.0.0.1:3008` or another free port.
- Market Lens backend: `http://127.0.0.1:8002`
- Ads backend: `http://127.0.0.1:8001`

Health checks:

```powershell
curl.exe http://127.0.0.1:3008/api/ml/health
curl.exe http://127.0.0.1:3008/api/ads/health
```

Use `.env` only by loading into process/localStorage. Never print secret values.

Required real browser scenarios:

1. `/compare`
   - Use a coherent competitor set.
   - Fill all inputs, run analysis, wait for report.
   - Confirm right rail, report graphics, action board, no console errors.

2. `/discovery`
   - Fill URL, run discovery, wait for candidates and report.
   - Confirm classification, compare handoff, right rail, no console errors.

3. `/creative-review`
   - Use demo creative or upload a safe local demo asset.
   - Run review.
   - Confirm score/radar/evidence/improvement/actions/right rail.

4. `/ads/graphs`
   - Change period.
   - Confirm visual selection change and graph data/point change.
   - Confirm right rail at `1920x1080`, responsive horizontal panel under `1536px`.

5. `/ads/ai`
   - Ask a question with context.
   - Confirm Gemini response, report history save, preview and restore.

6. `/debug/ui-ux-review`
   - Confirm GPT Image2 board/new generated references remain visible.

CDP/DOM metrics required:
- `window.innerWidth`, `document.documentElement.scrollWidth`, `document.documentElement.clientWidth`
- right rail `getBoundingClientRect()` for each route
- console errors count
- network API payload provider/model with API key redacted

Create outputs:

```text
output/playwright/image2-uiux-professional-summary.json
output/playwright/image2-uiux-professional-gallery.html
output/playwright/image2-compare-result.png
output/playwright/image2-discovery-result.png
output/playwright/image2-creative-review-result.png
output/playwright/image2-ads-graphs-result.png
output/playwright/image2-ads-ai-result.png
output/playwright/image2-report-history-result.png
output/playwright/image2-uiux-review-board.png
```

Then open the gallery in the in-app browser:

```text
file:///C:/Users/PEM%20N-266/work/insight-studio/output/playwright/image2-uiux-professional-gallery.html
```

The user must be able to see the evidence in the right column/browser. Do not rely only on Markdown image links.

## Static Checks

Run:

```powershell
npm run build
npm run lint
npm test -- src/pages/__tests__/Discovery.polling.test.jsx src/pages/debug/__tests__/UiUxReview.test.jsx src/components/ai-explorer/v2/__tests__/InsightTimeline.test.jsx
npm test -- src/components/report-history/__tests__/ReportHistoryDrawer.test.jsx
```

If sandbox blocks Vite/Tailwind native dependencies, rerun with the approved escalated PowerShell pattern. Do not mark tests as passed unless they actually pass.

## Review Gate

Before commit, run a strict review using `codex-review` if available, or manually check:

- Critical: any broken route, API failure, missing report, missing right rail, visible layout overflow.
- Major: misleading provider copy, professional report claims without evidence, incoherent competitor set, unreadable charts.
- Minor: small spacing/copy issues that do not block the workflow.

Critical and Major must be zero before commit/deploy.

## Commit / Push / Deploy

Only after local browser verification passes:

```powershell
git status --short
git add -- <changed source files and any intended docs>
git commit -m "Redesign Image2 UI flows and verify Gemini reports"
git push origin codex/image2-uiux-professional-redesign
```

Do not commit `.env` or secret-bearing files.
Do not commit huge temporary raw logs unless intentionally summarized.
Screenshots/galleries may remain untracked unless the user asks to preserve them in git; if used as formal evidence, prefer a concise markdown evidence file with paths and redacted provider proof.

If deploy is requested/appropriate and checks are clean:
- Create PR.
- Wait for CI.
- Merge when green.
- Verify Vercel production: `https://insight-studio-chi.vercel.app`
- Verify Render static frontend: `https://insight-studio-frontend.onrender.com`
- Open production pages in browser and capture evidence.

Production is not successful until both Vercel and Render are browser-verified after merge/deploy.

## Final Report Required In The Next Session

The final response must include:

- What was generated with GPT Image2.0.
- What source files changed.
- Which routes were browser-verified.
- Provider proof summary with API keys redacted.
- Screenshot/gallery path opened in browser.
- Build/test results.
- Commit hash and push branch.
- PR/deploy URLs if performed.
- Any remaining risk, explicitly labeled.

Do not say "画像通り" unless the next session actually compares the generated reference images against the live UI and records evidence.
