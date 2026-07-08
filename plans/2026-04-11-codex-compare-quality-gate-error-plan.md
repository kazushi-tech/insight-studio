# Plan: Codex向け LP比較「品質基準未達」エラー対応

**作成日**: 2026-04-11  
**対象**:
- `src/pages/Compare.jsx`
- `src/utils/reportQuality.js`
- `tmp_market_lens_ai_repo/web/app/report_generator.py`

**非対象**:
- Discovery / Compare の考察品質そのもの
- Claude prompt の改善
- 業界別の訴求ロジック調整

---

## 問題の整理

今回の LP比較分析は、UI 上で

- `レポートの品質基準未達`
- `再試行してください`

となっており、本文が表示されない。

現状コードを見ると、原因は次の3層に分かれる。

### 1. backend が quality failure marker を本文先頭に混ぜる

`tmp_market_lens_ai_repo/web/app/report_generator.py`

- `_quality_gate_check(...)` が critical と判定すると
- `> **品質基準未達**: ...` を `analysis_md` の先頭に差し込む

つまり、**レポート本文自体を汚して failure marker を埋め込んでいる**。

### 2. frontend が marker 文字列だけで hard fail する

`src/utils/reportQuality.js`

- `/品質基準未達/` にマッチしたら即 `isQualityFailure = true`

`src/pages/Compare.jsx`

- `isQualityFailure` の場合、Markdown を一切表示せず、警告UIだけを出す

つまり、**backend の marker 1個で本文全体が封鎖される**。

### 3. UI が失敗理由を正しく見せていない

backend は Appendix A に品質監査を入れているが、

- frontend は quality fail 時に本文も appendix も描画しない
- `qualityIssues` には backend audit の詳細ではなく、ほぼ generic な内容しか出ない

そのため、ユーザーには

- なぜ落ちたのか
- truncation なのか
- 見出し欠損なのか
- validator の誤判定なのか

が見えない。

---

## Codex がやるべきこと

Codex の役割は、**エラーを「再試行してください」で終わらせず、原因が見えて、可能なら復旧できる状態にすること**。

今回必要なのは以下の3本柱。

1. **品質ゲートの結果を構造化して返す**
2. **quality failure の UI/UX を改善する**
3. **truncation や false positive に対して自動縮退経路を入れる**

---

## 原因仮説

今回の LP比較 failure は、コード上かなり高い確率で次のどれか。

### 仮説A: truncation

`report_generator.py` の quality gate は末尾5行を見て:

- 未閉塞テーブル
- 短すぎる見出し
- 未閉じカギ括弧

を critical 扱いする。

Compare レポートは長文化しやすく、token 上限に当たるとここで落ちやすい。

### 仮説B: 必須見出し欠損

`エグゼクティブサマリー`
`分析対象と比較前提`

がないと critical。

prompt 側で見出し揺れがあると false fail しうる。

### 仮説C: frontend が backend audit を読まず generic fail にしている

たとえ backend が詳しい監査理由を appendix に持っていても、
frontend はそれを見せていない。

つまり、**実害としては「落ちること」以上に「原因不明で落ちること」** が問題。

---

## 実装方針

### Task A: quality gate の結果を構造化レスポンス化する

現状:

- failure marker を本文先頭に埋め込む
- Appendix A に監査を書く

改善:

- `report_generator.py` では本文に marker を埋め込まない
- 代わりに backend response に以下を持たせる
  - `quality_status: pass | fail`
  - `quality_issues: [...]`
  - `quality_failure_reason`

最低限、frontend が markdown 文字列を regex で判定しなくて済むようにする。

### Task B: frontend の hard-fail UI を詳細表示に変える

`src/pages/Compare.jsx`

現状:

- quality fail なら本文全隠し
- generic な警告のみ

改善:

- quality fail 時は
  - 失敗理由一覧
  - 再試行の案内
  - run_id
  - 可能なら appendix audit の内容
  を表示する

- さらに `コピー` または `詳細を表示` で監査内容を確認できるようにする

### Task C: truncation 向けの自動縮退を追加する

Codex 側で最優先なのはここ。

quality issue が以下のとき:

- 末尾欠け
- テーブル未閉塞
- セクション欠損

は、即 fail にせず次を試す。

1. Appendix なしで再レンダリング
2. ブランド別評価を圧縮した fallback prompt
3. action plan の件数を減らした短縮版

これで `品質基準未達 → 即失敗` を減らす。

### Task D: validator の false positive を監査できるようにする

backend の `_quality_gate_check(...)` が何に反応したかを構造化ログに残す。

最低限:

- `issue_type`
- `matched_text`
- `line_excerpt`

を run_id に紐づけて見えるようにする。

### Task E: frontend の `checkReportQuality()` を marker 依存から外す

`src/utils/reportQuality.js`

現状:

- `/品質基準未達/` を見たら fail

改善:

- backend の structured field を優先
- local fallback は補助にとどめる

これにより、本文上の文字列に引っ張られる誤判定を避ける。

---

## 具体タスク

### 1. backend: report_generator の契約変更

対象:

- `tmp_market_lens_ai_repo/web/app/report_generator.py`

やること:

- 本文先頭への `品質基準未達` marker 注入をやめる
- quality issues を構造化して返せるようにする
- appendix audit は残してもよいが、UI依存の唯一ソースにしない

### 2. backend: scan/discovery response に quality fields を追加

対象候補:

- `tmp_market_lens_ai_repo/web/app/models.py`
- `tmp_market_lens_ai_repo/web/app/services/scan_service.py`
- Compare / Discovery response schema

やること:

- `quality_status`
- `quality_issues`
- `quality_is_critical`

を API response に追加

### 3. frontend: Compare の失敗表示改善

対象:

- `src/pages/Compare.jsx`

やること:

- quality fail 時の理由を UI に表示
- `run_id` を出す
- appendix 監査 or 詳細情報を展開できるようにする
- generic な `再試行してください` だけで終わらせない

### 4. frontend: reportQuality utility の見直し

対象:

- `src/utils/reportQuality.js`

やること:

- marker 依存の hard fail をやめる
- backend structured status があればそれを優先
- local truncation check は補助診断に下げる

### 5. fallback rerender の導入

対象候補:

- `tmp_market_lens_ai_repo/web/app/services/scan_service.py`
- `tmp_market_lens_ai_repo/web/app/analyzer.py`

やること:

- প্রথম回 quality fail
- → 短縮モードで再生成
- → それでも fail なら structured error を返す

---

## 受け入れ基準

1. LP比較が quality fail したとき、UI に具体的な理由が表示される
2. 本文に `品質基準未達` marker を混ぜなくても frontend が判定できる
3. truncation 系の failure は少なくとも1回自動縮退を試みる
4. Compare 画面で `run_id` と failure detail が確認できる
5. regex だけの brittle な failure 判定から脱却する

---

## Claude に渡さない理由

この問題は考察品質ではなく、以下が本体。

- backend response contract
- deterministic validator
- frontend hard-fail UI
- fallback rerender

つまり **実装・制御・エラーUXの問題** なので、Claude ではなく Codex が担当するのが正しい。

---

## 最終判断

Codex 側でやるべきエラー対応は:

1. **quality failure の原因を見える化する**
2. **本文 marker 依存の brittle 判定をやめる**
3. **truncation 時の自動縮退再生成を入れる**
4. **それでも fail なら structured に返す**

この順で進めるのが最も合理的。
