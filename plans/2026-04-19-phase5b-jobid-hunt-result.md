# 🌿 Phase 5B: 有効 jobId 調達（永続ディスク・ログ調査）実行結果

**実行日**: 2026-04-19
**実行者**: Claude (Opus 4.7, Auto mode)
**対応プラン**: [plans/2026-04-19-phase5b-jobid-hunt-plan.md](2026-04-19-phase5b-jobid-hunt-plan.md)
**ベースコミット**: `b012b20`（master, PR #43/#44 マージ後のマージコミット）
**Gate**: **Case B — 有効 jobId ゼロ件**（新規 Discovery 実行の承認リクエスト）

---

## 1. TL;DR

プラン §2 の戦略 A/B/D をすべて実行済じゃが、prod backend `market-lens-ai.onrender.com` 上に存在する有効な Discovery jobId は **0 件** じゃった。

**根本原因**: `market-lens-ai` サービスに **永続ディスクが 1 本も attach されとらぬ**。Render Dashboard / API ともに disks list が `[]` を返す。プラン §1-2 の「永続ディスクは Render 側で管理」という前提が誤り。過去 14 日分のログには完了済 Discovery が 25 件記録されとるが、2026-04-18T11:09 UTC の latest deploy でコンテナが入れ替わった時点で `data/discovery_jobs/` は全消去されておる。

従って **Phase 5C プラン起草は保留**、不二樹に新規ジョブ実行の承認リクエストを起票する。

---

## 2. 調査結果

### 2-1. 戦略 A — Render 永続ディスク閲覧（結論: blocker）

```
$ curl -sS -H "Authorization: Bearer $RENDER_KEY" \
    "https://api.render.com/v1/disks?serviceId=srv-d6v2odua2pns73aat9bg"
[]
```

- Render Disks API で `market-lens-ai` (srv-d6v2odua2pns73aat9bg) を照会 → **空配列**
- [render.yaml](../render.yaml) 上にも `disks:` ブロックなし（`envVars:` のみ）
- ディスク未 attach の場合、`data/discovery_jobs/` は **コンテナ ephemeral fs** に書かれるのみで、deploy 毎に消滅する
- Render Dashboard の "Shell" も `market-lens-ai` には付与されとらず（Starter plan 上の web service）

**結論**: Shell/Disks API のどちらからも永続ディスクを参照する術がない（そもそも存在せぬ）。プラン §1-2 および memory [project_market_lens_render_free.md](C:\Users\PEM N-266\.claude\projects\c--Users-PEM-N-266-work-insight-studio\memory\project_market_lens_render_free.md) に「永続ディスク」前提があったが、実態と乖離しとる。

### 2-2. 戦略 B — Render ログから完了 jobId を抽出 + 疎通確認

過去 14 日（2026-04-05 〜 2026-04-19）に対して `discovery_pipeline_complete` を grep:

```
$ curl -sS -G -H "Authorization: Bearer $RENDER_KEY" \
    "https://api.render.com/v1/logs" \
    --data-urlencode "ownerId=tea-d5iqk1ur433s738milq0" \
    --data-urlencode "resource=srv-d6v2odua2pns73aat9bg" \
    --data-urlencode "startTime=2026-04-05T01:09:27Z" \
    --data-urlencode "endTime=2026-04-19T01:09:27Z" \
    --data-urlencode "text=discovery_pipeline_complete" \
    --data-urlencode "limit=200"
```

→ **25 件ヒット**。時系列順（抜粋）:

| timestamp (UTC) | jobId | brand | total_ms |
|---|---|---|---|
| 2026-04-13 06:40 | `aa4f3bce4f34` | saurusjapan.com | 345002 |
| 2026-04-13 07:31 | `55e9e5449b3b` | saurusjapan.com | 301970 |
| ... (中略 21 件) ... |  |  |  |
| 2026-04-17 01:06 | `13660f056765` | saurusjapan.com | 135637 |
| 2026-04-18 03:22 | `9a8187b8d5c0` | camera-no-ohbayashi.co.jp | 143917 |
| 2026-04-18 08:21 | `442404c0b222` | camera-no-ohbayashi.co.jp | 142960 |

25 件全てを `GET /api/ml/discovery/jobs/<id>` で疎通確認:

```python
for jid in ids:
    r = urllib.request.urlopen(f"https://market-lens-ai.onrender.com/api/ml/discovery/jobs/{jid}")
# 全 ID で http=404, detail="Job not found."
```

→ **25/25 が 404**。

### 2-3. 根本原因 — deploy 履歴との突合

```
$ curl -sS -H "Authorization: Bearer $RENDER_KEY" \
    "https://api.render.com/v1/services/srv-d6v2odua2pns73aat9bg/deploys?limit=10"
```

最新の live deploy: `dep-d7hmd17aqgkc739dle9g` / **2026-04-18T11:09:56Z** / commit `fix: Discovery schema contract + brand visualization 3-brand` (PR #39 相当)。

これ以降（2026-04-18 11:09 UTC 〜 2026-04-19 01:14 UTC = 約 14 時間）のログ範囲で `discovery_pipeline_complete` を再探索:

```
$ curl -sS -G ... --data-urlencode "startTime=2026-04-18T11:15:00Z" ...
{"logs": [], "count": 0}
```

→ **deploy 後に完了した Discovery ジョブは 0 件**。つまり latest deploy 時点でコンテナ fs が入れ替わり、それ以前の 25 件は全消去。以降は新規ジョブが走っとらぬため回収不能じゃ。

加えて latest deploy の commit は **PR #39**（648adfe）相当で、現状 master HEAD (`21bb7e5` = PR #44 + merge `b012b20`) より 5 PR 分古い。Render の auto-deploy がやはり失効しとる（memory [reference_render_service.md](C:\Users\PEM N-266\.claude\projects\c--Users-PEM-N-266-work-insight-studio\memory\reference_render_service.md) の注記通り）。

### 2-4. 戦略 C — 本番 UI からの拾い

本セッションは自律実行ゆえ、不二樹ブラウザの `localStorage` / Discovery 履歴 UI は未参照。仮に回収できても、Playwright harness は `/debug/report-v2?jobId=<id>` 経由の hydrate を前提としとるため、ブラウザに残っとる `run.result` を再現するには別途 store restore 機構が要る（プラン §2-3 の注記通り、スコープ外）。

### 2-5. 戦略 D — 過去プランから ID 発掘

プラン §2-4 で明言されとる通り、plans/ 配下で発掘されとる 12 桁 hex は `a03bc0f98cfa` のみ（これも 404 確認済、PR #44 result §2 参照）。**空振り確定**。

---

## 3. プラン §4 — harness 再実行

**未実施**。`DISCOVERY_SEARCH_ID` に入れられる有効 ID が 0 件のため、`python scripts/phase5b-verify.py` 実行は保留。

---

## 4. Gate 判定 — Case B 発動

プラン §5-3 のフロー（「有効 jobId が 1 件も見つからない時」）に従い、以下を実施:

- ✅ 調査結果を本ファイルに記録
- ✅ 永続ディスク ls は取得不能（ディスク未 attach）→ その旨明記
- ⏳ 不二樹への承認リクエスト → 本ファイル §5

Phase 5C プラン起草は保留、コード変更なし。

---

## 5. 不二樹への承認リクエスト（Case B テンプレ）

> ## Phase 5B Gate — jobId 調達できず
>
> - 調査結果: 戦略 A/B/D 全実行 → Render 永続ディスク **未 attach**（api disks list `[]`）
>   であり、過去ログから抽出した 25 件の完了 jobId は 2026-04-18T11:09 UTC の
>   latest deploy（PR #39 相当）でコンテナ fs と一緒に全消去されとる。以降 14 時間の
>   新規完了 Discovery は 0 件じゃ。
> - 提案 1（即時・コスト承認要）: **新規 Discovery ジョブ 1 件** を staging/prod backend で実行し jobId 採取
>   - 実行候補 URL: `https://camera-no-ohbayashi.co.jp/`（過去に 3 回完了実績あり、plan §5-3 準拠）
>   - 想定コスト: Anthropic API 1 回分（概算 $0.5〜$1）
>   - 承認後は別セッションで新規実行 → 即 harness 再実行へ
> - 提案 2（構造改善・中長期）: `market-lens-ai` サービスに Render 永続ディスク
>   (1GB〜、mount `/opt/render/project/src/data`) を attach し `render.yaml` に
>   `disks:` ブロック追加。これで今後 jobId が deploy を跨いで生存する。
>   - cost: Starter Persistent Disk は $0.25/GB/mo（1GB なら月 $0.25）
> - 詳細: `plans/2026-04-19-phase5b-jobid-hunt-result.md`

---

## 6. 次のアクション（不二樹判断待ち）

| 選択肢 | 担当 | 所要 |
|---|---|---|
| **新規 Discovery 1 件実行を承認** | 不二樹 → 別セッション | 数分〜5 分 |
| **`render.yaml` に永続ディスク追加 PR を起票** | 別セッション（別プラン） | 30-60 分 |
| **両方** | 上記併用 | 同上 |
| **Phase 5C を v2 メンテ状態のまま棚上げ** | 不二樹 | — |

本セッションでは上記いずれも実行せず、承認待ちで停止する。

---

## 7. 調査過程で拾った派生トピック（参考情報、Phase 5B 対象外）

- **render.yaml の REPOSITORY_BACKEND=db**: scan/asset/review は DB バッキング済じゃが、Discovery は `FileDiscoveryJobRepository()` を無条件 new しとる ([backends/market-lens-ai/web/app/main.py:249](../backends/market-lens-ai/web/app/main.py#L249))。永続ディスク未 attach 状態では deploy 毎にジョブ消滅 → UX 悪化（履歴 UI が空になる、active polling が orphan 化）。別チケットで改善余地あり。
- **latest live deploy が PR #39 止まり**: master には PR #44 が入っとるが、Render は PR #39 相当で動作。`reference_render_service.md` の注記通り、本番反映には手動 `POST /v1/services/.../deploys` が必要じゃ。

---

## 8. 本ファイルの位置づけ

プラン §6「新規作成（条件付き）— jobId ゼロ件時のみ」に該当し、§1 Critical Files の通り **コード変更なし・ドキュメント追加のみ** とする。

---

**本セッションの成果**: 調査結果ドキュメント 1 本（この文書）のみ。プラン §7 の運用ルール全遵守（新規ジョブ未実行・Render env-var 未変更・destructive 操作ゼロ）。
