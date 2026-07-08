# Claude Plan: Ads Unified Pack + Graphs Recovery

**作成日:** 2026-04-13  
**対象リポジトリ:** `c:\Users\PEM N-266\work\insight-studio`  
**対象ブランチ:** `master`  
**現時点 HEAD:** `273f16f` (`Restore ads pack flow and simplify graphs surface`)  
**目的:** `要点パック` と `グラフ` を再び別画面に分離するのではなく、**1つの統合分析画面に戻したうえで、分かりづらさだけを解消する**

---

## 1. 結論

今回の正しい方向性はこれです。

- `要点パック` と `グラフ` は**分離しない**
- downstream の主画面は **1画面** で維持する
- 問題は「統合」そのものではなく、**情報設計の悪さ** と **隠し方の悪さ**
- したがって、やるべきことは
  - `ads/pack` の独立復活ではない
  - `ads/graphs` の中で `要点パック` と `グラフ` を同居させたまま、構造を整理すること

一言で言うと:

**`pack` と `graphs` は統合のまま直す。分離回帰はやめる。**

---

## 2. 今なにが間違っているか

現状 `273f16f` は、ユーザー要求に対して方向を誤っています。

### 2.1 route が分離に戻っている

- `src/App.jsx`
  - `ads/pack` が `EssentialPack` の独立 route
  - `ads/graphs` が `AnalysisGraphs` の独立 route

これは「要点パックとグラフは一緒にする」という合意に反しています。

### 2.2 sidebar でも別モードとして見えている

- `src/components/Layout.jsx`
  - `要点パック`
  - `グラフ`

の 2 項目が並んでおり、ユーザーに「別機能」「別画面」というメンタルモデルを強制しています。

### 2.3 真の問題は “分離不足” ではなく “統合面の設計ミス”

ユーザーが嫌がっている本質は以下です。

- `Analyst Supplements` のような**二重の隠しレイヤー**
- グラフ本体が「補助情報」扱いになっていたこと
- `Exec View / Analyst View` が、密度切替ではなく**発見可能性の破壊**になっていたこと

つまり、問題は「一緒だったこと」ではなく、

**一緒の画面の中で、主従関係が逆転していたこと**

です。

---

## 3. あるべき最終状態

### 3.1 downstream 主画面は 1 つ

主画面は `src/pages/AnalysisGraphs.jsx` をベースにした統合画面とする。

- route は実質 `ads/graphs` を canonical とする
- `ads/pack` は必要なら互換 redirect に留める
- ただし `ads/pack` を**独立した体験**として復活させてはいけない

### 3.2 画面の責務

統合画面の責務は次の通り。

1. 期間・データソース・view mode を示す
2. `要点パック` 相当のサマリーを最上部で見せる
3. その直後に `グラフ分析` 本体を見せる
4. `Analyst View` では raw table を同じ流れの中で見せる
5. `詳細分析レポート`・`クリエイティブ` は下流セクションに置く

### 3.3 view mode の意味を修正する

- `Exec View`
  - 主要サマリー + 主要グラフを軽量に読むモード
- `Analyst View`
  - 同じ画面の中で、全テーマグラフと raw table まで読むモード

重要:

- view mode は**同じ画面の情報密度の切替**であって、
- 「本体データを隠す/別コンテナへ逃がす」スイッチではない

---

## 4. 実装方針

### 4.1 route / nav を “統合前提” に戻す

対象:

- `src/App.jsx`
- `src/components/Layout.jsx`
- `src/pages/SetupWizard.jsx`
- `src/pages/Dashboard.jsx`

やること:

- `ads/pack` を primary route にしない
- Setup 完了後の遷移先は `ads/graphs`
- sidebar は `要点パック` / `グラフ` の 2 項目構成をやめる
- 表示名は `分析` または `広告分析` の 1 項目に戻す
- `ads/pack` が必要なら `ads/graphs` への redirect alias にする

禁止:

- `ads/pack` を再び独立画面として前面に出すこと
- “要点パック画面に行ってからグラフ画面へ進む” 導線に戻すこと

### 4.2 `AnalysisGraphs.jsx` を唯一の統合面として磨く

対象:

- `src/pages/AnalysisGraphs.jsx`

要求:

- `要点パック` と `グラフ` を同一 scroll 面に置く
- セクション nav は route ではなく in-page section として使う
- 上から順に
  1. ヘッダー
  2. 要点パック summary cards
  3. key charts
  4. theme tabs
  5. full chart sections
  6. analyst raw tables
  7. detail report
  8. creative / excel supplement
  のように整理する

重要:

- `グラフ` を「サマリーの補遺」にしてはいけない
- `summary` と `graphs` は**並列の主役**として同居させる

### 4.3 `Analyst Supplements` という箱を消す

このコンセプトは失敗です。

理由:

- ユーザーはそこに本体があると気づきにくい
- `詳細分析レポート` の下にさらに “本体グラフ” が出るのは意味順が逆
- 「分析の補足」ではなく「分析本体」だから

したがって:

- `Analyst Supplements` セクションは削除する
- 全テーマグラフは通常フローに戻す
- raw table だけを `GraphSection` の analyst 表示として残す

### 4.4 `EssentialPack.jsx` の扱い

対象:

- `src/pages/EssentialPack.jsx`

扱い方針:

- primary route owner にしない
- reusable な抽出ロジックや block 構造の reference としては利用可
- ただしユーザーが行き来する独立ページとして再昇格させない

必要なら:

- `EssentialPack` 特有の UI block を `AnalysisGraphs` に移植
- もしくは shared component 化

### 4.5 fake / placeholder へ戻さない

この修正では、見やすさを優先しても “嘘” に戻してはいけない。

守ること:

- `reportBundle`
- `chartGroups`
- `reportMd`
- `excelImport`

など、既存の live data contract を維持する

禁止:

- ダミー KPI
- ダミー chart
- ダミー table
- 空でも埋め草でそれっぽく見せる実装

---

## 5. UI/UX の具体要求

### 5.1 Above the fold

画面上部で最低限見えるべきもの:

- 要点パックの summary cards
- 主要グラフの最初の塊

つまり:

- 「上にはサマリーだけ、グラフ本体はさらに奥」
- 「詳細レポートの後ろに本体グラフ」

という構造は不可。

### 5.2 discoverability

ユーザーが迷わないように:

- テーマ tab は visible
- 全グラフ群は visible
- raw table は analyst 時だけ visible
- ただし raw table のために本体グラフまで hidden にしてはいけない

### 5.3 design reference

一次参考:

- `stitch2/stitch_ad_insights_data_integration (28)/code.html`
- `stitch2/stitch_ad_insights_data_integration (28)/DESIGN.md`

意識すること:

- botanical green 系の editorial feel
- no-line rule
- 余白で区切る
- ただし “高級感” を優先して発見可能性を落とさない

---

## 6. 受け入れ条件

以下をすべて満たしたら完了。

### 6.1 route / navigation

- Setup 完了後の遷移先が `ads/graphs`
- sidebar に `要点パック` と `グラフ` の 2 項目が並ばない
- `ads/pack` に入っても独立ページ体験にならず、必要なら `ads/graphs` に寄る

### 6.2 unified surface

- `ads/graphs` 単体で `要点パック` と `グラフ` の両方を読める
- `Analyst Supplements` が存在しない
- 全テーマグラフが main flow にある
- raw table は analyst 時のみ main flow 内に追加表示される

### 6.3 user perception

- ユーザーが「要点パックどこ行った?」「グラフどこ行った?」とならない
- 「統合されているが、前より分かりやすい」と感じる状態になっている

### 6.4 verification

- `npx eslint src/App.jsx src/components/Layout.jsx src/pages/SetupWizard.jsx src/pages/Dashboard.jsx src/pages/AnalysisGraphs.jsx src/pages/EssentialPack.jsx`
- `npm run build`

を通すこと

---

## 7. Claude への明示指示

以下を厳守してください。

1. `要点パック` と `グラフ` を別画面に分けないでください。
2. `ads/graphs` を統合分析の canonical route にしてください。
3. `ads/pack` は独立体験に戻さないでください。
4. `Analyst Supplements` のような “二重に隠す箱” を作らないでください。
5. `Exec View / Analyst View` は情報密度切替として扱い、本体データを隠す用途に使わないでください。
6. fake data / placeholder に戻さないでください。
7. 実装後は必ず対象ファイル lint と build を確認してください。

---

## 8. 期待する修正の要約

Claude に期待しているのは “分離回帰の打ち消し” です。

- route は 다시 1画面前提へ
- route は再び 1画面前提へ
- nav も 1画面前提へ
- `AnalysisGraphs` を本物の統合面として整える
- pack と graph は同居のまま、見つけやすくする

これが今回の仕事です。
