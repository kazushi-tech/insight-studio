# 再発防止プラン v2 — CI/CD自動化 + 監視 + Preview Deploy

## Context

2026-04-13〜14 の Discovery Hub 本番障害を受け、第1弾の対策（Lint Gate / Smoke Test / Budget Monitor）は実装済み。
しかし現状は**手動実行に依存**しており、以下のリスクが残る:

1. **CI が無い** — husky は手元でしかlintしない。`--no-verify` やクローン直後は素通り
2. **監視が無い** — PipelineBudgetTracker のデータを誰も見ていない。Budget Pressure に気づけない
3. **本番直デプロイ** — master push → 即 Vercel 本番。壊れたコードが確認なしで公開される

本プランは **3つの自動化対策** で上記を解決する:

| # | 対策 | 守る範囲 | 実装先 |
|---|------|----------|--------|
| 1 | GitHub Actions CI | lint + build を自動ゲート化 + デプロイ後ヘルスチェック | insight-studio |
| 2 | 定期ヘルスモニター | バックエンド死活監視 + Budget Pressure 検知 | insight-studio (GitHub Actions cron) |
| 3 | Preview Deploy フロー | PR ベースの確認 → マージ → 本番 | GitHub branch protection + Vercel |

### 前提: 実装済みの対策（変更なし）

| 対策 | 状態 |
|------|------|
| Pre-commit Lint Gate (husky + lint-staged) | ✅ `.husky/pre-commit` |
| Smoke Test (`npm run smoke`) | ✅ `scripts/smoke-test.mjs` |
| PipelineBudgetTracker + `/api/health` | ✅ `pipeline_metrics.py` + `health_routes.py` |
| Quality Gate 警告バナー化 | ✅ Discovery.jsx / Compare.jsx |

---

## 対策 1: GitHub Actions CI

### 目的
push / PR のたびに lint + build を自動実行し、失敗したらマージをブロックする。
master マージ後はデプロイ完了を待ってヘルスチェックを実行する。

### 新規ファイル

| ファイル | 操作 |
|----------|------|
| `.github/workflows/ci.yml` | 新規作成 |

### 設計判断

- **Job 1 `ci`**: lint + build（PR・pushどちらでも実行。マージゲート）
- **Job 2 `post-deploy-health`**: master push 時のみ、Vercel デプロイ完了を待って本番URLにヘルスチェック
- Smoke test (`scripts/smoke-test.mjs`) は dev server + 生バックエンド接続が必要で CI では不安定。CIは lint + build に限定
- `npm ci` で lockfile ベースの決定論的インストール
- Node 20（Vercel デフォルトと合わせる）

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run build

  post-deploy-health:
    if: github.event_name == 'push' && github.ref == 'refs/heads/master'
    needs: ci
    runs-on: ubuntu-latest
    steps:
      - name: Wait for Vercel deploy
        run: sleep 90

      - name: Check frontend
        run: |
          status=$(curl -s -o /dev/null -w '%{http_code}' https://insight-studio-chi.vercel.app/)
          if [ "$status" != "200" ]; then
            echo "::error::Frontend returned HTTP $status"
            exit 1
          fi
          echo "Frontend OK ($status)"

      - name: Check ML API via Vercel proxy
        run: |
          status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 45 \
            https://insight-studio-chi.vercel.app/api/ml/health)
          if [ "$status" != "200" ]; then
            echo "::error::ML API proxy returned HTTP $status"
            exit 1
          fi
          echo "ML API proxy OK ($status)"

      - name: Check Ads API via Vercel proxy
        run: |
          status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 45 \
            https://insight-studio-chi.vercel.app/api/ads/health)
          if [ "$status" != "200" ]; then
            echo "::error::Ads API proxy returned HTTP $status"
            exit 1
          fi
          echo "Ads API proxy OK ($status)"
```

### ポイント
- `--max-time 45`: Render free tier のコールドスタート（30-40秒）を考慮
- `sleep 90`: Vercel デプロイ完了待ち（通常60-90秒）
- ヘルスチェックは Vercel rewrite 経由 → **プロキシ設定の正常性も同時検証**
- 失敗時は GitHub が自動でメール通知

---

## 対策 2: 定期ヘルスモニター

### 目的
30分ごとにバックエンド + フロントエンドの死活を自動チェック。
Budget Pressure 検知時は GitHub Actions の warning annotation で記録。
ダウン時は workflow failure → メール通知。

### 新規ファイル

| ファイル | 操作 |
|----------|------|
| `.github/workflows/monitor.yml` | 新規作成 |

### 設計判断

- **30分間隔** (`*/30 * * * *`): 月 ~1,440 回 × ~1分/回 = ~1,440分。GitHub Actions 無料枠 2,000分/月に収まる
- 外部サービス（UptimeRobot等）不要 — GitHub Actions だけで完結
- `workflow_dispatch` で手動実行も可能
- Budget Pressure は warning（ジョブ失敗にはしない）、サービスダウンは error（ジョブ失敗）

### `.github/workflows/monitor.yml`

```yaml
name: Health Monitor

on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch: {}

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - name: Check ML backend health
        run: |
          response=$(curl -sf --max-time 45 \
            https://market-lens-ai.onrender.com/api/health || echo '{"ok":false}')
          echo "$response" | jq .

          ok=$(echo "$response" | jq -r '.ok // false')
          warnings=$(echo "$response" | jq -r '.discovery_pipeline.recent_budget_warnings // 0')

          if [ "$ok" != "true" ]; then
            echo "::error::ML backend is DOWN (ok=$ok)"
            exit 1
          fi
          echo "ML backend OK"

          if [ "$warnings" -gt 0 ] 2>/dev/null; then
            echo "::warning::Budget pressure detected: $warnings warning(s) in last hour"
          fi

      - name: Check Ads backend health
        run: |
          status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 45 \
            https://ads-insights-9q5s.onrender.com/api/health)
          if [ "$status" != "200" ]; then
            echo "::error::Ads backend returned HTTP $status"
            exit 1
          fi
          echo "Ads backend OK ($status)"

      - name: Check frontend availability
        run: |
          status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
            https://insight-studio-chi.vercel.app/)
          if [ "$status" != "200" ]; then
            echo "::error::Frontend returned HTTP $status"
            exit 1
          fi
          echo "Frontend OK ($status)"
```

### 通知フロー

```
30分ごとに実行
  ├── 全 OK → ログに記録のみ
  ├── Budget Pressure > 0 → warning annotation（メールなし）
  └── サービスダウン → workflow FAIL → GitHub メール通知
```

### オプション: Slack 通知（後から追加可能）

Repository Secret に `SLACK_WEBHOOK_URL` を設定し、以下のステップを追加:

```yaml
      - name: Notify Slack on failure
        if: failure()
        run: |
          curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"Health check FAILED. <https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}|Details>\"}" \
            ${{ secrets.SLACK_WEBHOOK_URL }}
```

---

## 対策 3: Preview Deploy フロー

### 目的
master への直 push を禁止し、PR → Preview 確認 → マージ → 本番デプロイのフローを強制する。

### 変更対象

| 対象 | 操作 |
|------|------|
| GitHub `master` ブランチ保護ルール | 新規設定（GitHub UI） |
| `.github/workflows/ci.yml` | 対策1で作成済み（PR時に `ci` ジョブが走る） |

### 仕組み

Vercel は GitHub 連携で**PR ブランチへの push ごとに自動で Preview デプロイを作成する**（設定不要、Vercel のデフォルト動作）。
PR ページの "Deployments" セクションに Preview URL が表示される。

```
開発者のフロー:
  1. feature branch 作成 → push
  2. PR を開く
  3. GitHub Actions CI (lint + build) が自動実行
  4. Vercel が Preview URL を自動生成（例: insight-studio-abc123.vercel.app）
  5. Preview URL で動作確認
  6. CI パス → PR マージ可能に
  7. master にマージ → Vercel が本番デプロイ
  8. post-deploy-health が本番URLをチェック
```

### GitHub Branch Protection 設定手順

GitHub リポジトリの Settings → Branches → Add branch ruleset:

| 設定項目 | 値 | 理由 |
|----------|-----|------|
| Branch name pattern | `master` | 本番ブランチを保護 |
| Require a pull request before merging | **ON** | 直 push 禁止 |
| Required approvals | **0** | 1人チームなので承認不要 |
| Require status checks to pass | **ON** | CI を必須ゲートに |
| Required status checks | `ci` | `.github/workflows/ci.yml` の job 名 |
| Require branches to be up to date | OFF | リベース強制は不要 |
| Include administrators | **ON** | 自分自身にもルール適用 |
| Allow force pushes | **OFF** | 履歴破壊を防止 |
| Allow deletions | **OFF** | master 削除を防止 |

### 緊急時の対応

ブランチ保護を一時的に無効化する手順:
1. GitHub Settings → Branches → master ルール → Edit
2. 「Include administrators」を OFF に変更
3. 緊急 push を実行
4. 完了後「Include administrators」を ON に戻す

---

## 実装順序

```
Phase 1: CI ワークフロー作成（対策 1）
  ├── .github/workflows/ci.yml 作成
  ├── feature branch で push → PR 作成
  ├── CI ジョブ (lint + build) が PASS することを確認
  └── マージ → post-deploy-health が実行されることを確認

Phase 2: ブランチ保護設定（対策 3）
  ├── GitHub Settings で master ブランチ保護ルール追加
  ├── Required status check に "ci" を指定
  ├── master への直 push が拒否されることを確認
  └── PR 経由でのみマージ可能なことを確認

Phase 3: ヘルスモニター追加（対策 2）
  ├── .github/workflows/monitor.yml 作成
  ├── PR → CI パス → マージ
  ├── workflow_dispatch で手動実行 → 全チェック PASS を確認
  └── GitHub のメール通知設定を確認（Settings → Notifications → Actions）

Phase 4: 動作確認（全対策の統合テスト）
  ├── lint エラーを含む PR → CI FAIL → マージ不可
  ├── クリーンな PR → CI PASS → Vercel Preview 生成 → マージ → 本番デプロイ
  ├── post-deploy-health → 本番 URL ヘルスチェック PASS
  └── 30 分後 → monitor ワークフロー自動実行 → PASS
```

---

## 検証方法

### 対策 1 (CI) の検証

```bash
# 1. lint エラーを含む PR
git checkout -b test/ci-fail
echo "const x = 1" >> src/pages/tmp-test.jsx
git add src/pages/tmp-test.jsx
git commit -m "test: deliberate lint error" --no-verify
git push -u origin test/ci-fail
# → PR 作成 → CI FAIL を確認 → PR 削除

# 2. クリーンな PR
git checkout -b test/ci-pass
# (何か軽微な変更)
git commit -m "test: clean change"
git push -u origin test/ci-pass
# → PR 作成 → CI PASS → マージ
# → post-deploy-health ジョブが走ることを確認
```

### 対策 2 (Monitor) の検証

```bash
# GitHub Actions タブ → "Health Monitor" → "Run workflow" で手動実行
# → 全ステップ PASS を確認
# → ML backend health のレスポンスに discovery_pipeline が含まれることを確認
```

### 対策 3 (Preview Deploy) の検証

```bash
# 1. 直 push が拒否される
git checkout master
git push origin master
# → rejected: protected branch

# 2. PR 経由でマージできる
git checkout -b test/preview
# (変更) → push → PR → CI PASS → Vercel Preview URL 確認 → マージ
```

---

## 最終的な防衛アーキテクチャ

```
                    開発者
                      │
                 git commit
                      │
              ┌───────▼───────┐
              │  Husky + ESLint │  ← ローカルゲート
              │  (pre-commit)   │
              └───────┬───────┘
                      │ push (feature branch)
              ┌───────▼───────┐
              │  GitHub Actions │  ← CI ゲート
              │  lint + build   │
              └───────┬───────┘
                      │ PR
              ┌───────▼───────┐
              │  Vercel Preview │  ← 目視確認
              │  (自動生成URL)   │
              └───────┬───────┘
                      │ merge to master
              ┌───────▼───────┐
              │  Vercel 本番    │  ← 自動デプロイ
              │  デプロイ       │
              └───────┬───────┘
                      │ 90秒後
              ┌───────▼───────┐
              │  Post-deploy   │  ← デプロイ後チェック
              │  Health Check   │
              └───────┬───────┘
                      │
              ┌───────▼───────┐
              │  30分定期監視   │  ← 継続監視
              │  (cron monitor) │
              └───────────────┘
```

### 各レイヤーが防ぐもの

| レイヤー | 防ぐ問題 |
|----------|----------|
| Husky (ローカル) | lint エラーのコミット |
| CI (GitHub Actions) | ビルド失敗、`--no-verify` すり抜け |
| Preview (Vercel) | UIレイアウト崩れ、画面遷移バグ |
| Post-deploy | プロキシ設定ミス、バックエンド接続断 |
| 定期監視 | バックエンドダウン、Budget Pressure 蓄積 |
