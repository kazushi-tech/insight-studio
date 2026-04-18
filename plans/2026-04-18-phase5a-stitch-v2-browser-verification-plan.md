# 🌿 Phase 5A: Stitch 2.0 v2 ブラウザ実証プラン

**作成日**: 2026-04-18
**作成者**: Claude（Opus 4.7、本セッション）
**プロジェクトオーナー**: 不二樹
**前身プラン**: origin/master の `plans/claude-html-markdown-claude-claude-jolly-kay.md`（405行、Phase 1-4 完了済）
**本プランの射程**: PR #40 (`ac6bd5d`) マージ後の v2 ブラウザ実証・検証

---

## 1. Context（なぜ今やるか）

### 1-1. 既完了（確認済）
| Phase | 内容 | 結果 |
|---|---|---|
| Phase 1 | 本番デプロイ確認、`?ui` flag 動作の健全性 | ✅ 実施済（Render deploy live、envelope エンドポイント疎通） |
| Phase 2 | `DETERMINISTIC_STUB_ENABLED=true` 設定 | ✅ 2026-04-18 20:09 PM Environment updated |
| Phase 3 | v1 軽量改善（Radar truncate, Matrix ▲＝▼） | ✅ PR #40 でマージ |
| Phase 4 | Stitch 2.0 v2 scaffold（18新規 + 4修正、148/148 テスト緑） | ✅ PR #40 (ac6bd5d) マージ |

### 1-2. 未完了（本プラン対象）
**Phase 5A: ブラウザ実証**（v2 はテスト緑だが、**実ブラウザでの目視・挙動確認未実施**）

### 1-3. 副次的に残る軽微事項（Phase 5A で発覚したら対応、そうでなければ後送り）
| # | 内容 | 優先度 |
|---|---|---|
| 1 | 本番警告率の数値化（5-10件の section_audit 集計） | 🟡 あれば嬉しい |
| 2 | MarketRangeV2 の軸スケール（metric 横断比較） | 🟢 UX 改善余地 |
| 3 | BrandRadarV2 の同名ブランド ID 衝突対策 | 🟢 低確率 |
| 4 | Manrope / Inter フォント index.html link | 🟢 未検証 |

### 1-4. 想定される成果
- `?ui=v2` が Discovery / Compare 両方で正常描画されることを実測
- envelope あり / なし パターン両方で MD fallback が動作することを確認
- Print PDF v1/v2 両方で A4 崩れなし
- レスポンシブ（1024/1280/1440px）で崩れなし
- console / network エラーゼロ
- v2 デフォルト昇格の根拠を獲得（または、必要な追加対応の特定）

---

## 2. 事前準備（10分）

### 2-1. ローカル最新化
```bash
git pull origin master              # ac6bd5d を取り込む
cd "c:/Users/PEM N-266/work/insight-studio"
npm install                          # v2 新規依存なし想定だが念のため
```

### 2-2. webapp-testing skill 初回セットアップ
```bash
pip install playwright
python -m playwright install chromium
```

### 2-3. Dev server 起動確認
```bash
npm run dev  # port 3002
# または
./dev.ps1    # 全サービス一括
```

---

## 3. Phase 5A 本体（0.5日、skill: webapp-testing）

### 3-1. 検証パターン一覧（6パターン）

| # | URL パターン | 目的 |
|---|---|---|
| A | `?ui=v1` Discovery（既存ケース） | v1 回帰なし確認 |
| B | `?ui=v2` Discovery（envelope あり想定） | v2 新UI 正常描画 |
| C | `?ui=v2` Discovery（envelope null） | MD fallback 動作 |
| D | `?ui=v1` Compare | v1 回帰なし確認 |
| E | `?ui=v2` Compare | v2 新UI 正常描画 |
| F | `?ui=v2` → UiVersionToggle 操作 | localStorage / URL 同期 |

### 3-2. 各パターンの確認項目

**共通（全パターン）**:
- [ ] ページロード成功（HTTP 200）
- [ ] `page.on('console', ...)` エラーゼロ
- [ ] `page.on('pageerror', ...)` ゼロ
- [ ] ネットワークエラー（failed request）ゼロ
- [ ] `domcontentloaded` 到達

**v1 (A, D)**:
- [ ] 既存 `PriorityActionHero` / `CompetitorMatrix` / `BrandRadarChart` / `MarketRangeBar` レンダ
- [ ] Phase 3改善: Radar軸ラベル長い場合は省略+tooltip、短い場合はそのまま
- [ ] Phase 3改善: Matrix セルに ▲/＝/▼ 記号併記

**v2 (B, C, E)**:
- [ ] `<div class="ui-v2">` ルート存在
- [ ] `PriorityActionHeroV2` / `CompetitorMatrixV2` / `BrandRadarV2` / `MarketRangeV2` / `ConfidencePill` レンダ
- [ ] MD3 トークン適用（Botanical Green 準拠、font-family Manrope）
- [ ] `md-v2-enter` フェードインアニメ動作
- [ ] Chart.js defaults が v2 向け（emphasized easing）

**envelope あり/なし (B vs C, E)**:
- [ ] envelope あり: envelope データが表示される（`priority_actions[]` / `brand_evaluations[]` / `market_estimate`）
- [ ] envelope null: MD fallback で同等表示（brandEvalParser 経由）

**UiVersionToggle (F)**:
- [ ] v1→v2 切替で URL に `?ui=v2` 付与
- [ ] localStorage に `reportUiVersion=v2` 保存
- [ ] リロード後も v2 維持
- [ ] popstate（戻るボタン）で version 再解決
- [ ] v2→v1 復帰で URL 除去

### 3-3. Print PDF 検証

```python
# webapp-testing skill 内で
page.emulate_media(media='print')
page.pdf(path='/tmp/v1_discovery_print.pdf', format='A4', print_background=True)
```

- [ ] v1 Discovery Print PDF: セクション切れなし、`break-inside: avoid` 効く
- [ ] v2 Discovery Print PDF: `printRoot` scope で A4 縦、背景白、文字黒
- [ ] `print:hidden` 要素（UiVersionToggle 等）非表示

### 3-4. レスポンシブ確認

| viewport | 確認事項 |
|---|---|
| 1440×900 | デスクトップ通常、全要素フル幅 |
| 1280×720 | Matrix横スクロール出現点、Radar 凡例幅 |
| 1024×768 | モバイル未対応でも致命崩れなし（PC 専用方針ゆえ許容） |

- [ ] Radar: `ctx.chart.width < 420` で軸ラベル font-size 10 に落ちる
- [ ] Matrix: `overflow-x: auto` で水平スクロール可能

### 3-5. 調査対象の本番 URL

| 環境 | URL |
|---|---|
| Vercel 本番 | `https://insight-studio-chi.vercel.app/?ui=v2` |
| ローカル dev | `http://localhost:3002/?ui=v2` |

既存の `search_id=a03bc0f98cfa`（カメラの大林）レポートを v2 で開いて描画確認するのが最も再現性が高い。

---

## 4. 検出時の対処

### 4-1. Critical（リリース撤回レベル）
- v2 で白画面 / JS エラー
- v1 で回帰（Phase 3 改善が v1 を壊した）
- envelope fetch 無限ループ

対処: **即座に別 PR で修正、v2 opt-in は継続**

### 4-2. High（v2 デフォルト昇格を止めるレベル）
- レイアウト破綻（カード重なり、Matrix 横スクロール壊れ）
- Chart.js v2 defaults が v1 に漏れる（snapshot/restore バグ）
- Print PDF で v2 セクション切れ

対処: 本 Phase の Gate 未達扱い、修正 PR 発行

### 4-3. Medium（軽微、TODO 化で可）
- MarketRangeV2 軸スケール違和感
- BrandRadarV2 同名ブランド衝突
- Manrope フォント未ロード（fallback で表示自体は OK）

対処: Phase 5A 報告書に記録、別プランで消化

---

## 5. 成果物

### 5-1. 検証レポート
- `plans/2026-04-18-phase5a-verification-result.md` を作成
- 6パターン × 確認項目のチェックリスト
- スクショ or Playwright trace（`webapp-testing/output/` 配下）
- 発見した issue の分類（Critical / High / Medium）

### 5-2. 追加タスク（あれば）
- Medium 以下は `plans/2026-04-19-v2-polish-plan.md` に集約
- Critical/High は即座に修正 PR 発行

---

## 6. Gate（Phase 5A 完了条件）

- [ ] 6パターン全て検証、Critical / High ゼロ
- [ ] Print PDF v1/v2 両方合格
- [ ] レスポンシブ 1440/1280 で崩れなし
- [ ] 検証レポート作成完了
- [ ] 不二樹に結果報告

### Gate クリア後の次の一手（3択）
1. **v2 デフォルト昇格** → [useUiVersion.js:12](src/hooks/useUiVersion.js#L12) の `DEFAULT` を `'v2'` に変更（別PR）
2. **Medium 修正 PR** → MarketRangeV2 軸スケール / フォント link 等を集約
3. **別機能着手** → v2 は opt-in のまま、次の機能要件へ

不二樹の判断を仰ぐ。

---

## 7. 厳守ルール（リマインダ）

- ❌ **@playwright/test など npm 依存追加禁止** — webapp-testing skill（Python + Playwright sync API）を使う
- ❌ **許可を求めず自律実行** — `feedback_no_confirmation`
- ❌ **タイムアウト値を増やさない** — `feedback_never_increase_timeouts`、失敗したら根本原因を探す
- ❌ **表面対応禁止** — v2 で白画面なら根本原因追跡
- ✅ **ゲストモード（クリーンなlocalStorage）で Chrome を起動** — `devtools-verify` skill ルール
- ✅ **Vercel + Render 両方の稼働確認** — `feedback_verify_full_deploy`

---

## 8. Skills / Tools マップ

| 工程 | skill/tool | 用途 |
|---|---|---|
| Dev server 起動 | webapp-testing の `scripts/with_server.py` | `npm run dev` を管理 |
| ブラウザ操作 | webapp-testing の Playwright sync API | URL遷移・クリック・検証 |
| v2 デザイン準拠確認 | ui-design-review skill | Botanical/Manrope/16px 確認 |
| 発見バグ修正 PR | quick-git skill | 小PR即発行 |
| 昇格 PR（任意） | codex-review (Diff+Release) | 最終品質ゲート |

---

## 9. 重要ファイル（読み取り主）

- [src/hooks/useUiVersion.js](src/hooks/useUiVersion.js) — フラグ解決ロジック
- [src/components/report/v2/ReportViewV2.jsx](src/components/report/v2/ReportViewV2.jsx) — v2 合成ルート
- [src/components/report/v2/tokens.css](src/components/report/v2/tokens.css) — MD3 トークン
- [src/components/report/v2/reportThemeV2.js](src/components/report/v2/reportThemeV2.js) — Chart.js defaults snapshot/restore
- [src/pages/Discovery.jsx](src/pages/Discovery.jsx) — v1/v2 分岐箇所 (L964-968 付近)
- [src/pages/Compare.jsx](src/pages/Compare.jsx) — 同 (L718-723 付近)
- [src/components/report/brandEvalParser.js](src/components/report/brandEvalParser.js) — v2 MD fallback で共用

---

## 10. 工数見積

- 事前準備: 10分
- Phase 5A 本体: 3〜4時間（6パターン × 確認項目）
- 発見 Medium 修正（あれば）: 1〜2時間
- 検証レポート作成: 30分
- **合計**: 0.5日（4〜6時間）

---

## 11. 非ゴール（本プランで触らない）

- v2 デフォルト昇格（Gate クリア後の別タスク）
- バックエンド変更（Track A 追加対応は別プラン）
- v2 新規コンポーネント追加（EvidenceDetail v2 等）
- モバイル対応（PC 専用方針維持）
- Compare の実行プラン欠損対応（現状機能中）

---

**不二樹への確認事項**:
1. ローカル未pull の 11 commits（ノイズ）は本 Phase で整理するか、別途対応か
2. Phase 5A 開始前に不二樹のブラウザで簡単な `?ui=v2` 目視確認もあり？
3. 本番 Vercel で直接 `?ui=v2` 検証も含めるか（実運用近い）

---

**本プランは「PR #40 の実装品質を実ブラウザで確定させ、v2 デフォルト昇格の根拠を得る」こと一点に絞るぞよ♡**
