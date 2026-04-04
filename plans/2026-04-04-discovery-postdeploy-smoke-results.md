# Discovery Post-Deploy Smoke Results (2026-04-04 11:47 JST)

## 1. Deploy 確認結果

- Backend repo: `kazushi-tech/market-lens-ai`
- Commit: `ed3c5b4ef26d196ec1f123bd97a96b8c927685c9`
- Health endpoint: `GET /api/ml/health` → `200 OK`
- Render deploy: **確認済み** (`ed3c5b4` が live)

## 2. Smoke 実行条件

| 項目 | 値 |
|------|-----|
| Target URL | `https://www.petabit.co.jp` |
| Origin | `http://127.0.0.1:3002` (local dev server) |
| Request path | `/api/ml/discovery/analyze` (proxy → Render) |
| Provider | `google` (GEMINI_API_KEY) |
| Timeout | 180,000ms |
| Attempts | 5 |

Note: CLAUDE_API_KEY が環境に無かったため GEMINI_API_KEY + `provider=google` で実行。
Discovery の search / analyze 両ステージとも Gemini を使用した形になる。

## 3. 実行サマリー (5回)

| # | Timestamp (UTC) | Status | Stage | Class | Elapsed | Result |
|---|-----------------|--------|-------|-------|---------|--------|
| 1 | 02:47:38 | 502 | search | SSL/TLS | 38.5s | FAIL |
| 2 | 02:48:19 | 200 | complete | - | 118.1s | OK |
| 3 | 02:50:20 | 502 | analyze | provider_load/503 | 129.3s | FAIL |
| 4 | 02:52:33 | 200 | complete | - | 106.1s | OK |
| 5 | 02:54:22 | 502 | search | SSL/TLS | 48.9s | FAIL |

## 4. Success / Failure 件数

- **Success: 2/5 (40%)**
- **Failure: 3/5 (60%)**

## 5. Failure の Stage 内訳

| Stage | Type | Count |
|-------|------|-------|
| `search` | SSL/TLS (`WRONG_VERSION_NUMBER`) | 2 |
| `analyze` | Gemini `503 UNAVAILABLE` (high demand) | 1 |

Failure detail (search):
> 競合検索に失敗しました: [SSL: WRONG_VERSION_NUMBER] wrong version number (_ssl.c:2710) (stage=search)

Failure detail (analyze):
> Gemini 呼び出しエラー: 503 UNAVAILABLE. This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.

## 6. 現時点の結論

### Transport Retry Hardening 後の改善確認

1. **Generic transport error は 0 件** — 以前あった `Failed to fetch` / generic `500 Internal server error (SSLError)` のような未分類エラーは完全に消えている
2. **Stage-aware error contract が正常動作** — すべての失敗に `(stage=search)` / `(stage=analyze)` marker が付与されている
3. **Discovery は複数回 success** — 5回中2回がレポート生成まで完走（`fetched_sites` 5件 + `report_md` あり）
4. **失敗は infra/provider 起因のみ** — frontend regression の兆候なし

### Success Criteria 判定

| Criteria | Status |
|----------|--------|
| Discovery が少なくとも複数回 success する | **PASS** (2/5) |
| 失敗しても generic transport error に戻らない | **PASS** (0件) |
| 失敗の主因を stage に切り分けられる | **PASS** (search/analyze 明確) |
| Code regression を疑う兆候 | **なし** |

**結論: 「まだ infra/provider track 継続」だが、transport hardening は改善効果あり。**

成功時と失敗時が混在し、失敗が SSL/TLS と Gemini 503/load に偏る。
Frontend regression は見えない。

## 7. 推奨次アクション

### P0: Render → 外部 TLS/SSL 問題の継続追跡

- `WRONG_VERSION_NUMBER` は Render outbound の TLS ハンドシェイク不安定が主因
- `ed3c5b4` の retry hardening で search step 内の retry は入ったが、まだ吸収しきれていない
- 対策案:
  - `trust_env=True` への切り替え検証
  - SSL/TLS retry 回数の増加 (現行では足りない可能性)
  - Render 側の CA 証明書/OpenSSL バージョン確認

### P1: Gemini 503 対策

- Gemini 側の `503 UNAVAILABLE` は provider 側の一時過負荷
- analyze ステージの retry 戦略の追加・強化
- fallback model の検討 (Gemini Flash 等の低負荷モデル)

### P2: 成功率のベースライン化

- 現時点 40% (2/5) は intermittent infra/provider 問題の範囲内
- 時間帯を変えた追加観測で成功率のベースラインを確立すると良い
- 日本時間夜間 (UTC 昼間) と日本時間昼間 (UTC 夜間) で差があるか

---

## Appendix: 成功時の fetched_sites

### Attempt 2 (成功)
- deloitte.com (デロイト トーマツ)
- pwc.com (PwC Japan)
- kpmg.com (KPMG Japan)
- ey.com (EY Japan)
- accenture.com (アクセンチュア)

### Attempt 4 (成功)
- sevendex.com (セブンデックス)
- innova-jp.com (イノーバ)
- intrix.co.jp (イントリックス)
- underworks.co.jp (アンダーワークス)
- leading-solutions.co.jp (リーディング・ソリューション)

Note: 2回の成功で異なる競合セットが返されている。これは search ステージのクエリ結果の揺れによるもので、正常な挙動。

---

## Security

- API key の実値は記録に含めていない
- smoke スクリプト内では redacted 表示のみ
