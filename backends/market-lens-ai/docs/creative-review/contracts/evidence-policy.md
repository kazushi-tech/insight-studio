# Creative Review — Evidence Policy

このドキュメントは Creative Review の提案における根拠（evidence）の取り扱いルールを定義する。
review-output.schema.json の `evidence` フィールドと glossary.md の `evidence_type` に準拠する。

---

## Allowed Sources（許可するソース）

提案の根拠として使用してよいソースを以下に限定する。

| evidence_type | 説明 | 使用例 |
|---------------|------|--------|
| `client_material` | クライアントが提供した資料 | ブランドガイドライン、過去の成果報告書、ターゲット定義書 |
| `approved_proposal` | 承認済みの自社提案書 | 過去に提出・承認された改善提案書 |
| `winning_creative` | 過去の勝ちクリエイティブ | AB テストで勝った過去のバナーや LP |
| `competitor_public` | 競合の公開情報 | 競合の公式 LP、公開バナー、公式サイト |
| `platform_guideline` | 媒体の公式ガイドライン | Google Ads ポリシー、Meta 広告ガイド、Yahoo! 広告仕様 |

### 使用ルール

1. すべての `improvements` と `test_ideas` には最低 1 つの evidence を紐付ける
2. evidence_source は具体的に記載する（「一般的に」等の曖昧表現は不可）
3. 複数ソースがある場合はすべて列挙する
4. ソースが review input に含まれていない場合は evidence_type を明示したうえで出典を記載する

---

## Forbidden Claims（禁止表現）

以下の表現パターンは review output 内で使用してはならない。

### 1. 効果の断定

- 「〜すれば必ず効果が出ます」
- 「〜で CVR が上がります」
- 「〜すると確実にクリック率が改善します」

**代替表現**: 仮説として表現する
- 「〜することで CVR 改善が期待できます（仮説）」
- 「〜の変更により、クリック率向上の可能性があります」

### 2. 未確認の業界常識の断言

- 「業界では〜が常識です」
- 「一般的に〜が最も効果的です」
- 「ベストプラクティスとして〜すべきです」

**代替表現**: ソースを明示する
- 「Google Ads のガイドラインでは〜が推奨されています」
- 「過去の勝ちクリエイティブ X では〜のパターンが採用されていました」

### 3. 出所不明のベストプラクティス引用

- 「研究によると〜」（出典なし）
- 「データで証明されている〜」（出典なし）
- 「専門家によれば〜」（具体名なし）

**代替表現**: 使用しない。evidence_source が示せない提案は根拠なしとして扱う

### 4. 競合表現のほぼそのままの転用提案

- 「競合 A のように〜をコピーしましょう」
- 「競合のバナーをそのまま参考にして〜」

**代替表現**: 差別化の観点で言及する
- 「競合 A は〜のアプローチを取っています。自社の強みを活かすなら〜の方向が考えられます」

---

## Guardrail Rules

### Review Style Constraints

1. **良い点を先に出す**: `good_points` は必ず `improvements` より先に提示する
2. **破壊的講評の禁止**: 既存のクリエイティブを全否定する表現は使わない
3. **行動可能な粒度**: `improvements` の各 `action` は具体的で実行可能な内容にする
4. **仮説表現の徹底**: `test_ideas` の `expected_impact` は「〜が期待できる」「〜の可能性がある」等の仮説表現を使う
5. **スコアの根拠明示**: `rubric_scores` の各 `comment` は具体的な観察事実に基づく

### Evidence Validation Rules

1. `evidence` 配列が空の review output は invalid とする
2. `evidence_type` は allowed sources の 5 種別のいずれかであること
3. `evidence_source` に「一般的に」「通常」「普通は」等の曖昧表現を含む場合は reject する
4. 1 つの `improvement` に対して evidence が紐付かない場合は warning を出す

---

## Severity Levels

evidence policy 違反の重大度を定義する。

| Severity | 説明 | 処理 |
|----------|------|------|
| `error` | forbidden claim の使用、evidence 配列が空 | review output を reject |
| `warning` | improvement に evidence が紐付かない | 警告表示、修正を推奨 |
| `info` | evidence_source の記載が簡潔すぎる | 情報提供のみ |
