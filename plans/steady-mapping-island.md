# LP比較・競合分析レポート 品質・UX改善プラン

**作成日**: 2026-04-22  
**対象**: Market Lens AI — LP比較・競合分析（`/compare` ページ、`POST /api/scan` パイプライン）

---

## Context

### なぜ改修するか

現状の LP比較・競合分析レポートには、広告運用プロ視点で次の課題がある：

1. **UX課題**：目次がクリックできず、長大レポート（10セクション以上）内のナビゲーションが困難
2. **パフォーマンス課題**：処理時間が 8分3秒 かかっており、ユーザーは5分以内を期待している
3. **レポート品質課題**：市場推定データが全項目 `low` 信頼度にもかかわらず目立つ表として提示され、ノイズ感を生んでいる／予算レンジが60倍幅（40万〜2,400万円）で意思決定に使えない

### 何を変えるか

1. **v2 UI をデフォルト昇格**：v2 にはすでに sticky TOC とセクション折り畳みの部分実装がある。`MarkdownRenderer` の heading ID 不整合を直して v2 をデフォルトにする
2. **Compare パイプラインのクロール並列化**：`scan_service.py` のクロールが直列 `for` ループになっているので `asyncio.gather()` で並列化する（品質影響なし）
3. **市場データ表・予算レンジのレポート品質改善**：`low` 信頼度時の表示ロジック改善・予算レンジの3段階化

---

## 設計判断（Phase 3 で固めた方針）

- **UI 方針**: 「v2 をデフォルトに昇格」（ユーザー選択）— v1 は互換目的で残しトグル可能のまま
- **パフォーマンス方針**: 「品質維持しつつ並列化のみ」（ユーザー選択）— LLM モデル・プロンプトは変更しない。目標短縮: 60〜90秒
- **スコープ外**: Haiku フォールバック化、Playwright 動的レンダリング、AB テスト機能

---

## 実装タスク

### [T1] Heading ID の安定化（P0, UX 基盤）

**問題**: [MarkdownRenderer.jsx:328](src/components/MarkdownRenderer.jsx#L328) の `makeHeadingId` がランダム4文字サフィックスを付与しており、TOC の slug とアンカーが一致しない。

**変更内容**:
- `makeHeadingId` をランダムサフィックスなしの純粋 slug に変更
- 重複回避は「同一ページ内で既出の slug にはインクリメンタル番号を付与」方式（例: `toc-executive-summary`, `toc-executive-summary-2`）
- [src/components/report/v2/ReportViewV2.jsx:23](src/components/report/v2/ReportViewV2.jsx#L23) の `extractHeadings` 内 slug ロジックを `makeHeadingId` と同じ関数を import して使うよう統一

**ファイル**:
- [src/components/MarkdownRenderer.jsx:328-331](src/components/MarkdownRenderer.jsx#L328-L331)（`makeHeadingId` を書き換え、export する）
- [src/components/report/v2/ReportViewV2.jsx:13-23](src/components/report/v2/ReportViewV2.jsx#L13-L23)（`extractHeadings` で同じ slug を使う）

**検証**: v2 UI で TOC をクリック → 対応セクションへスムーズスクロール／複数同名見出しが現れても衝突しない／v1 の既存スナップショットテストが壊れないこと

---

### [T2] v2 UI をデフォルトに昇格（P0）

**問題**: 現状 `useUiVersion` フックが v1 をデフォルトにしており、sticky TOC を備えた v2 が隠れている。

**変更内容**:
- `useUiVersion` のデフォルト値を v1 → v2 に変更
- `UiVersionToggle` は残して、オペレーターが v1 に戻せる状態を維持
- v2 のみにある機能で v1 にも必要なものがあれば、この機会に v2 の実装を backport するのではなく、v2 を改善する方向で統一

**ファイル**:
- [src/hooks/useUiVersion.js](src/hooks/useUiVersion.js)（デフォルト値変更）
- [src/components/report/v2/UiVersionToggle.jsx](src/components/report/v2/UiVersionToggle.jsx)（表示ラベル確認）

**検証**: `/compare` を開く → デフォルトで v2 が表示される／トグルで v1 へ切替可能／localStorage で選択記憶される

---

### [T3] Compare パイプラインのクロール並列化（P0, Performance）

**問題**: [scan_service.py:79](backends/market-lens-ai/web/app/services/scan_service.py#L79) で 3 URL を `for i, url in enumerate(req.urls):` で直列クロールしており、`POLITE_DELAY_SEC` も各 URL 間で挟んでいる。

**変更内容**:
- 3 URL のクロール（`fetch_html` + `extract` + `take_screenshot`）を `asyncio.gather()` で並列実行
- `POLITE_DELAY_SEC` は並列化後は不要（異なるホストへの並列リクエストで礼儀違反にならない）
- エラーハンドリングは `return_exceptions=True` で個別 URL 失敗に対応
- ログは各 URL の所要時間を `_log_stage` 相当のフォーマットで記録

**削減見込み**: 現状クロール部分が 3 × (fetch + extract + screenshot) を直列 → 並列化で最遅 URL 1 本分に圧縮。`POLITE_DELAY_SEC` 撤廃で数秒追加削減。**合計 60〜90 秒短縮見込み**。

**ファイル**:
- [backends/market-lens-ai/web/app/services/scan_service.py:72-102](backends/market-lens-ai/web/app/services/scan_service.py#L72-L102)（`execute_scan` のクロールループを並列化）

**既存パターンの再利用**:
- Discovery パイプラインが同種の並列化を [discovery_pipeline.py:741](backends/market-lens-ai/web/app/services/discovery/discovery_pipeline.py#L741) で実装済み（`asyncio.gather` + `Semaphore(5)` + backfill L757）。この実装を参考にする

**検証**: 
- `cd backends/market-lens-ai && python -m pytest tests/ -k scan`
- ステージング環境で 3 URL の Compare を実行し、処理時間がログ上で 60秒以上短縮していることを確認

---

### [T4] 市場データ表の折り畳み化（P1, 品質）

**問題**: Section 3-1 の市場概況テーブル（日本市場規模・成長率等）が全項目 `low` 信頼度にもかかわらず目立つ表として表示され、レポート全体の信頼性を損なう。

**変更内容**:
- MarkdownRenderer のテーブルレンダラで、テーブル全体の信頼度判定を行う
- 全行が `low` 信頼度（「業界不明時のフォールバック値」等の文言で判定）の場合、`<details>` 折り畳みにラップする
- `<summary>` には「市場データは業界標準値（信頼度：low）。実運用データ取得後に更新推奨。参考値として表示する ∨」という注記を表示

**既存パターンの再利用**:
- [MarkdownRenderer.jsx:570-699](src/components/MarkdownRenderer.jsx#L570-L699) の table pipeline に判定ロジックを追加
- `<details>` 折り畳みパターンは [Compare.jsx:790](src/pages/Compare.jsx#L790)（Appendix）で既に使用中

**ファイル**:
- [src/components/MarkdownRenderer.jsx:570-699](src/components/MarkdownRenderer.jsx#L570-L699)（discovery variant のテーブルレンダラ拡張）

**検証**: v2 UI で表示時、市場概況テーブルがデフォルト折り畳み状態になる／クリックで展開／他のテーブル（競合比較サマリー等）は影響を受けない

---

### [T5] 予算レンジの3段階化（P1, 品質）

**問題**: 5-0 予算フレームの月額予算帯が `40万〜2,400万円/月` と60倍幅で、意思決定に使えない。

**変更内容**:
- `market_estimator` の予算レンジ計算ロジックを、初期・拡張の2段階から「スモールスタート／標準／アグレッシブ」の3段階に変更
- 各段階の CV 数レンジも併記

**ファイル**:
- [backends/market-lens-ai/web/app/market_estimator/estimator.py:143](backends/market-lens-ai/web/app/market_estimator/estimator.py#L143)（`estimate()` の出力構造を拡張）
- [backends/market-lens-ai/web/app/market_estimator/industry_priors.yaml](backends/market-lens-ai/web/app/market_estimator/industry_priors.yaml)（必要に応じて段階別レンジを定義）
- プロンプトテンプレート側で予算フレームブロックの表示形式を更新（`format_market_estimate_block` 参照）

**検証**: サンプルブランドで `/api/scan` を実行 → 5-0 予算フレームに3段階が表示される／既存の単体テストが通る（`tests/market_estimator/`）

---

### [T6] Stitch2 向け追加 UI ポリッシュプロンプト（P2, 補助）

以下は実装後に Stitch2 で微調整する場合のプロンプト。コード変更は伴わない。

```
LP比較・競合分析レポートページ（/compare、v2 UI）をさらに洗練してください。

【評価保留の視覚処理】
hero_copyが取得不可のブランドには、ブランド別評価セクションのヘッダーに「⚠ 一部データ未取得」バッジを accent-gold (#D4A843) で表示。評価保留の表セルは背景を surface-container (薄いグレー) で塗る。

【目次の折り畳み】
スティッキー TOC の上部に「≡ 折り畳む」ボタンを追加。クリックで TOC がページ右端にタブ状に最小化され、再度クリックで展開できるようにする。

デザインは Botanical Green (#003925)、warm off-white (#fafaf5)、Manrope フォント、border-radius 16px のデザインシステムに従う。
```

---

## 実装順序

```
Week 1:
  ├── [T1] Heading ID 安定化（半日）
  ├── [T2] v2 デフォルト昇格（半日）
  └── [T3] クロール並列化（1日）

Week 2:
  ├── [T4] 市場データ表の折り畳み化（半日）
  └── [T5] 予算レンジ3段階化（1〜2日、プロンプト調整含む）

後続（任意）:
  └── [T6] Stitch2 UI ポリッシュ
```

---

## 検証計画（End-to-end）

### バックエンド
```bash
cd backends/market-lens-ai
python -m pytest tests/ -k "scan or market_estimator"
```

### フロントエンド
```bash
npm run build      # 型・ビルド確認
# webapp-testing skill で /compare ページを開き、以下を確認：
#  1. デフォルトで v2 UI が表示される
#  2. スティッキー TOC が右側に固定表示される
#  3. TOC の各項目をクリック → 対応セクションへスムーススクロール
#  4. 市場概況テーブルがデフォルト折り畳み状態
#  5. 5-0 予算フレームに3段階（スモールスタート／標準／アグレッシブ）が表示される
#  6. UiVersionToggle で v1 に戻せる
```

### 統合テスト（ステージング）
- Render staging 環境の `market-lens-staging` に deploy
- 実際の 3 URL で `/compare` を実行
- 処理時間が **60秒以上短縮** していることを Run メタデータのタイムスタンプで確認（目標: 8分3秒 → 6分30秒〜7分）

### 目標未達の場合のフォールバック
並列化だけでは5分以内に届かない場合は、別プランで以下を検討（今回スコープ外）：
- 初回 LLM 呼び出しを Haiku に変更
- プロンプト短縮
- スクリーンショット撮影のスキップオプション

---

## 影響範囲まとめ

| ファイル | 変更種別 | リスク |
|---------|---------|-------|
| [src/components/MarkdownRenderer.jsx](src/components/MarkdownRenderer.jsx) | heading ID / テーブルレンダラ | 既存スナップショットテストの更新が必要 |
| [src/components/report/v2/ReportViewV2.jsx](src/components/report/v2/ReportViewV2.jsx) | slug ロジック統一 | 低（import 追加のみ） |
| [src/hooks/useUiVersion.js](src/hooks/useUiVersion.js) | デフォルト値変更 | 低（localStorage 未設定ユーザーは v2 に移行） |
| [backends/market-lens-ai/web/app/services/scan_service.py](backends/market-lens-ai/web/app/services/scan_service.py) | クロール並列化 | 中（同時接続数増で rate limit 注意） |
| [backends/market-lens-ai/web/app/market_estimator/estimator.py](backends/market-lens-ai/web/app/market_estimator/estimator.py) | 予算レンジ拡張 | 低（単体テストでカバー） |

---

## 非対応事項（今回スコープ外）

- モバイル対応（PC専用仕様）
- Playwright による動的レンダリングフォールバック
- Haiku フォールバック化
- AB テスト基盤
- Discovery パイプライン側の改修（別の `/api/discovery/jobs` 経路）
