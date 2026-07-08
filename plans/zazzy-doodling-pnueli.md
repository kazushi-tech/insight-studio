# 根拠整合バリデータ — 過剰類推を検出して自動注記する

## Context

Phase 5C（PR #48）の完了で v2 ReportView は本番 default に昇格済。UI 側は安定稼働、OPEN PR なし、ブロッカーなし。次の焦点は**分析精度＝類推の根拠整合**じゃ。

既知の最重要品質事故パターン:
- **L5-only → 強言語への昇格**: LP の nav ラベルや hero_copy（L5: 自社訴求）しか確認できておらぬのに、レポートでは「アンチドーピング対応」「WADA 検査済み」「認証されている」など L1（第三者評価）相当の強主張が出てしまう。
  - 実例: SAURUS の "ANTI DOPING" nav ラベルのみ → 「アンチドーピング対応」と断定されたケース（plans/2026-04-11-claude-discovery-report-final-quality-plan-v3.md Task B）。
- **原因**: `deterministic_evaluator` が L1-L5 評価と 強/同等/弱/評価保留 verdict は生成してプロンプトに注入しとるが、**LLM 出力に対する事後バリデーションが無い**。LLM は honor-system じゃ。

**ゴール**: 後段に軽量な deterministic validator を 1 本挟み、過剰類推語彙を検出したら (a) log に残し、(b) 該当箇所を安全表現に自動書き換え、(c) レポート末尾に注記セクションを追加する。配信は差し止めぬ（警告モード）。

**ユーザー合意事項**（本セッション会話）:
- 振る舞い: 警告 + 注記（ハード fail や再生成ループは採らぬ）。
- スコープ: Discovery と Compare 両方。
- 範囲外: UI 側の新コンポーネント追加、再生成ループ、Review 機能側の evidence_grounding_service 拡張、新規 trust_tier 軸追加。

**非対象**: プロンプト本体の大改造、envelope schema の破壊的変更、トークン budget 再設計、v1 コード削除。

---

## 参照済みコード地図

バリデータが組み込まれる先:

- [backends/market-lens-ai/web/app/analyzer.py](../backends/market-lens-ai/web/app/analyzer.py) — Discovery の LLM 呼び出し本体。`_build_shared_eval_context()` が既に L1-L5 判定 block を注入しとる（L18-39）。
- [backends/market-lens-ai/web/app/services/review/compare_prompt_builder.py](../backends/market-lens-ai/web/app/services/review/compare_prompt_builder.py) — Compare 側のプロンプト生成。`_COMPARE_OUTPUT_FORMAT` が evidence[] 付き JSON を強要しとる（L20-55）。
- [backends/market-lens-ai/web/app/deterministic_evaluator.py](../backends/market-lens-ai/web/app/deterministic_evaluator.py) — `evaluate_all()` と `format_judgment_block()`（L238-271）。trust_tier と verdict を返す既存資産で、validator の入力源じゃ。
- [backends/market-lens-ai/web/app/shared_specs/trust_hierarchy.yaml](../backends/market-lens-ai/web/app/shared_specs/trust_hierarchy.yaml) — L1-L5 タクソノミーの権威データ（L1-84）。validator の禁止語彙マップはここと対応づける。
- [backends/market-lens-ai/web/app/schemas/report_envelope.py](../backends/market-lens-ai/web/app/schemas/report_envelope.py) — `ReportEnvelope` / `BrandEvaluation`。新規フィールド `validator_notes` を追加する候補（L37-84）。
- [backends/market-lens-ai/web/app/services/review/evidence_grounding_service.py](../backends/market-lens-ai/web/app/services/review/evidence_grounding_service.py) — 既存の grounding validator、構造的には近いが用途違い（Review 機能専用）。実装パターンの参考にする（L1-95）。
- [backends/market-lens-ai/tests/test_deterministic_evaluator.py](../backends/market-lens-ai/tests/test_deterministic_evaluator.py) — pytest の慣習確認用（L1-141）。新テストはこれと同じファイル階層に置く。

---

## 設計

### 新規モジュール: `confidence_tier_validator.py`

配置: `backends/market-lens-ai/web/app/confidence_tier_validator.py`

API:
```python
def validate_and_annotate(
    *,
    report_markdown: str,
    brand_evaluations: tuple[BrandEvaluation, ...],  # from evaluate_all()
    context: str,  # "discovery" or "compare"
) -> ValidationOutcome:
    """
    過剰類推語彙を検出して (a) 書き換え済み markdown (b) violations list (c) notes を返す。
    """
```

`ValidationOutcome`:
- `rewritten_markdown: str` — 過剰語彙を安全表現に置換済みの本文
- `violations: list[Violation]` — 検出詳細（axis, brand, original_claim, suggested_rewrite, trust_tier）
- `notes: list[str]` — レポート末尾に差し込む注記文。例: 「以下の項目はエビデンスが L5（自社訴求）のみのため『評価保留』扱いとした: …」
- `is_clean: bool` — violations 無しなら True

### 判定ルール（v1 は regex + trust_tier ベースの軽量版）

trust_hierarchy.yaml の signal_fields 群と禁止語彙のマップを持つ:

| Trust tier | 禁止語彙（例） | 推奨書換先 |
|---|---|---|
| L5 only（self-claim のみ） | 「対応している」「認証済み」「検査済み」「WADA」「第三者評価」「保証」 | 「関連情報の記載あり（内容未確認）」「L5-only: 評価保留」 |
| L4 以下で金額/期間を含む主張 | 「30日返金保証」等（保証文言が contact_paths 経由のみで確認済みでない場合） | 「返金ポリシーの記載あり」|
| verdict=評価保留の axis 内 | 「優れている」「劣っている」等の比較断定 | 「判定保留（データ不足）」|

ルールセットは YAML で外出し: `backends/market-lens-ai/web/app/shared_specs/overreach_patterns.yaml`。

### 統合ポイント

**Discovery** — `analyzer.py` の LLM 応答取得直後:

```python
# analyzer.py（既存の Discovery pipeline、LLM call 直後）
report_md = llm_response.text
outcome = validate_and_annotate(
    report_markdown=report_md,
    brand_evaluations=shared_eval_context.evaluations,
    context="discovery",
)
report_md = outcome.rewritten_markdown
# envelope に validator_notes 添付
envelope.validator_notes = outcome.notes
```

**Compare** — Compare の review pipeline 終端。`review_result` 生成直後、envelope 構築前に同じ validator を呼ぶ（`context="compare"`）。

### Envelope スキーマ変更

`ReportEnvelope` に 1 フィールド追加:
```python
validator_notes: list[str] = Field(default_factory=list)
```
後方互換を保つため `Optional` 扱い。frontend 側（ReportViewV2）は既存のまま未読で OK。将来的に UI 表示を追加する際はここを読む。

### レポート末尾注記フォーマット

バリデータが violations を検出した場合、markdown 末尾に以下を追記:

```markdown
---

## 📋 根拠強度に関する注記

以下の項目は LP から得られたエビデンスが限定的なため「評価保留」として扱いました。本文中の該当表現は安全側に書き換え済みです。

- **ブランド X / アンチドーピング軸**: nav ラベル "ANTI DOPING" のみ確認（L5: 自社訴求）。第三者認証や検査結果の記載は未確認のため「関連情報の記載あり（内容未確認）」と表記。
```

---

## 具体的ファイル変更

### 新規 2 ファイル

- [backends/market-lens-ai/web/app/confidence_tier_validator.py](../backends/market-lens-ai/web/app/confidence_tier_validator.py) — 新規 validator 本体（~150 行想定）
- [backends/market-lens-ai/web/app/shared_specs/overreach_patterns.yaml](../backends/market-lens-ai/web/app/shared_specs/overreach_patterns.yaml) — 禁止語彙とルール定義

### 編集 3 ファイル

- [backends/market-lens-ai/web/app/analyzer.py](../backends/market-lens-ai/web/app/analyzer.py) — Discovery の LLM 応答直後に `validate_and_annotate()` 呼び出し追加（~10 行）。既存の `_build_shared_eval_context()` の戻り値を活用する。
- [backends/market-lens-ai/web/app/services/review/compare_review_runner.py](../backends/market-lens-ai/web/app/services/review/compare_review_runner.py)（または該当する Compare orchestrator。Explore で確認し、review 結果を envelope に詰める箇所を特定してから編集）— 同等の呼び出し追加。
- [backends/market-lens-ai/web/app/schemas/report_envelope.py](../backends/market-lens-ai/web/app/schemas/report_envelope.py) — `validator_notes: list[str]` 追加（1 行 + default_factory）。

### 新規テスト 1 ファイル

- [backends/market-lens-ai/tests/test_confidence_tier_validator.py](../backends/market-lens-ai/tests/test_confidence_tier_validator.py) — pytest。以下 5 ケース最低保証:
  1. `test_l5_only_nav_label_blocks_certification_claim` — "ANTI DOPING" nav label のみ → "アンチドーピング対応" が "関連情報の記載あり（内容未確認）" に書換される
  2. `test_l1_certified_evidence_passes_through` — trust_badges に実際の認証ロゴ記載あり → "認証済み" そのまま通す
  3. `test_verdict_defer_blocks_comparative_claims` — verdict=評価保留 の axis で "優れている" 等が書換される
  4. `test_clean_report_returns_no_notes` — violations 無しの場合 `is_clean=True`、`notes=[]`
  5. `test_report_notes_section_is_appended_correctly` — violations ありなら末尾に「📋 根拠強度に関する注記」セクションが追加される

---

## Verification

### ローカル Gate

```bash
cd backends/market-lens-ai
python -m pytest tests/test_confidence_tier_validator.py -v
python -m pytest tests/test_deterministic_evaluator.py -v  # regression
python -m pytest  # full suite
```

### 統合確認（fixture or 実データ）

- 既存の fixture（`discovery-sample` など）に対して analyzer を走らせ、violations が 0 件 or 妥当な件数であることを確認する小さなスクリプトを `scripts/validate-confidence-tier.py` に置く（LLM コストゼロ、fixture 再生）。
- **過去の問題レポート**を手動再現する golden test: SAURUS ケースの extracted_data を fixture 化し、validator が「アンチドーピング対応」を検出することを unit test 化（#1 と重複するが golden として明示）。

### デプロイ確認

- Render backend deploy 後、Discovery 実ジョブ 1 本で envelope に `validator_notes` が入っているか確認（Render log で validator の log 行を grep）。
- Frontend 側は envelope の新規フィールドを無視するだけなので regression なし。既存 Playwright harness（`scripts/phase5b-verify.py`）で Gate L/M 再走し、console error 0 を確認。

### フロントエンドへの影響

**無い**（envelope に optional フィールド追加のみ、ReportViewV2 は未読）。

---

## ロールバック経路

- バリデータ内部で feature flag: `ENABLE_CONFIDENCE_TIER_VALIDATOR` 環境変数で完全 bypass 可能にする。デフォルト ON、問題検知時に Render env で OFF 即応。
- Git revert PR で analyzer.py と compare runner 側の呼び出しを戻せば即無効化（envelope フィールドは残しても互換）。

---

## Non-goals（本プラン外）

- 再生成ループ（`品質ゲート hard-fail` オプション側）
- UI 側の新コンポーネント（ConfidencePill は既存のまま、`validator_notes` の表示は別 PR）
- トークン budget の再設計（`トークン budget 再設計` オプション側の別プラン）
- v1 ReportView / v1 コンポーネントの削除（Phase 5C 観測 1-2 週間後の別 PR）
- Review 機能の evidence_grounding_service の拡張
- 新規 trust_tier 軸の追加

---

## 成功時の効果（期待値）

- 「L5-only nav label → 強主張」型の過剰類推パターンを**本文 + 注記で二重に明示**、クライアントに誤解を与えぬ。
- 既存の deterministic_evaluator 資産を活用するため、LLM コスト +0%、推論時間 +1-3%（regex 走査のみ）。
- regression risk 小（envelope 追加フィールドは optional、検証失敗は警告のみ）。
- 将来、ハード fail / 再生成ループ / UI 可視化を追加する際の基盤になる。

---

## 想定工数

| Part | 内容 | 見積 |
|---|---|---|
| A | validator 本体 + overreach_patterns.yaml | 3h |
| B | analyzer.py + compare runner 統合 | 2h |
| C | envelope schema 更新 + pytest 5 ケース | 2h |
| D | fixture 再走スクリプト + golden test | 1h |
| E | PR 作成 + CI 緑待ち + Render deploy | 1h |
| **合計** | | **~9h**（1 セッション枠内）|
