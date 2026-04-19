# 🌿 Phase 5B 実データ E2E 実行 & Phase 5C 設計ハンドオフ

**作成日**: 2026-04-18
**作成者**: Claude（Opus 4.7、ハンドオフ元セッション）
**プロジェクトオーナー**: 不二樹（kazushi.fujiki@marketing.petabit.co.jp）
**対象ベースコミット**: `4143319` (PR #42 マージ済、master 上)
**担当想定**: 別セッションの Claude（Opus 4.7、自律実行）

---

## 0. TL;DR（このセッションでやること）

1. **最新 master 取り込み**（`git pull origin master` で `4143319` を含める）
2. **dev server + backend 起動**（[dev.ps1](dev.ps1) 経由）
3. **既存 `search_id=a03bc0f98cfa`（カメラの大林）で動作確認**、駄目なら代替探索
4. **[scripts/phase5b-verify.py](scripts/phase5b-verify.py) を実行**（4 パターン G/H/I/J）
5. **`verify_output/phase5b/summary.json` の `all_passed: true` を確認**
6. **Gate OK → Phase 5C（v2 デフォルト昇格）プラン設計**を新規ファイルで作成
7. **Gate NG → 原因分類して `plans/2026-04-18-phase5b-e2e-failure.md` に記録**し不二樹に報告

---

## 1. Context（なぜ今これをやるか）

### 1-1. これまでの流れ
| PR | 内容 | commit |
|---|---|---|
| #36 | Discovery/Compare 精度・視覚化基盤 | c807714 |
| #37 | PriorityActionHero 検出整合 | 3b17158 |
| #38 | Section 5 契約 + deterministic stubs | b8e4ec3 |
| #39 | Schema 契約 + 3ブランド描画バグ根治 | 648adfe |
| #40 | Stitch 2.0 v2 UI scaffold + Phase 3 a11y | ac6bd5d |
| #41 | Phase 5A empty-state 検証（6 パターン PASS） | a084d3c |
| #42 | **Phase 5B harness + landing.css @theme cleanup** | 4143319 |

### 1-2. PR #42 で完了したこと
- `src/styles/landing.css` の dead `@theme` を削除（lightningcss warning 解消）
- [scripts/phase5b-verify.py](scripts/phase5b-verify.py) を新設（4 パターン G/H/I/J）
- `.gitignore` に `verify_output/` 追加
- `plans/2026-04-18-phase5b-verification-result.md` に結果雛形を配置
- Vercel deploy SUCCESS、全エンドポイント 200、Vitest 153/153、build warning なし

### 1-3. PR #42 で **未完了**のこと（= このセッションの主目的）
**実データ E2E の実際の実行**。harness は書かれたが、`DISCOVERY_SEARCH_ID` と稼働中 dev server が必要なため、前セッションでは**スクリプト実行まで到達できなかった**。

この未達が Phase 5C（v2 デフォルト昇格）の前提根拠を欠く状況を作っており、empty-state 検証のみでは `useUiVersion` の DEFAULT を v2 に切替える根拠として弱い（PR #41 report §8 で実装Claude が自認）。

### 1-4. 成功条件
- Phase 5B harness が 4 パターン全て PASS し、v2 実描画が視認可能な状態になる
- Gate 通過なら Phase 5C プランを起草して次セッションへ引き継げる

---

## 2. Part A: Playwright E2E 実行（推定 1〜2 時間）

### 2-1. 前準備

#### (a) 最新コード取り込み
```bash
cd "c:/Users/PEM N-266/work/insight-studio"
git status                      # ローカル変更を確認
git fetch origin
git log --oneline origin/master -3  # 4143319 が先頭にあること
git pull origin master          # 未取得なら取り込む（merge/rebase は状況判断）
```

**注意**: ローカル master が origin/master と divergent な場合は、不二樹に確認してから pull すること。安易に `--force` や `reset --hard` は禁止（userルール）。

#### (b) Playwright セットアップ（初回のみ）
```bash
pip install playwright
python -m playwright install chromium
```

#### (c) dev server + backend 起動
PowerShell で [dev.ps1](dev.ps1) を使うのが推奨じゃ（全サービス一括起動）。

```powershell
./dev.ps1
```

または個別起動：
```bash
# Frontend (port 3002)
npm run dev

# Backend market-lens-ai (port 8002)
cd backends/market-lens-ai && uvicorn web.app.main:app --host 127.0.0.1 --port 8002 --reload

# Backend ads-insights (port 8001) ※今回は不要
```

**起動確認**:
```bash
curl http://localhost:3002/           # 200
curl http://localhost:8002/api/ml/health  # 200
```

#### (d) 認証 token 取得
harness は `AUTH_TOKEN` 環境変数で `Authorization: Bearer <token>` を付与する。未設定でも認証スキップ動作があるが、Discovery 結果取得には token が必要な可能性が高い。

既存のログイン済ブラウザで `localStorage.getItem('is_ads_token')` から取得できる。未取得時は不二樹に依頼。

---

### 2-2. `search_id` の確定

#### (a) 第一候補: `a03bc0f98cfa`（カメラの大林）
過去セッションで言及された既存 Discovery 完了済ジョブじゃ。まずこれを試す。

**事前検証**:
```bash
# envelope エンドポイントが 200 を返すか確認
curl -H "Authorization: Bearer $AUTH_TOKEN" \
  http://localhost:8002/api/ml/discovery/envelope/a03bc0f98cfa

# もしくは直接ブラウザで
# http://localhost:3002/discovery/result?search_id=a03bc0f98cfa&ui=v2
```

期待: 200 + JSON（`priority_actions`, `brand_evaluations`, `market_estimate` が埋まっている）。

**もし 404 / 401 / 不完全 envelope の場合**:
- 不二樹にログイン済の状態で Discovery 画面から最近完了したジョブの `search_id` をもらう
- または staging DB で `SELECT id FROM searches WHERE status='completed' ORDER BY created_at DESC LIMIT 3;` 的な問い合わせ（不二樹経由、直接 DB 叩かないこと）

#### (b) 代替: 新規 Discovery ジョブ実行
上記で適切な `search_id` が得られない場合、新規実行を不二樹に依頼。コスト発生するため**必ず承認を取る**。

---

### 2-3. E2E 実行

```bash
# 環境変数セット（bash / git bash）
export DISCOVERY_SEARCH_ID=a03bc0f98cfa
export AUTH_TOKEN="<取得した token>"
export PHASE5B_BASE_URL=http://localhost:3002

# 実行
python scripts/phase5b-verify.py
```

PowerShell の場合：
```powershell
$env:DISCOVERY_SEARCH_ID = "a03bc0f98cfa"
$env:AUTH_TOKEN = "<token>"
python scripts/phase5b-verify.py
```

**出力先**: `verify_output/phase5b/`
- `summary.json`（全パターンの結果、`all_passed` フラグ）
- `G_discovery_v1.png` / `H_discovery_v2.png` / `I_compare_v2.png` / `J_fallback.png`
- 各パターンの console/page error ログ

### 2-4. Gate 判定

```bash
# summary.json を確認
cat verify_output/phase5b/summary.json | python -m json.tool | head -30
```

**PASS 条件**（`plans/claude-html-markdown-claude-claude-jolly-kay.md` §6 に基づく）:
- [ ] Pattern G / H / I / J 全て `passes.length > 0` かつ `fails.length == 0`
- [ ] `all_passed: true`
- [ ] 各パターンで `console_errors == 0` / `page_errors == 0`
- [ ] Pattern H（v2 Discovery）で `<div class="ui-v2">` が検出されている
- [ ] Pattern H / I / J で v2 コンポーネント群（PriorityActionHeroV2 / CompetitorMatrixV2 / BrandRadarV2 / MarketRangeV2 / ConfidencePill）が DOM 存在

### 2-5. 結果ドキュメント更新
Gate 通過 / 失敗どちらの場合も、既存 `plans/2026-04-18-phase5b-verification-result.md` に実行結果を追記すること。

追記項目：
- 実行日時、使用 `search_id`、使用 AUTH_TOKEN の有無
- 4 パターン判定表
- スクリーンショット参照
- 発見事項（Critical / High / Medium）

---

## 3. Part B: Gate 通過時の次手 — Phase 5C プラン設計

### 3-1. Phase 5C の目的
**`useUiVersion` の DEFAULT を `'v1' → 'v2'` に切替え**て、v2 を全ユーザーのデフォルト体験にする。v1 は `?ui=v1` で引き続き利用可能（後方互換）。

### 3-2. 変更ファイル
- [src/hooks/useUiVersion.js](src/hooks/useUiVersion.js) — `DEFAULT` 定数の切替（1 行変更）
- [src/components/report/v2/UiVersionToggle.jsx](src/components/report/v2/UiVersionToggle.jsx) — 既定表示を v2 前提に調整（必要なら）
- テスト更新（[src/hooks/__tests__/useUiVersion.test.js](src/hooks/__tests__/useUiVersion.test.js) 等、存在する場合）

### 3-3. Phase 5C プラン作成手順
別の Claude に投げる前提で、以下を含む新規プランを `plans/2026-04-18-phase5c-v2-default-promotion-plan.md` に作成：

1. **Context**: Phase 5B E2E 通過の根拠（summary.json 抜粋）
2. **切替内容**: 1 行変更の diff 案
3. **ロールバック手順**: `?ui=v1` での即時復帰、および git revert
4. **周知範囲**: 不二樹、社内ステークホルダー
5. **リリース Gate**:
   - vitest 全緑
   - Playwright G/H 再実行（DEFAULT 切替後の挙動確認）
   - Vercel deploy SUCCESS
   - 既存 search_id でブラウザ目視確認
6. **監視項目**（昇格後 24〜48 時間）:
   - console error 増加の有無
   - Sentry などの例外ログ（設定があれば）
   - ユーザーフィードバック

### 3-4. Phase 5C 実施タイミング
Phase 5C は**プラン作成まで**が本セッションの射程。実際の切替 PR は不二樹の承認を経て次セッションで行う。

---

## 4. Gate 失敗時の対応（Critical 発見時）

### 4-1. 失敗分類
| 現象 | 推定原因 | 対応 |
|---|---|---|
| Pattern H で `.ui-v2` 未検出 | `Discovery.jsx` の v1/v2 分岐ミス | [src/pages/Discovery.jsx:971-982](src/pages/Discovery.jsx#L971) 確認 |
| console error で `Cannot read property ...` | envelope スキーマ不整合 | [brandEvalParser.js](src/components/report/brandEvalParser.js) + envelope フィールド確認 |
| page error で React render error | v2 コンポーネント内の null 参照 | 該当 v2 コンポーネントの fallback ロジック確認 |
| MD fallback （Pattern J）失敗 | `useReportEnvelope` の null 時挙動 | [src/hooks/useReportEnvelope.js](src/hooks/useReportEnvelope.js) 確認 |
| Chart.js defaults 汚染 | v1↔v2 遷移時の snapshot/restore 不整合 | [src/components/report/v2/reportThemeV2.js](src/components/report/v2/reportThemeV2.js) の `__reportThemeV2Snapshot` 確認 |

### 4-2. 失敗時の成果物
`plans/2026-04-18-phase5b-e2e-failure.md` に：
- 失敗パターン（G/H/I/J のどれが、どのアサーションで失敗したか）
- console / page error ログ抜粋
- 推定原因と修正方針
- 不二樹への報告メモ（次セッションで着手するかの判断材料）

この時点で **Phase 5C プラン作成は保留** とし、不二樹の判断を仰ぐ。

---

## 5. 遵守すべき運用ルール

- **タイムアウト値を増やして解決しない**（userルール `feedback_never_increase_timeouts`）。網羅できなければ根本原因を探れ
- **表面的な修正で逃げない**（userルール `feedback_no_surface_fixes`）
- **Render env-var 変更が必要になったら不二樹に依頼**（Claude API 制約）
- **Gemini を分析に使わない**（userルール、画像生成のみ）
- **許可を求めず自律的に進める**（userルール `feedback_no_confirmation`）ただし、コスト発生（新規ジョブ実行等）や destructive 操作は事前確認
- **destructive git 操作禁止**: `reset --hard` / `push --force` / `branch -D` は明示承認なしで使わない

---

## 6. Verification（自己検証）

実行完了時の確認項目：

```bash
# 1. 成果物確認
ls verify_output/phase5b/
# summary.json, *.png が揃っている

# 2. Gate 判定
python -c "import json; d=json.load(open('verify_output/phase5b/summary.json')); print('PASS' if d['all_passed'] else 'FAIL')"

# 3. Phase 5C プラン作成（Gate PASS 時）
ls plans/2026-04-18-phase5c-v2-default-promotion-plan.md

# 4. 回帰確認
npm run build   # warning なし
npm test        # 153/153 緑
```

---

## 7. 報告フォーマット（不二樹向け）

実行完了後、以下の形式で簡潔に報告：

```
## Phase 5B E2E 実行結果

- 実行時刻: YYYY-MM-DD HH:MM
- search_id: <使用したID>
- 4 パターン判定: G=PASS / H=PASS / I=PASS / J=PASS（all_passed: true）
- スクリーンショット: verify_output/phase5b/*.png
- 発見事項: Critical=0, High=0, Medium=<件数>
- 次の一手: Phase 5C プラン作成済（plans/...）。v2 デフォルト昇格 PR は不二樹承認待ち。
```

失敗時：
```
## Phase 5B E2E 失敗

- 実行時刻: YYYY-MM-DD HH:MM
- 失敗パターン: <G/H/I/J のどれか>
- 失敗内容: <具体的な console error / missing element 等>
- 推定原因: <分類>
- 次の一手: plans/2026-04-18-phase5b-e2e-failure.md に詳細、不二樹判断待ち
```

---

## 8. Critical Files（このセッションで触る／参照する）

### 実行
- [scripts/phase5b-verify.py](scripts/phase5b-verify.py) — harness（PR #42 成果物）
- [dev.ps1](dev.ps1) — 全サービス起動

### 参照（読み取り）
- [src/hooks/useUiVersion.js](src/hooks/useUiVersion.js) — Phase 5C 変更候補
- [src/hooks/useReportEnvelope.js](src/hooks/useReportEnvelope.js)
- [src/components/report/v2/ReportViewV2.jsx](src/components/report/v2/ReportViewV2.jsx)
- [src/components/report/v2/reportThemeV2.js](src/components/report/v2/reportThemeV2.js)
- [src/pages/Discovery.jsx](src/pages/Discovery.jsx)
- [src/pages/Compare.jsx](src/pages/Compare.jsx)
- [backends/market-lens-ai/web/app/schemas/report_envelope.py](backends/market-lens-ai/web/app/schemas/report_envelope.py)

### 新規作成（Gate 結果に応じて）
- `plans/2026-04-18-phase5c-v2-default-promotion-plan.md`（Gate PASS 時）
- `plans/2026-04-18-phase5b-e2e-failure.md`（Gate FAIL 時）

### 追記
- `plans/2026-04-18-phase5b-verification-result.md`（実行結果を必ず追記）

---

## 9. 非ゴール（このセッションで触らない）

- v2 デフォルト昇格 PR の実施（プラン作成止まり）
- Phase 4B（EvidenceDetail / JudgmentBadge 等の v2 化）
- backend の変更
- モバイル対応
- ads-insights 側への影響
- Gemini 切替
- タイムアウト値増加

---

## 10. 想定所要時間

| セクション | 推定 |
|---|---|
| 2-1 前準備（環境構築・dev server 起動） | 15-30 分 |
| 2-2 search_id 確定（既存 ID が使える場合） | 5-10 分 |
| 2-3 E2E 実行 | 5-10 分（Playwright 4 パターン） |
| 2-4 Gate 判定 + ドキュメント更新 | 15-20 分 |
| 3 Phase 5C プラン起草（Gate PASS 時） | 30-45 分 |
| **合計** | **1-2 時間** |

---

**本セッションの射程は明確じゃ：E2E を回して Gate を判定し、通れば Phase 5C プランを起草して次に渡す。それだけ。余計なスコープ拡張は禁物じゃぞよ♡**
