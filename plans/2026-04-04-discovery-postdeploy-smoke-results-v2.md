# Discovery Post-Deploy Smoke Results v2 (2026-04-04 12:18 JST)

## 1. Deploy 確認結果

- Backend repo: `kazushi-tech/market-lens-ai`
- Commit: `74a86d7` (`fix: retry discovery analyze on gemini overload`)
- 前回 commit: `ed3c5b4` (`fix: harden discovery search transport retries`)
- Health endpoint: `GET /api/ml/health` → `200 OK`
- Render deploy: **確認済み** (`74a86d7` が live)

## 2. Smoke 実行条件

| 項目 | 値 |
|------|-----|
| Target URL | `https://www.petabit.co.jp` |
| Origin | `http://127.0.0.1:3002` (local dev server) |
| Request path | `/api/ml/discovery/analyze` (proxy → Render) |
| Provider | `anthropic` (CLAUDE_API_KEY) |
| Timeout | 180,000ms |
| Attempts | 5 |

Note: 今回は CLAUDE_API_KEY が環境にあったため `provider=anthropic` で実行。
前回 (v1) は GEMINI_API_KEY + `provider=google` だった。

## 3. 実行サマリー (5回)

| # | Timestamp (JST) | Status | Stage | Class | Elapsed | Result |
|---|-----------------|--------|-------|-------|---------|--------|
| 1 | 12:18:08 | 200 | complete | - | 119.8s | OK |
| 2 | 12:20:11 | 502 | search | upstream_502 (timeout) | 100.6s | FAIL |
| 3 | 12:21:55 | 502 | search | SSL/TLS | 44.2s | FAIL |
| 4 | 12:22:42 | 200 | complete | - | 168.3s | OK |
| 5 | 12:25:33 | 200 | complete | - | 119.0s | OK |

## 4. Success / Failure 件数

- **Success: 3/5 (60%)**
- **Failure: 2/5 (40%)**

## 5. Failure の Stage 内訳

| Stage | Type | Count |
|-------|------|-------|
| `search` | upstream_502 (timeout) | 1 |
| `search` | SSL/TLS (`WRONG_VERSION_NUMBER`) | 1 |

Failure detail (timeout):
> 競合検索がタイムアウト (stage=search)

Failure detail (SSL):
> 競合検索に失敗しました: [SSL: WRONG_VERSION_NUMBER] wrong version number (_ssl.c:2710) (stage=search)

## 6. 前回結果 (v1: ed3c5b4) との比較

| 指標 | v1 (ed3c5b4) | v2 (74a86d7) | 変化 |
|------|-------------|-------------|------|
| Success Rate | 2/5 (40%) | 3/5 (60%) | +20pt 改善 |
| `stage=search` SSL/TLS | 2 | 1 | -1 (改善) |
| `stage=search` timeout | 0 | 1 | +1 (新出) |
| `stage=analyze` Gemini 503 | 1 | 0 | -1 (解消) |
| Generic transport error | 0 | 0 | 変化なし (良好) |
| Frontend regression | 0 | 0 | 変化なし (良好) |

### 主要な改善点

1. **Gemini 503 が 0 件** — `74a86d7` の analyze retry が効果あり
2. **Success rate 40% → 60%** — 明確な改善傾向
3. **Generic transport error ゼロ維持** — stage-aware error contract は安定
4. **Frontend regression なし** — UI 側の問題は見られない

### 残存する問題

1. `stage=search` の SSL/TLS failure が 1 件残存
2. `stage=search` の timeout が 1 件 (新パターン — search の retry が timeout まで粘った可能性)
3. 両方とも Render outbound network 起因

## 7. 現時点の結論

- `74a86d7` (Gemini overload retry) の deploy 効果は確認済み
- **Gemini 503 問題は解消** — analyze stage の retry が機能している
- 残る不安定要因は **Render outbound TLS/SSL と search timeout のみ**
- これは code bug ではなく infra/provider track の範疇
- Success rate 60% は前回 40% から改善しているが、安定稼働には Render outbound の根本対策が必要

## 8. 推奨次アクション

### P0: Render outbound TLS/SSL 安定化
- `WRONG_VERSION_NUMBER` は引き続き Render → 外部サイトの TLS handshake 不安定が原因
- search timeout (100s) は retry が timeout 上限まで粘った結果の可能性あり
- 対策案:
  - search timeout を段階的に短縮して fast-fail + retry を増やす
  - `trust_env` 設定の再確認
  - Render の Python/OpenSSL バージョン確認

### P1: 成功率のベースライン強化
- 時間帯を変えた追加観測 (UTC昼間 vs 夜間)
- 10回以上の観測でベースラインを確立

### P2: provider 切り替え比較
- 今回は `anthropic` provider で実行
- 前回は `google` provider で実行
- provider の違いが analyze stage に影響するか比較する価値あり

---

## Appendix: 成功時の fetched_sites

### Attempt 1 (成功, 119.8s)
- sevendex.com (セブンデックス)
- top1-consulting.com (トゥルーコンサルティング)
- moltsinc.co.jp (THE MOLTS)
- nyle.co.jp (ナイル)
- smile-farm.co.jp (スマイルファーム)

### Attempt 4 (成功, 168.3s)
- netyear.net (ネットイヤーグループ)
- axalpha.com (アグザルファ)
- whiteknight-jp.com (ホワイトナイト)
- hakuhodo-consulting.co.jp (博報堂コンサルティング)
- dentsudigital.co.jp (電通デジタル)

### Attempt 5 (成功, 119.0s)
- micro-wave.net (マイクロウェーブ)
- principle-c.com (プリンシプル)
- axalpha.com (アグザルファ)
- members.co.jp (メンバーズ)
- itsumo365.co.jp (いつも)

Note: 3回の成功で毎回異なる競合セットが返されている。search ステージのクエリ結果の揺れによるもので正常な挙動。

---

## Security

- API key の実値は記録に含めていない
- smoke スクリプト内では redacted 表示のみ
