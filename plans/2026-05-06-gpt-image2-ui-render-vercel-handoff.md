# Handoff: GPT Image2 UI Reflection + Vercel/Render Deploy

Date: 2026-05-06 JST
Repo: `C:\Users\PEM N-266\work\insight-studio`
Production URLs:
- Vercel: https://insight-studio-chi.vercel.app
- Render static frontend: https://insight-studio-frontend.onrender.com

## Must-read instructions for next chat

Before doing anything, read and follow:
- `AGENTS.md`
- `.claude/`
- `.agents/`

User-specific constraints from this run:
- Respond in Japanese using the AGENTS persona.
- Never print secret values from `.env`.
- The user is frustrated by non-visible deploys. Do not claim success unless browser/live evidence exists.
- For React UI work, verify with an actual browser, not just static inspection.
- The GPT Image2 mockup images must remain preserved. The task was to reflect their direction into the actual React UI, not replace/remove the image review board.

## What was requested

The user asked to keep the GPT Image2 images intact and reflect their approved visual direction into the real UI.

Previous problem context:
- UI changes had not appeared on Render because Render was previously deploying only the backend/rootDir service.
- PR #97 added `insight-studio-frontend` static service to `render.yaml`.
- The user also explicitly wanted both Vercel and Render deployed, not only local changes.

## Implementation summary

The real React UI was updated while preserving the existing GPT Image2 mockup image board.

Changed UI surfaces:
- `src/pages/AnalysisGraphs.jsx`
  - Added a mockup-aligned KPI/graph intro surface for Ads Graphs.
  - Added visible labels such as `Python Generated Charts`, `Python集計済み`, `AI Graph Chat`, and `グラフを見ながら質問`.
  - Keeps chart/chat behavior intact.
- `src/pages/Dashboard.jsx`
  - Added a mockup-aligned first-viewport status panel.
  - Shows `Dashboard`, `GA4 / BigQuery 連携済み`, setup/data freshness cues, and next recommended actions.
- `src/pages/Compare.jsx`
  - Added `Compare Report` guide and action preview.
  - The UI now emphasizes reading comparison output through next actions and AI questions.
- `src/pages/Discovery.jsx`
  - Added `Discovery Report` guide and action preview.
  - Added classification-oriented cards for direct/adjacent/reference/excluded competitors.
  - Follow-up fix: hide the new guide once an actual report is rendered to avoid duplicate `Discovery Report` text in tests.
- `src/pages/CreativeReview.jsx`
  - Added a visible banner review overview with demo creative preview, score, first fix, good points, and AI question rail.
- `src/components/ai-explorer/v2/InsightTimeline.jsx`
  - Added visible `AI Graph Chat / Python集計済み` and `グラフを見ながらAIに質問` language to the Ads AI review surface.

Preserved image review board:
- `src/pages/debug/UiUxReview.jsx` remains the GPT Image2 direction review surface.
- `public/ux-mockups/` assets were not removed or replaced.
- `/debug/ui-ux-review` was verified live on both Vercel and Render.

## GitHub / PR / deploy status

PR created and merged:
- PR: https://github.com/kazushi-tech/insight-studio/pull/98
- Title: `Reflect GPT Image2 mockups in app UI`
- State: merged
- PR head before merge: `080aa663e1f6243e3f6c5fcb8017d51562cdf65f`
- Merge commit on `origin/master`: `a4c8238c65e6ba431a1b9f02cc441ed52c25816e`

Relevant local commits before squash merge:
- `4d7fc96 Reflect GPT Image2 mockups in app UI`
- `080aa66 Avoid duplicate discovery report guide in tests`

Important local git caveat:
- Local `master` is currently not the same shape as `origin/master`.
- Observed status after merge:
  - `master...origin/master [ahead 10, behind 1]`
- This happened because PR #98 was squash-merged on GitHub, while local `master` still contains the branch commits.
- Next chat should avoid pushing local `master`.
- For new work, prefer creating a fresh branch from `origin/master`, for example:
  - `git fetch origin master`
  - `git switch -c codex/<new-task> origin/master`
- Do not `git reset --hard` unless the user explicitly approves, because the worktree has many existing untracked files.

## Verification completed

Local checks:
- `npm run build`: passed
- Targeted tests after the final CI fix:
  - `npm test -- src/pages/__tests__/Discovery.polling.test.jsx src/pages/debug/__tests__/UiUxReview.test.jsx src/components/ai-explorer/v2/__tests__/InsightTimeline.test.jsx`
  - Result: 3 files passed, 22 tests passed
- GitHub CI on PR #98:
  - `ci`: passed
  - Vercel preview: passed

Browser verification:
- A temporary script was used:
  - `tmp/verify-image2-ui.mjs`
  - This file is untracked and was not committed.
- It injects clean demo localStorage/setup, navigates routes, checks required text, checks GPT Image2 image loading on `/debug/ui-ux-review`, and captures screenshots.
- The script was run against:
  - Local Vite
  - Vercel production
  - Render static frontend production

Verified pages on both Vercel and Render:
- `/`
- `/compare`
- `/discovery`
- `/creative-review`
- `/ads/graphs`
- `/ads/ai`
- `/debug/ui-ux-review`

Final browser smoke results:
- Vercel production: `failedCount: 0`
- Render production: `failedCount: 0`

Screenshot output folder:
- `tmp/image2-ui-browser/`

Note:
- The last script run was against Render, so screenshot filenames in that folder may reflect the latest Render run unless regenerated.

## Live bundle verification

The following was verified on both production hosts:
- `/debug/ui-ux-review` returns HTTP 200.
- The deployed JS bundle contains all required strings:
  - `AI Graph Chat`
  - `Python Generated Charts`
  - `グラフを見ながら質問`

Observed assets:
- Vercel: `/assets/index-C9WKCupj.js`
- Render: `/assets/index-DgcTvry9.js`

Observed result:
- Vercel:
  - status: `200`
  - all three strings present: true
- Render:
  - status: `200`
  - all three strings present: true

## Render-specific notes

Render static frontend exists and is live:
- Service name: `insight-studio-frontend`
- URL: https://insight-studio-frontend.onrender.com

Render API key handling:
- Secret values were never printed.
- In this run, `.env`, `.env.local`, and current process env did not expose a Render API key name such as `RENDER_API_KEY`, `RENDER_TOKEN`, or `RENDER_API_TOKEN`.
- Because the API key was unavailable in this shell, deploy was achieved by merging PR #98 into `master` and relying on the Render static service auto-deploy.
- Render live verification passed after merge.

Earlier Render API attempt before merge:
- A deploy trigger against the static service for commit `4d7fc96...` failed because that commit was not on the service's watched `master` branch.
- After PR #98 was merged into `master`, Render production reflected the UI successfully.

## Vercel-specific notes

Vercel production deploy was run after merge:
- Command used: `vercel --prod --yes`
- Final production deployment:
  - `https://insight-studio-lr6vnikwq-kazushis-projects-49d4e473.vercel.app`
- Alias:
  - `https://insight-studio-chi.vercel.app`
- Build asset observed in final deploy:
  - `/assets/index-C9WKCupj.js`

Vercel production browser smoke passed after deploy.

## What to do next if user asks for further changes

1. Start from `origin/master`, not local `master`.
2. Read `AGENTS.md`, `.claude/`, `.agents/`.
3. Make changes on a new `codex/` branch.
4. Run `npm run build`.
5. Run relevant tests.
6. Run browser verification on local and production routes if UI changed.
7. Create PR, wait for CI, merge.
8. Verify both:
   - https://insight-studio-chi.vercel.app
   - https://insight-studio-frontend.onrender.com
9. For any `.env` use, only load variables into process env. Never print values.

## User-facing current truth

As of this handoff:
- The GPT Image2 images are still present in the review board.
- The approved visual direction has been reflected into the actual UI.
- Vercel production is updated and browser-verified.
- Render static frontend production is updated and browser-verified.
- The required bundle strings are present on both hosts.
- The only important caution is local git shape: local `master` is ahead/behind due to squash merge. Use `origin/master` for next work.
