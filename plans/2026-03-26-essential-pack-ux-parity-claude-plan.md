# Insight Studio — Essential Pack UX Parity Claude Execution Plan

**作成日:** 2026-03-26  
**対象リポジトリ:** `c:\Users\PEM N-266\work\insight-studio`  
**reference repo:** `tmp_ads_insights_repo/` (`https://github.com/kazushi-tech/ads-insights`)  
**対象画面:** `/ads/pack`  
**目的:** 現在の `Insight Studio` の `要点パック` を、`ads-insights` 本家の **期間プルダウン / セクションアコーディオン / markdown table 表示 / 見切れないレイアウト** に実用レベルで近づける

---

## 1. 結論

Claude に投げるなら、**`ads-insights` の GitHub URL だけを渡すのでは足りない**。

理由:

- 直す対象は `Insight Studio` 側の React 実装
- parity の source of truth は `ads-insights` repo と live UI の両方
- したがって Claude は
  - `insight-studio` の作業対象コード
  - `tmp_ads_insights_repo/` の reference 実装
  - 現在画面と理想画面のスクリーンショット
  を同時に見られる状態で動かす必要がある

最適な投げ先:

1. **VSCode / Claude Code を `insight-studio` workspace で開く**
2. 同 workspace から `tmp_ads_insights_repo/` を参照可能にする
3. この plan とスクリーンショットを添えて実行する

つまり:

**投げる場所は `考察スタジオ本家の repo 単独` ではなく、`Insight Studio 側 workspace` が正解。`ads-insights` repo は reference として読ませる。**

---

## 2. 現在のズレ

### 2.1 現在の `Insight Studio`

確認ファイル:

- `src/pages/EssentialPack.jsx`
- `src/components/MarkdownRenderer.jsx`
- `src/utils/adsReports.js`

把握できた差分:

- 左カラムは固定表示で、**期間選択がボタン列**
- `report_md` 全体を **単一カードに縦展開**
- 見出し nav はあるが、**クリック移動や開閉制御がない**
- `periodReports` を複数結合すると `# {period}` を前置した単純連結
- markdown table は描画しているが、
  - `<table className="w-full">`
  - `td` が `whitespace-pre-wrap`
  なので、**長い列が圧縮されやすく、本家のような横スクロール前提の table になっていない**

### 2.2 `ads-insights` 本家

確認ファイル:

- `tmp_ads_insights_repo/index.html`

把握できた構造:

- `PointPackTabContent`
  - 期間プルダウンあり
  - セクション一覧あり
  - `全て開く / 全て閉じる` あり
  - h1 単位で split して **accordion 表示**
- `MarkdownDiv` / `renderMarkdown`
  - `<table>` を `<div class="table-wrapper">` でラップ
  - `.md-area table` は `width: max-content; min-width: 100%; table-layout: auto`
  - `th/td` は基本 `white-space: nowrap`
  - 長い 1 列目は hover 時のみ展開
- `tab-content-pp`
  - main + sticky TOC の 2 カラム構成
  - コンテンツ幅も暴れにくい

---

## 3. 今回の本題

今回 Claude にやらせたいのは、単なる CSS 調整ではない。

必要なのは以下の 4 点をセットで揃えること:

1. **期間選択 UI を本家寄りにする**
2. **レポートを h1 セクション単位のアコーディオンにする**
3. **markdown table を本家相当の横スクロール前提に直す**
4. **全体レイアウトを「見切れない」構成に寄せる**

加えて、今回の再修正では以下を明示的に潰すこと:

5. **ページ全体の横スクロールを発生させない**
6. **TOC / セクション click で右に強制スクロールされる挙動を止める**
7. **table の列幅を本家より不自然に広げない**

---

## 4. 非交渉ルール

1. `ads-insights` repo を source of truth として扱うこと
2. `Insight Studio` の既存 API flow は壊さないこと
3. placeholder UI に戻さないこと
4. markdown を独自要約して情報を落とさないこと
5. table は情報欠落よりも **横スクロール許容** を優先すること
6. desktop だけでなく、狭幅時の崩れ方も確認すること

---

## 5. 変更対象

### 主対象

- `src/pages/EssentialPack.jsx`
- `src/components/MarkdownRenderer.jsx`
- 必要なら `src/utils/adsReports.js`

### 参照対象

- `tmp_ads_insights_repo/index.html`

### 場合によって触る

- `src/components/Layout.jsx`
- global styles / Tailwind class 設計で共通化できる箇所

---

## 6. Claude に期待する具体的な成果物

### P0

- 左カラムの「表示期間」を **縦ボタン列から select dropdown** に変更、または本家と同等の compact selector に変更
- `currentReport` を h1 セクション単位で分割して **accordion 表示**
- `レポート構成` は単なる表示でなく、該当セクションへ移動できるようにする
- markdown table が横スクロールで閲覧でき、**セル潰れや見切れを減らす**
- **ブラウザ window 全体に horizontal scrollbar を出さない**
- **TOC click 後に viewport が右へ飛ばない**
- **table が wrapper 内だけで overflow し、main content 幅を押し広げない**

### P1

- `全て開く / 全て閉じる` を追加
- summary セクションのみ初期 open、または本家準拠の初期 open state を採用
- sticky な左ナビにする
- table 列幅をヘッダ名と内容に応じて再調整し、`whitespace-nowrap` を全セル一律に掛けない

### P2

- `npm run build`
- `npm run lint`
- local preview で目視確認

---

## 7. 推奨 Agent Team

Claude 側で agent team が使えるなら、以下の分担が一番安全。

### Lead / Integrator

責務:

- 全体方針の固定
- reference と target の差分判断
- file ownership 調整
- 最終 review

### Agent 1: Reference UI Auditor

責務:

- `tmp_ads_insights_repo/index.html` から point-pack 周辺の構造を抽出
- 以下を証跡付きでまとめる
  - 期間 selector
  - accordion 構造
  - TOC
  - markdown table CSS
  - responsive 条件

出力:

- `Insight Studio` へ移植すべき UI パターンの箇条書き

### Agent 2: Essential Pack Layout Worker

責務:

- `src/pages/EssentialPack.jsx` のレイアウト改修
- sticky sidebar
- dropdown 化
- section nav
- accordion 制御

担当ファイル:

- `src/pages/EssentialPack.jsx`

### Agent 3: Markdown Table Worker

責務:

- `src/components/MarkdownRenderer.jsx` の table 描画改善
- `table wrapper`
- page-level overflow を出さない width 制御
- 必要なら `max-content` をやめ、列ごとに wrap / clamp / min/max 幅を再設計
- long-text cell の扱い
- 必要なら `thead/tbody` class 改善
- TOC click 時の scroll と干渉しない overflow 制御

担当ファイル:

- `src/components/MarkdownRenderer.jsx`

### Agent 4: QA / Responsive Verifier

責務:

- build/lint
- desktop / narrow width の目視確認
- current screenshot と target screenshot の差分確認

---

## 8. 推奨 Skills

Claude 環境に skill 相当があるなら、以下の順で使う。

### 1. Repo Search / UI Audit

用途:

- `ads-insights` 本家の point-pack 構造把握
- 現在の `Insight Studio` 実装との差分抽出

### 2. Frontend React Integration

用途:

- `EssentialPack.jsx` の状態管理・accordion 実装
- 既存 state (`selectedPeriod`, `reportBundle`) を壊さず UI 差し替え

### 3. Markdown / Rendering Skill

用途:

- markdown table / headings / anchor 処理
- 横スクロールとセル幅制御

### 4. Visual QA / Responsive Verification

用途:

- desktop と狭幅のレイアウト確認
- 見切れ・圧縮・overflow の確認

### 5. Release Verification

用途:

- lint/build
- 必要なら local preview

---

## 9. 実装方針

### Workstream A: Reference 抽出

やること:

1. `tmp_ads_insights_repo/index.html` の以下を読む
   - `PointPackTabContent`
   - `renderMarkdown`
   - `MarkdownDiv`
   - `.tab-content-pp`
   - `.pp-toc`
   - `.md-area table`
2. parity に必要な最小要素だけを列挙する
3. 1:1 移植ではなく、React に自然な形へ再構成する

### Workstream B: Essential Pack レイアウト改修

やること:

1. 左ナビを sticky にする
2. `表示期間` は select 化する
3. `currentReport` を h1 単位で分割する helper を追加
4. summary と各レポートセクションを accordion 化する
5. `全て開く / 全て閉じる` を追加する
6. 見出し nav はクリック時に対応 section を開いて **縦方向だけ** scroll させる
7. `scrollIntoView()` の既定挙動で横スクロールが起きるなら、offset 計算や `block`/`inline` 制御、または custom scroll に置き換える
8. duplicate id や wide element による横飛びがないか検証する

受け入れ条件:

- スクロール量が大きく減る
- セクション単位で開閉できる
- 期間が compact に切り替えられる
- セクション click で右へ飛ばない

### Workstream C: Markdown table 改修

やること:

1. table を wrapper で包む
2. page 全体ではなく **table wrapper の中だけ** が overflow するようにする
3. `width: max-content` や `whitespace-nowrap` を全列一律に適用せず、列種別ごとに調整する
4. 数値列とテキスト列の扱いを分ける
5. 長い URL / title 列は
   - 必要以上に列幅を押し広げない
   - 本家に寄せつつ、必要なら `overflow-wrap:anywhere` / clamp / hover 展開を使う
6. `thead` / zebra / hover を本家寄りに整える
7. wide table が `main content` や page root を押し広げないことを確認する

受け入れ条件:

- テーブルの情報が潰れない
- 横スクロールで全文確認できる
- 下に不自然なはみ出しが出ない
- page 全体の horizontal scrollbar が消える
- 列幅が本家より不自然に広くならない

### Workstream D: Responsive / regression

やること:

1. desktop 幅で screenshot 比較
2. 1280px 前後でも破綻しないか確認
3. 左ナビが狭幅時に sticky を解除するか、縦積みに落とす
4. `build` と `lint`

---

## 10. 実装の判断基準

### 採用してよい

- 本家の UI パターンを React / Tailwind に置き換える
- helper を追加して markdown section を分割する
- `MarkdownRenderer` に table 専用 class を増やす

### 採用しない

- `ads-insights` の巨大 `index.html` をそのまま移植
- 単純な CSS 拡張だけで無理やり見た目を近づける
- テーブルをカード化して情報量を削る
- 期間別本文を全部常時展開したままにする
- `whitespace-nowrap` を全セルに一律で掛けて page 幅を壊す
- `scrollIntoView()` をそのまま使って横スクロール回帰を残す

---

## 11. Claude に必ず報告させること

1. どの reference 実装を採用したか
2. `EssentialPack.jsx` でどう section split したか
3. `MarkdownRenderer.jsx` の table rendering をどう変えたか
4. desktop と狭幅でどう挙動するか
5. build/lint 結果

---

## 12. Claude に渡す推奨プロンプト

```md
`plans/2026-03-26-session-handoff-ads-insights-aligned.md` と `plans/2026-03-26-essential-pack-ux-parity-claude-plan.md` を読んで、`/ads/pack` の UI parity 改修を続きから対応してください。

目的:
- 現在の `Insight Studio` の `要点パック` を、`ads-insights` 本家の UX に近づける
- 特に
  - 期間プルダウン
  - セクション accordion
  - markdown table の横スクロール対応
  - 見切れないレイアウト
  - page 全体の横スクロール解消
  - TOC click 時の右への強制スクロール解消
  を優先する

前提:
- data flow はすでに `bq/generate_batch -> report_md` に揃えてある
- 今回の主題は contract 修復ではなく UI parity
- source of truth は `tmp_ads_insights_repo/index.html`

やること:
1. `tmp_ads_insights_repo/index.html` の point-pack UI を確認し、移植すべき最小要素を整理
2. `src/pages/EssentialPack.jsx` を改修して
   - sticky left nav
   - compact な period selector
   - h1 ベースの accordion
   - section nav click scroll
   - expand all / collapse all
   を実装
3. `src/components/MarkdownRenderer.jsx` を改修して
   - table wrapper
   - wrapper 内だけの横スクロール
   - 本家寄りで不自然に広がらない列幅
   - 読みやすい thead/tbody
   を実装
4. 現在の regressions を直す
   - table が広すぎて見切れる
   - page 全体に horizontal scrollbar が出る
   - セクション click で右に飛ぶ
5. desktop と狭幅で崩れないよう調整
6. `npm run lint` と `npm run build` を実行

agent team が使えるなら以下で分担してください:
- reference ui auditor
- essential pack layout worker
- markdown table worker
- qa/responsive verifier

skills が使えるなら以下を優先:
- repo search / ui audit
- frontend react integration
- markdown rendering
- visual qa / responsive verification
- release verification

禁止:
- `ads-insights` の HTML をそのままコピペ移植しない
- 期間別レポートを全部ベタ展開のままにしない
- テーブル情報を削ってカード化しない
- page root に horizontal scrollbar を残さない
- セクション click で横に飛ぶ挙動を残さない
- build/lint failure を残さない

必ず報告してください:
- reference として採用した UI パターン
- 変更した file path
- accordion の分割ルール
- table rendering の変更点
- なぜ page 全体の横スクロールが消えたのか
- TOC click の横飛びをどう防いだのか
- 列幅をどう調整したのか
- responsive 上の注意点
- lint/build の結果
```

---

## 13. 一言で言うと

今回 Claude にやらせるべきなのは、`ads-insights` repo を眺めて終わることではない。  
**`Insight Studio` の実コード上で、本家の point-pack UX を「accordion + dropdown + scrollable markdown table」として移植すること** である。
