# Insight Studio Render Frontend Deploy Handoff

## Goal

同じリポジトリ `C:\Users\PEM N-266\work\insight-studio` で、React UI変更を **Render側でも確認できる本番環境** に反映する。

重要: これまでのUI変更は `src/` 配下のReactフロントであり、既存の `render.yaml` は `backends/market-lens-ai` のPython backendだけをRenderに載せていた。そのため、Render Dashboardでデプロイ履歴を見てもUI変更は反映されない。PR #97 でRender Static Site定義を追加済みなので、次セッションではRender APIキーを使ってサービス作成/同期/デプロイ確認まで進める。

## Must Read First

次セッション開始直後に必ず読む:

1. `AGENTS.md`
   - 日本語。
   - 一人称は「わらわ」。
   - 語尾に「♡」を付けがち。
   - 古風な口調。
2. `.claude/` と `.agents/skills/`
   - Claude/VSCode側のルールやskillsがある。
   - ただし秘密情報は読まない。
3. `.env`
   - Render APIキーがある。
   - **値を表示しない。ログに出さない。コミットしない。**

## Current Git State

`origin/master` に以下がmerge済み:

- PR #94: `/debug/ui-ux-review` とReport UX board系
  - https://github.com/kazushi-tech/insight-studio/pull/94
- PR #95: 実 `/ads/graphs` にAI question railを追加
  - https://github.com/kazushi-tech/insight-studio/pull/95
- PR #96: AI question railを通常PC幅でも表示
  - https://github.com/kazushi-tech/insight-studio/pull/96
- PR #97: `render.yaml` にRender Static Frontendサービスを追加
  - https://github.com/kazushi-tech/insight-studio/pull/97
  - merge commit: `24307a9d0dbe688bd811708017aed57e90afcf9a`

確認コマンド:

```powershell
cd "C:\Users\PEM N-266\work\insight-studio"
git fetch origin master
git log origin/master -5 --oneline
```

期待:

```text
24307a9 Add Render static frontend service (#97)
7b41367 Show ads graph AI rail on desktop widths (#96)
8720d75 Refine ads graphs with AI question rail (#95)
```

## What Changed For Render

`render.yaml` に以下のサービスが追加済み:

```yaml
- type: web
  name: insight-studio-frontend
  runtime: static
  buildCommand: npm ci && npm run build
  staticPublishPath: ./dist
  routes:
    - type: rewrite
      source: /api/ml/*
      destination: https://market-lens-ai.onrender.com/api/ml/*
    - type: rewrite
      source: /api/ads/*
      destination: https://market-lens-ai.onrender.com/api/ads/*
    - type: rewrite
      source: /*
      destination: /index.html
```

Render Docs根拠:

- Static siteはRenderでGit repoからbuild/publishできる。
  - https://render.com/docs/static-sites
- Blueprint static siteは `staticPublishPath` が必要。
  - https://render.com/docs/blueprint-spec
- React Routerなどのclient-side routingは `index.html` rewriteが必要。
  - https://render.com/docs/deploy-create-react-app
- API deploy trigger:
  - https://api-docs.render.com/reference/create-deploy
- API list services:
  - https://api-docs.render.com/reference/list-services

## Verification Already Done

ローカル/CI:

```powershell
npm ci
npm run build
```

PR #97 CI:

- `ci`: pass
- Vercel preview: pass

Render側:

- `https://insight-studio-frontend.onrender.com/debug/ui-ux-review` はPR #97 merge直後の確認では `404`。
- これはRender Static Site serviceがまだ作成/同期されていない可能性が高い。

## Render API Key Loading

`.env` にRender APIキーがある前提。値は絶対に表示しない。

PowerShellで安全に読み込む例:

```powershell
cd "C:\Users\PEM N-266\work\insight-studio"

Get-Content ".env" | ForEach-Object {
  if ($_ -match '^\s*#') { return }
  if ($_ -match '^\s*$') { return }
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    $name = $matches[1]
    $value = $matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

$renderToken = $env:RENDER_API_KEY
if (-not $renderToken) { $renderToken = $env:RENDER_API_TOKEN }
if (-not $renderToken) { $renderToken = $env:RENDER_API }
if (-not $renderToken) { throw "Render API key was not found in .env. Expected RENDER_API_KEY, RENDER_API_TOKEN, or RENDER_API." }

$headers = @{
  "Accept" = "application/json"
  "Authorization" = "Bearer $renderToken"
  "Content-Type" = "application/json"
}
```

Do not run `echo $renderToken`.

## Deploy Procedure

### Step 1: List Render services

```powershell
$servicesResponse = Invoke-WebRequest `
  -Uri "https://api.render.com/v1/services?limit=100" `
  -Headers $headers `
  -UseBasicParsing

$services = ($servicesResponse.Content | ConvertFrom-Json)
$services | ConvertTo-Json -Depth 6
```

Look for:

- `market-lens-ai`
- `insight-studio-frontend`

If `insight-studio-frontend` exists, capture its service id:

```powershell
$frontendService = $services | Where-Object { $_.service.name -eq "insight-studio-frontend" -or $_.name -eq "insight-studio-frontend" } | Select-Object -First 1
$frontendService | ConvertTo-Json -Depth 6
```

Render API response shapes can differ; inspect without printing secrets.

### Step 2A: If frontend service exists, trigger deploy

Use the service id from Step 1.

```powershell
$frontendServiceId = "<replace-with-service-id>"
$commitId = "24307a9d0dbe688bd811708017aed57e90afcf9a"

$body = @{
  clearCache = "do_not_clear"
  commitId = $commitId
} | ConvertTo-Json

$deploy = Invoke-WebRequest `
  -Uri "https://api.render.com/v1/services/$frontendServiceId/deploys" `
  -Method POST `
  -Headers $headers `
  -Body $body `
  -UseBasicParsing

$deploy.Content
```

Then poll deploys:

```powershell
Invoke-WebRequest `
  -Uri "https://api.render.com/v1/services/$frontendServiceId/deploys?limit=3" `
  -Headers $headers `
  -UseBasicParsing |
  Select-Object -ExpandProperty Content
```

### Step 2B: If frontend service does not exist

This means PR #97 is merged, but Render Blueprint has not created the new static site.

Options:

1. Preferred: Render Dashboard
   - Open Blueprint / Infrastructure as Code for this repo.
   - Sync / Apply latest `master`.
   - Confirm it creates `insight-studio-frontend`.
   - Then trigger deploy if needed.

2. If API supports Blueprint sync in the current account:
   - Use Render API docs / OpenAPI to locate Blueprint endpoints.
   - Apply the blueprint from `render.yaml`.
   - Then return to Step 1 and deploy the created frontend service.

Do not create a second duplicate frontend service if Render already created one under a slightly different name. List services first.

### Step 3: Verify Render URL

Expected static URL:

```text
https://insight-studio-frontend.onrender.com/debug/ui-ux-review
```

Check:

```powershell
$r = Invoke-WebRequest `
  -UseBasicParsing `
  -Uri "https://insight-studio-frontend.onrender.com/debug/ui-ux-review" `
  -TimeoutSec 60

$r.StatusCode
```

Expected:

```text
200
```

Then verify JS bundle includes the UI changes:

```powershell
$html = Invoke-WebRequest -UseBasicParsing -Uri "https://insight-studio-frontend.onrender.com/debug/ui-ux-review"
$asset = ($html.Content | Select-String -Pattern 'assets/index-[^"'']+\.js' -AllMatches).Matches.Value | Select-Object -First 1
$js = Invoke-WebRequest -UseBasicParsing -Uri "https://insight-studio-frontend.onrender.com/$asset"

@(
  "AI Graph Chat",
  "Python Generated Charts",
  "グラフを見ながら質問",
  "Insight Studio UI/UX 再設計レビュー"
) | ForEach-Object {
  if ($js.Content.Contains($_)) { "FOUND: $_" } else { "MISSING: $_" }
}
```

All should be `FOUND`.

### Step 4: Browser smoke

Open:

```text
https://insight-studio-frontend.onrender.com/debug/ui-ux-review
```

Check:

- `Ads AI Report` tab exists.
- Scroll inside Ads AI Report implementation preview.
- It shows `Python Generated Charts`.
- It shows `AI Graph Chat`.
- The right rail is visible at normal desktop width.

Then open:

```text
https://insight-studio-frontend.onrender.com/ads/graphs
```

Expected:

- If authenticated and graph data exists: real `/ads/graphs` shows graph-first layout with right AI rail.
- If setup/auth is missing: app redirects or shows setup state. That is not a deployment failure.

## Important Clarification For User

The user is checking Render Dashboard. That is valid.

Before PR #97, Render only deployed backend:

```yaml
name: market-lens-ai
runtime: python
rootDir: backends/market-lens-ai
```

So UI changes under `src/` could never appear in Render deploy history.

After PR #97, Render can deploy the frontend only after the Blueprint is synced/created. If the Dashboard still shows no deploy for `insight-studio-frontend`, the remaining task is Render Blueprint sync or service creation, not another React code change.

## Safety Rules

- Do not print `.env` contents.
- Do not commit `.env`.
- Do not change backend env vars unless explicitly needed.
- Do not revert unrelated dirty files in the main worktree.
- Use a clean worktree if making additional repo changes:

```powershell
git worktree add C:\tmp\insight-studio-render-followup -b codex/render-followup origin/master
```

## Copy-Paste Prompt For Next Session

```text
同じrepo C:\Users\PEM N-266\work\insight-studio で続きです。

必ず AGENTS.md / .claude / .agents を読んで、口調・ルールを合わせてください。
.env に Render API key がありますが、絶対に値を表示しないでください。

目的:
React UI変更をRenderでも確認できるようにする。
PR #97 で render.yaml に insight-studio-frontend static service が追加済みです。
origin/master 最新は 24307a9 Add Render static frontend service (#97) のはずです。

やってほしいこと:
1. .env から Render API key を安全にProcess envへ読み込む。
2. Render APIで services をlistする。
3. insight-studio-frontend が存在するか確認する。
4. 存在すれば commitId 24307a9d0dbe688bd811708017aed57e90afcf9a を deploy trigger。
5. 存在しなければ、Render Blueprint sync が必要と判断し、Dashboard/APIで作成できる方法を実行または明確に案内する。
6. https://insight-studio-frontend.onrender.com/debug/ui-ux-review が200になるまで確認。
7. JS bundle内に "AI Graph Chat" / "Python Generated Charts" / "グラフを見ながら質問" が含まれることを確認。
8. ブラウザで Ads AI Report タブを開き、実装プレビューに Python Generated Charts + AI Graph Chat が表示されることを確認。

重要:
Render Dashboardにデプロイが出ないというユーザー指摘は正しいです。
以前はRenderが backend rootDir しか見ていなかったため、src配下のUI変更はRenderには出ませんでした。
今回はRender static frontendを追加したので、Blueprint同期または新サービス作成が必要です。
```
