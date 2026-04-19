# Phase 5C: `useUiVersion.DEFAULT` を `v1 → v2` に昇格する

**作成日**: 2026-04-19
**作成者**: Claude（Opus 4.7、Phase 5B Gate PASS を受けて起草）
**ベース**: Phase 5B fixture Gate PASS（`all_passed: true`、詳細は [plans/2026-04-18-phase5b-verification-result.md §8](2026-04-18-phase5b-verification-result.md)）
**対象スコープ**: 1 行の DEFAULT 切替、テスト期待値更新、リリース Gate と監視

---

## 1. Context（なぜ今進めるか）

- Phase 5B fixture E2E で Pattern L（envelope 経路）/ M（MD fallback 経路）いずれも PASS
- vitest は 153/153 緑、v2 コンポーネント単体動作は PR #40〜#43 で積み上げ済
- Phase 5A で empty-state の regression も PASS 済
- fixture では網羅できぬ分布を補うため、昇格後は監視強化フェーズを短期運用する

### 1-1. Gate PASS 抜粋（`verify_output/phase5b/summary.json`）

```
L_fixture_v2_envelope: passed=true, 5 components, console/page error 0
M_fixture_v2_md_fallback: passed=true, 5 components, console/page error 0
all_passed: true
```

### 1-2. 残っている空白

- **prod jobId E2E（G/H/J）**: Render `market-lens-ai` に永続ディスク未 attach、jobId ゼロ件のため skipped
- 補強: Render `disk:` ブロック追加後に本 harness を再走させる（別プラン）
- 昇格判定の正当性: vitest + fixture + Phase 5A empty-state の三点で v2 挙動を検証済み、かつ `?ui=v1` 即時ロールバックを残すため、許容されるリスク範囲と判断

---

## 2. 変更内容（超小粒）

### 2-1. コード変更

**[src/hooks/useUiVersion.js:13](../src/hooks/useUiVersion.js#L13)**

```diff
-const DEFAULT = 'v1'
+const DEFAULT = 'v2'
```

1 行のみ。URL query / localStorage の優先度は不変、`?ui=v1` で即時 v1 にロールバックできる。

### 2-2. テスト期待値更新

**[src/hooks/__tests__/useUiVersion.test.js](../src/hooks/__tests__/useUiVersion.test.js)**

- DEFAULT 参照テストを `'v1' → 'v2'` に更新
- URL query / localStorage の優先度テストは不変

### 2-3. ドキュメント / 運用メモ

- [CLAUDE.md](../CLAUDE.md) に「デフォルト v2、`?ui=v1` で v1 ロールバック」を短く追記（optional）
- `src/components/report/v2/UiVersionToggle.jsx` の UI 文言に現行値マーカーがあれば整える

---

## 3. リリース Gate（順番必達）

1. `npm test -- --run` → 153/153 緑
2. `npm run build` → warning なし
3. `python scripts/phase5b-verify.py` → **L / M 再実行 PASS**（DISCOVERY_SEARCH_ID なしでよい）
4. `vercel build` or `vercel deploy --prebuilt`（Preview） → SUCCESS
5. Preview URL で Discovery / Compare を各 1 ジョブ手動確認（不二樹）
6. `gh pr create` → master マージ
7. 本番 Vercel deploy SUCCESS を確認
8. 本番 URL で Discovery / Compare の既存レポート 1 件以上を不二樹が目視確認

### 3-1. 事前ブロッカー

| 項目 | 確認方法 |
|---|---|
| vitest 緑 | `npm test -- --run` |
| fixture E2E Gate | `python scripts/phase5b-verify.py` |
| Vercel preview build | PR を開いて SUCCESS 待ち |
| `?ui=v1` 即時ロールバック経路 | Preview URL で手動検証 |

---

## 4. ロールバック戦略（3 段階）

1. **即時（ユーザー単位）**: `?ui=v1` をクエリに付ける、または localStorage で `reportUiVersion=v1` セット
2. **軽度（git revert）**: 昇格コミット 1 つを revert → Vercel 自動 redeploy
3. **重度（Vercel rollback）**: Vercel Dashboard から直前デプロイに戻す

ロールバック基準: **24h 以内に console error / 5xx / 不二樹フィードバックで重大リグレッション判定**が出た場合、2 または 3 を即時実施。

---

## 5. 昇格後の監視（24-48h 強化期間）

### 5-1. 観測対象

- console error レポート（Sentry / Vercel Analytics）
- ネットワーク failed request（`/api/ml/discovery/jobs/.../report.json` 周辺）
- 不二樹からの UX 感想（Slack / 直接フィードバック）
- 既存 Discovery / Compare ユーザーの離脱率（Vercel Analytics）

### 5-2. 閾値

- console error が **5 件/h を超えたら** 即時 `?ui=v1` 周知 + 原因調査
- page render 失敗が観測されたら即時 rollback
- 不二樹が明示的に「v1 に戻して」と指示したら従う

---

## 6. 周知

### 6-1. 不二樹向け

- 昇格 PR link + Preview URL
- 監視期間とロールバック窓口の確認
- 「v2 がデフォルトになりました。`?ui=v1` で旧 UI に戻せます」

### 6-2. 社内（適宜）

- 影響: Discovery / Compare レポート表示の UI 更新
- ロールバック方法の一文

---

## 7. 限界の正直な開示

本プランでの Gate 根拠は **fixture + vitest + Phase 5A empty-state** の三点に立脚する。実ユーザーデータの全分布（特に envelope 欠損時の尖った MD 形式、極端に長い内容、大量ブランド案件）は fixture では網羅しきれぬ。

そのため：

1. Render 永続ディスク attach 後、prod jobId 経路 G / H / J を別プランで再走させる
2. 監視期間を通常より強めに取る（§5）
3. `?ui=v1` ロールバック経路を UI / ドキュメントで周知する

この 3 点を昇格 PR 本文に明記する。

---

## 8. 非ゴール（本セッションで触らない）

- 永続ディスク attach（別プラン、追加課金）
- 新規 Discovery ジョブ実行（LLM コスト）
- Compare 側 debug route 対応
- v1 コードの削除（昇格後 1-2 週間の観測期間を経て別 PR）
- モバイル対応
- Gemini 切替
- タイムアウト値増加

---

## 9. 想定所要時間

| セクション | 推定 |
|---|---|
| DEFAULT 切替 + テスト更新 | 10 分 |
| Gate 実行（vitest / build / harness） | 15 分 |
| PR 作成 + Preview 確認 | 15 分 |
| マージ + 本番 deploy 確認 | 15 分 |
| 監視（受動、24-48h） | — |
| **合計（能動時間）** | **〜1 時間** |

---

## 10. 参考

- [plans/2026-04-18-phase5b-verification-result.md §8](2026-04-18-phase5b-verification-result.md) — fixture Gate PASS 記録
- [plans/2026-04-19-phase5b-jobid-hunt-result.md](2026-04-19-phase5b-jobid-hunt-result.md) — 永続ディスク未 attach 判明
- [src/hooks/useUiVersion.js](../src/hooks/useUiVersion.js) — 昇格対象
- [src/components/report/v2/ReportViewV2.jsx](../src/components/report/v2/ReportViewV2.jsx) — 昇格先コンポーネント
