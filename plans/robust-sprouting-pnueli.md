# Discovery Hub タイムアウト修正 & API速度改善

## Context

Discovery Hub で「比較分析がタイムアウト (stage=analyze)」エラーが頻発（2分46秒で発生）。
AI系機能（競合分析・発見・バナーレビュー・考察生成）全般的に遅い。
根本原因を調査した結果、フロントエンドのバグ1件 + バックエンドのタイムアウト設定不足 + UX改善余地を特定。

---

## Priority 1: フロントエンド バグ修正（即時）

**ファイル:** `src/pages/Discovery.jsx`

**問題:** L297, L302 で未定義変数 `POLL_INTERVAL_MS` を参照。定義済みは `POLL_INTERVAL_INITIAL_MS`(2000) と `POLL_INTERVAL_SLOW_MS`(5000)。

`pollJob` 内部にフォールバックがあるため即座にクラッシュはしないが、`updateRunMeta` に `undefined` が格納される。正しくない。

**修正:**
```diff
- pollIntervalMs: data.retry_after_sec ? data.retry_after_sec * 1000 : POLL_INTERVAL_MS,
+ pollIntervalMs: data.retry_after_sec ? data.retry_after_sec * 1000 : POLL_INTERVAL_INITIAL_MS,
```
L297 と L302 の2箇所。

---

## Priority 2: バックエンド analyze タイムアウト延長

**ファイル:**
- `tmp_market_lens_ai_repo/web/app/services/discovery/discovery_pipeline.py` L218
- `tmp_market_lens_ai_repo/web/app/routers/discovery_routes.py` L227

**問題:** `DISCOVERY_ANALYZE_TIMEOUT_SEC` のデフォルトが 90秒。Claude APIは競合数が多いと60-120秒かかるため、90秒では不足。

**修正:** デフォルト値を `"90"` → `"150"` に変更。

**安全性:** 非同期ジョブパターンなのでHTTP接続を保持しない。フロントエンドの5分絶対タイムアウトが安全弁として機能。

**追加:** Render環境変数にも `DISCOVERY_ANALYZE_TIMEOUT_SEC=150` を設定。

---

## Priority 3: analyze中の体感速度改善

**ファイル:** `src/pages/Discovery.jsx`

### 3a. analyze中のプログレスバー疑似進行

現状 analyze ステージで progress が 90% に固定されたまま60-150秒動かない。

**修正:** ポーリング tick 内で `stage === 'analyze'` の場合、経過時間に応じて 90→99% へ段階的にインクリメント（5秒ごとに約1%）。

### 3b. タイムアウトエラーに現在ステージを含める

現状の「分析がタイムアウトしました（5分）」を、最後のポーリングで取得したステージ名を付与して具体化。

### 3c. 推定残り時間の表示

各ステージの典型的な所要時間に基づき「残り約1-2分」のような表示を追加。

---

## Priority 4: バックエンド ポーリング最適化

**ファイル:**
- `tmp_market_lens_ai_repo/web/app/schemas/discovery_job.py`
- `tmp_market_lens_ai_repo/web/app/routers/discovery_routes.py`

**修正:** ポーリングレスポンスに `retry_after_sec` を追加し、ステージに応じた値を返す:
- `queued`/`brand_fetch`/`classify`: 2秒
- `search`/`fetch_competitors`: 3秒
- `analyze`: 5秒（長いので頻繁にポーリングしても意味がない）

---

## 対象外（今回やらない）

- 結果キャッシュ（バックエンド改修が大きい）
- SSE/WebSocketストリーミング（アーキテクチャ変更）
- Render cold start対策（別課題）

---

## 実装順序

| Step | 内容 | ファイル |
|------|------|---------|
| 1 | `POLL_INTERVAL_MS` → `POLL_INTERVAL_INITIAL_MS` 修正 | `src/pages/Discovery.jsx` |
| 2 | analyze タイムアウトデフォルト 90→150秒 | backend pipeline.py, routes.py |
| 3 | analyze中プログレスバー疑似進行 | `src/pages/Discovery.jsx` |
| 4 | タイムアウトエラーメッセージ改善 | `src/pages/Discovery.jsx` |
| 5 | ポーリングレスポンスに retry_after_sec 追加 | backend schemas, routes |
| 6 | 推定残り時間の表示 | `src/pages/Discovery.jsx` |

## 検証方法

1. `npm run dev` でローカル起動
2. Discovery Hub で URL を入力して「競合を発見」実行
3. プログレスバーが analyze 中に 90→99% へ動くことを確認
4. エラーが出にくくなったことを確認（バックエンド側は Render deploy 後に本番確認）
5. `npm run build` で型エラー・ビルドエラーなしを確認
