# Discovery Phase A v3 Smoke Results (2026-04-04 14:27 JST)

## 1. Deploy / Rollout 確認結果

- Backend repo: `kazushi-tech/market-lens-ai`
- Live commit: `9cc1074` (`docs: add discovery search render rollout memo`)
- Health endpoint: `GET /api/ml/health` -> `200 OK`
- Phase A env: **適用済み** (operator が Render Dashboard で確認・適用)
- env-only rollout のため commit hash は変わらず
- Phase A 適用後の health 復帰を operator が確認済み

### Phase A env 値 (適用済み)

```env
DISCOVERY_SEARCH_TRUST_ENV=true
DISCOVERY_SEARCH_TIMEOUT_SEC=75
DISCOVERY_GROUNDED_SEARCH_TIMEOUT_SEC=25
DISCOVERY_FALLBACK_SEARCH_TIMEOUT_SEC=8
DISCOVERY_SEARCH_MAX_RETRIES=3
DISCOVERY_SEARCH_RETRY_DELAY_SEC=0.5
```

## 2. Smoke 実行条件

| 項目 | 値 |
|------|-----|
| Target URL | `https://www.petabit.co.jp` |
| Origin | `http://127.0.0.1:3002` (local dev server) |
| Request path | `/api/ml/discovery/analyze` (proxy -> Render) |
| Provider | `anthropic` (Claude API) |
| Browser | Playwright headless Chromium |
| Timeout | 200,000ms |
| Attempts | 5 |

## 3. 実行サマリー (5回)

| # | Timestamp (JST) | HTTP | Stage | Class | UI Message | Elapsed | Result |
|---|-----------------|------|-------|-------|------------|---------|--------|
| 1 | 14:27:25 | 502 | search | upstream_502 | 競合検索がタイムアウト (search) | 86.5s | FAIL |
| 2 | 14:28:57 | 502 | search | SSL/TLS | WRONG_VERSION_NUMBER (_ssl.c:2710) (search) | 32.4s | FAIL |
| 3 | 14:29:34 | 200 | complete | - | Report displayed, 5 competitor cards | 160.8s | OK |
| 4 | 14:32:20 | 200 | complete | - | Report displayed, 5 competitor cards | 166.4s | OK |
| 5 | 14:35:11 | 200 | complete | - | Report displayed, 5 competitor cards | 159.0s | OK |

## 4. Success / Failure 件数

- **Success: 3/5 (60%)**
- **Failure: 2/5 (40%)**

## 5. Failure の Stage 内訳

| Stage | Type | Count |
|-------|------|-------|
| `search` | upstream_502 (timeout) | 1 |
| `search` | SSL/TLS (`WRONG_VERSION_NUMBER`) | 1 |
| `analyze` | Gemini 503 | **0** |

- Generic transport error: **0**
- Frontend regression: **0**

## 6. v2 (74a86d7) との比較

| 指標 | v2 (74a86d7) | v3 (Phase A) | 変化 |
|------|-------------|-------------|------|
| Success Rate | 3/5 (60%) | 3/5 (60%) | **横ばい** |
| `stage=search` SSL/TLS | 1 | 1 | 横ばい |
| `stage=search` upstream_502/timeout | 1 | 1 | 横ばい |
| `stage=analyze` Gemini 503 | 0 | 0 | **維持 (良好)** |
| Generic transport error | 0 | 0 | **維持 (良好)** |
| Frontend regression | 0 | 0 | **維持 (良好)** |

### Failure elapsed 比較

| 指標 | v2 | v3 (Phase A) | 変化 |
|------|-----|-------------|------|
| upstream_502 elapsed | 100.6s | 86.5s | **-14.1s (改善)** |
| SSL/TLS elapsed | 44.2s | 32.4s | **-11.8s (改善)** |

### Success elapsed 比較

| 指標 | v2 avg | v3 avg | 変化 |
|------|--------|--------|------|
| 成功時 avg elapsed | 135.7s | 162.1s | +26.4s (若干悪化) |

## 7. 現時点の結論

### 判定: 横ばい (Horizontal)

Phase A env 適用後の v3 smoke は v2 と同率の **3/5 (60%)** で横ばい。

**良い点:**
1. Gemini 503 = 0 を**維持** — analyze stage は安定
2. Generic transport error = 0 を**維持** — stage-aware error contract は安定
3. Frontend regression なし — UI 側に問題なし
4. Failure の elapsed が短縮 (upstream_502: 100.6s -> 86.5s, SSL/TLS: 44.2s -> 32.4s) — Phase A の fast-fail 意図が部分的に効いている

**課題:**
1. Success rate は改善していない (60% -> 60%)
2. Failure mix も v2 とほぼ同じ (SSL/TLS 1件 + upstream_502 1件)
3. 成功時の elapsed は若干増加 (avg 135.7s -> 162.1s)
4. `stage=search` の Render outbound TLS 不安定は Phase A では解消しない

### 解釈

- Phase A の `trust_env=true` + shorter timeout + retry はfailure を **速く検出** できるようにしたが、failure の **発生自体** は抑制できていない
- Render outbound の TLS handshake 不安定は env tuning の範囲を超えた infrastructure 問題の可能性が高い
- 成功時の elapsed 増加は、retry が走ったケースで復帰に時間がかかったことを示唆

## 8. 推奨次アクション

### Phase A の扱い

- **Rollback は不要** — 悪化していないため Phase A env はそのまま維持してよい
- Phase A の fast-fail 効果は確認できているため、ユーザー体験的には改善(失敗を速く通知)

### P0: Render outbound TLS 根本調査

Phase A env tuning だけでは解決しないことが判明。以下のいずれかを検討:

1. Render の Python / OpenSSL バージョン確認
2. Render リージョン or plan の変更検討
3. 外部 proxy (Cloudflare Workers 等) 経由での TLS 安定化
4. search provider 側の endpoint 変更

### P1: Phase B 検討

Phase A の結果が横ばいのため、Phase B (さらなる timeout 短縮) の優先度は低い。
env tuning よりも infra レイヤーの対策を優先すべき。

### P2: 時間帯別観測

- 今回は 14:27-14:38 JST (UTC 05:27) の昼間帯
- 夜間帯での追加観測で時間帯依存性を確認する価値あり

---

## Appendix: 成功時の fetched_sites

### Attempt 3 (OK, 160.8s)
- sevendex.com (セブンデックス)
- innova-jp.com (イノーバ)
- intrix.co.jp (イントリックス)
- sairu.co.jp (才流)
- symphony-marketing.co.jp (シンフォニーマーケティング)

### Attempt 4 (OK, 166.4s)
- netyear.net (ネットイヤーグループ)
- sairu.co.jp (才流)
- intrix.co.jp (イントリックス)
- moltsinc.co.jp (THE MOLTS)
- members.co.jp (メンバーズ)

### Attempt 5 (OK, 159.0s)
- netyear.net (ネットイヤーグループ)
- members.co.jp (メンバーズ)
- s-cubism.jp (エスキュービズム)
- on-site.co.jp (オンサイト)
- art-trading.co.jp (アートトレーディング)

Note: 3回の成功で毎回異なる競合セットが返されている。v2 と同様の正常な挙動。

---

## Appendix: Failure 詳細

### Attempt 1 (FAIL, 86.5s)
- HTTP 502
- UI: 「競合検索で失敗しました。競合検索がタイムアウト (search)」
- 「処理に時間がかかっています。しばらく待って再試行してください。」

### Attempt 2 (FAIL, 32.4s)
- HTTP 502
- UI: 「競合検索で失敗しました。競合検索に失敗しました: [SSL: WRONG_VERSION_NUMBER] wrong version number (_ssl.c:2710) (search)」
- 「サーバー側でエラーが発生しました。しばらく待って再試行してください。」

---

## Security

- API key の実値は記録に含めていない
- smoke スクリプト内では key 長のみ表示、値は非表示
- .env の実値は表示していない
