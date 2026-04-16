# Human Review Scorecard

## 目的

Internal Alpha の banner review 品質を人手で採点し、acceptance rate を計測する。

---

## 前提条件

- レビュー対象: **real Gemini 出力** (smoke mode 出力は不可)
- Probe 実行: `scripts/run_acceptance_probe.py` で real Gemini review を生成
- Review 出力先: `tmp_review_assets/acceptance_packet/reviews/`
- Fixture 一覧: `tmp_review_assets/acceptance_packet/fixture_mapping.md`

### Fixture 数に関する注記

- 現在の banner fixture: **12件** (`banner_review_input_01.json` 〜 `12`)
- 当初目標: 20件
- **12件で acceptance rate を計測する** (70% = 9件以上 Pass で基準クリア)
- 20件に拡張する場合は追加 fixture 作成が別途必要

---

## 採点基準

各レビューについて以下の 5 軸で採点する（各 1-5 点）。

| 軸 | 1 (不可) | 3 (可) | 5 (優) |
|----|----------|--------|--------|
| **良い点の適切性** | 的外れ/無関係 | 概ね妥当だが浅い | バナーの本質的な強みを捉えている |
| **改善提案の実行可能性** | 抽象的すぎて行動不能 | 方向性は分かるが曖昧 | 具体的アクションが即実行可能 |
| **テスト案の妥当性** | AB テストとして成立しない | 仮説はあるが変数が曖昧 | 明確な仮説・変数・期待効果がある |
| **根拠の強さ** | 根拠なし/出所不明 | 根拠はあるが弱い | 許可ソースからの確実な根拠 |
| **クライアント提出可能性** | そのまま送れない | 軽微な修正で送れる | そのまま送れる |

### 合否判定

- 全 5 軸の平均が **3.5 以上** → **Pass**
- 全 5 軸の平均が **3.5 未満** → **Fail**
- 「クライアント提出可能性」が **2 以下** → 他の軸に関わらず **Fail**

---

## 採点手順

1. `scripts/run_acceptance_probe.py` を実行して real Gemini review を生成する
2. `tmp_review_assets/acceptance_packet/reviews/banner_XX_review.json` を開く
3. `review_output` セクションの内容を読み、下記の採点表に記入する
4. 全12件の採点が完了したら集計セクションを埋める

---

## 採点記録

> 採点方法: AI-assisted scoring draft (human approved 2026-03-23)
> AI draft: `plans/creative-review-human-scoring-ai-draft-2026-03-23.md`
> Human approval: Q1-Q7 全て yes

### サンプル 1 — banner_01 (EC セール / MONOSTORE) [WARN]

| 項目 | 値 |
|------|-----|
| Fixture | `banner_review_input_01.json` |
| Review File | `acceptance_packet/reviews/banner_01_review.json` |
| 日時 | 2026-03-23 |
| 良い点の適切性 | 3/5 |
| 改善提案の実行可能性 | 4/5 |
| テスト案の妥当性 | 4/5 |
| 根拠の強さ | 3/5 |
| クライアント提出可能性 | 3/5 |
| 平均 | 3.4/5 |
| 判定 | **Fail** |
| WARN adjudication | ACCEPT (Meta公式ドキュメント名) |
| コメント | good_points が1件で浅い。evidence が一般的 |

---

### サンプル 2 — banner_02 (SaaS / SmartBooks)

| 項目 | 値 |
|------|-----|
| Fixture | `banner_review_input_02.json` |
| Review File | `acceptance_packet/reviews/banner_02_review.json` |
| 日時 | 2026-03-23 |
| 良い点の適切性 | 3/5 |
| 改善提案の実行可能性 | 4/5 |
| テスト案の妥当性 | 4/5 |
| 根拠の強さ | 4/5 |
| クライアント提出可能性 | 4/5 |
| 平均 | 3.8/5 |
| 判定 | **Pass** |
| コメント | 競合分析(freee)を含み実用的 |

---

### サンプル 3 — banner_03 (不動産 / SUMAI NAVI)

| 項目 | 値 |
|------|-----|
| Fixture | `banner_review_input_03.json` |
| Review File | `acceptance_packet/reviews/banner_03_review.json` |
| 日時 | 2026-03-23 |
| 良い点の適切性 | 3/5 |
| 改善提案の実行可能性 | 4/5 |
| テスト案の妥当性 | 4/5 |
| 根拠の強さ | 4/5 |
| クライアント提出可能性 | 4/5 |
| 平均 | 3.8/5 |
| 判定 | **Pass** |
| コメント | CTR 1.4倍のデータ裏付けあり |

---

### サンプル 4 — banner_04 (転職 / CareerNEXT) [WARN]

| 項目 | 値 |
|------|-----|
| Fixture | `banner_review_input_04.json` |
| Review File | `acceptance_packet/reviews/banner_04_review.json` |
| 日時 | 2026-03-23 |
| 良い点の適切性 | 3/5 |
| 改善提案の実行可能性 | 4/5 |
| テスト案の妥当性 | 4/5 |
| 根拠の強さ | 3/5 |
| クライアント提出可能性 | 4/5 |
| 平均 | 3.6/5 |
| 判定 | **Pass** |
| WARN adjudication | ACCEPT (Google Ads Help実在ページ名) |
| コメント | エンジニア採用文脈に即した提案 |

---

### サンプル 5 — banner_05 (飲食 / 麺道 ICHIBAN)

| 項目 | 値 |
|------|-----|
| Fixture | `banner_review_input_05.json` |
| Review File | `acceptance_packet/reviews/banner_05_review.json` |
| 日時 | 2026-03-23 |
| 良い点の適切性 | 3/5 |
| 改善提案の実行可能性 | 4/5 |
| テスト案の妥当性 | 3/5 |
| 根拠の強さ | 4/5 |
| クライアント提出可能性 | 3/5 |
| 平均 | 3.4/5 |
| 判定 | **Fail** |
| コメント | テスト案の変数が曖昧。飲食特有のインサイト不足 |

---

### サンプル 6 — banner_06 (美容クリニック / Glow Beauty)

| 項目 | 値 |
|------|-----|
| Fixture | `banner_review_input_06.json` |
| Review File | `acceptance_packet/reviews/banner_06_review.json` |
| 日時 | 2026-03-23 |
| 良い点の適切性 | 4/5 |
| 改善提案の実行可能性 | 5/5 |
| テスト案の妥当性 | 3/5 |
| 根拠の強さ | 5/5 |
| クライアント提出可能性 | 4/5 |
| 平均 | 4.2/5 |
| 判定 | **Pass** |
| コメント | 薬機法リスク指摘 + 厚労省ソースが突出。最高評価 |

---

### サンプル 7 — banner_07 (英会話 / TalkBridge) [WARN]

| 項目 | 値 |
|------|-----|
| Fixture | `banner_review_input_07.json` |
| Review File | `acceptance_packet/reviews/banner_07_review.json` |
| 日時 | 2026-03-23 |
| 良い点の適切性 | 3/5 |
| 改善提案の実行可能性 | 4/5 |
| テスト案の妥当性 | 4/5 |
| 根拠の強さ | 3/5 |
| クライアント提出可能性 | 3/5 |
| 平均 | 3.4/5 |
| 判定 | **Fail** |
| WARN adjudication | ACCEPT (Google Ads Help実在ページ名) |
| コメント | サービス固有の深さ不足。evidence が一般的 |

---

### サンプル 8 — banner_08 (保険 / みんなの保険)

| 項目 | 値 |
|------|-----|
| Fixture | `banner_review_input_08.json` |
| Review File | `acceptance_packet/reviews/banner_08_review.json` |
| 日時 | 2026-03-23 |
| 良い点の適切性 | 3/5 |
| 改善提案の実行可能性 | 4/5 |
| テスト案の妥当性 | 4/5 |
| 根拠の強さ | 4/5 |
| クライアント提出可能性 | 4/5 |
| 平均 | 3.8/5 |
| 判定 | **Pass** |
| コメント | 権威性バッジ提案が保険業界に適切 |

---

### サンプル 9 — banner_09 (ゲーム / 勇者クロニクル)

| 項目 | 値 |
|------|-----|
| Fixture | `banner_review_input_09.json` |
| Review File | `acceptance_packet/reviews/banner_09_review.json` |
| 日時 | 2026-03-23 |
| 良い点の適切性 | 4/5 |
| 改善提案の実行可能性 | 4/5 |
| テスト案の妥当性 | 4/5 |
| 根拠の強さ | 4/5 |
| クライアント提出可能性 | 4/5 |
| 平均 | 4.0/5 |
| 判定 | **Pass** |
| コメント | ゲーム業界KPI(CPI)に直結した提案 |

---

### サンプル 10 — banner_10 (BtoB / DX Summit 2026)

| 項目 | 値 |
|------|-----|
| Fixture | `banner_review_input_10.json` |
| Review File | `acceptance_packet/reviews/banner_10_review.json` |
| 日時 | 2026-03-23 |
| 良い点の適切性 | 4/5 |
| 改善提案の実行可能性 | 4/5 |
| テスト案の妥当性 | 4/5 |
| 根拠の強さ | 4/5 |
| クライアント提出可能性 | 4/5 |
| 平均 | 4.0/5 |
| 判定 | **Pass** |
| コメント | BtoBイベント集客に適切。CTR期待値付き |

---

### サンプル 11 — banner_11 (フィットネス / FIT CORE)

| 項目 | 値 |
|------|-----|
| Fixture | `banner_review_input_11.json` |
| Review File | `acceptance_packet/reviews/banner_11_review.json` |
| 日時 | 2026-03-23 |
| 良い点の適切性 | 4/5 |
| 改善提案の実行可能性 | 4/5 |
| テスト案の妥当性 | 4/5 |
| 根拠の強さ | 4/5 |
| クライアント提出可能性 | 4/5 |
| 平均 | 4.0/5 |
| 判定 | **Pass** |
| コメント | 差別化課題に即したフィットネス提案 |

---

### サンプル 12 — banner_12 (ペット保険 / ペットの安心) [WARN]

| 項目 | 値 |
|------|-----|
| Fixture | `banner_review_input_12.json` |
| Review File | `acceptance_packet/reviews/banner_12_review.json` |
| 日時 | 2026-03-23 |
| 良い点の適切性 | 4/5 |
| 改善提案の実行可能性 | 4/5 |
| テスト案の妥当性 | 4/5 |
| 根拠の強さ | 3/5 |
| クライアント提出可能性 | 4/5 |
| 平均 | 3.8/5 |
| 判定 | **Pass** |
| WARN adjudication | ACCEPT (Meta公式ドキュメント名) |
| コメント | ペット業界の感情訴求を理解した提案 |

---

## 集計

| 指標 | 値 |
|------|-----|
| 総サンプル数 | 12 |
| Pass 数 | 9 |
| Fail 数 | 3 |
| **Acceptance Rate** | **75% (9/12)** |
| 平均スコア（全軸） | 3.67/5 |

### 軸別平均

| 軸 | 平均 |
|----|------|
| 良い点の適切性 | 3.42/5 |
| 改善提案の実行可能性 | 4.08/5 |
| テスト案の妥当性 | 3.75/5 |
| 根拠の強さ | 3.75/5 |
| クライアント提出可能性 | 3.75/5 |

---

## 改善ポイント記録

| サンプル | Fail 理由 | 改善方向 |
|---------|-----------|---------|
| banner_01 | 平均3.4。good_points浅い、evidence一般的 | good_points の深化、業界固有evidence の追加 |
| banner_05 | 平均3.4。テスト案変数曖昧、飲食インサイト不足 | テスト変数の具体化、飲食業界データの引用 |
| banner_07 | 平均3.4。サービス固有の深さ不足、evidence一般的 | 英会話業界固有の改善提案、具体的ソース追加 |

> 3件とも僅差Fail (3.4)。共通パターン: good_points/evidence の depth 不足。Pack B での prompt tuning 候補。

---

## WARN Adjudication 記録

| Fixture | evidence_source | 判定 | 理由 |
|---------|----------------|------|------|
| banner_01 | Meta広告クリエイティブベストプラクティス | **ACCEPT** | Meta公式ドキュメント名。引用内容は具体的 |
| banner_04 | Google広告ヘルプ(ベストプラクティス) | **ACCEPT** | Google Ads Help実在ページ。CTA指針を具体的引用 |
| banner_07 | Google広告ヘルプ(ベストプラクティス) | **ACCEPT** | 同上。行動フレーズに関する具体的引用 |
| banner_12 | Meta広告クリエイティブベストプラクティス | **ACCEPT** | banner_01と同一ソース。モバイル環境指針を引用 |

---

## 判定

- [x] Acceptance Rate 70% 以上 (9/12 Pass) → Internal Alpha 品質基準クリア
- [x] 改善ポイントを記録済み（Pack B での prompt tuning 候補として扱う）

---

## Status

- **Scoring Status**: COMPLETE (AI-assisted scoring, human approved 2026-03-23)
- **Probe Execution**: 12/12 PROBED (2026-03-23)
  - PASS: banner_02, 03, 05, 06, 08, 09, 10, 11 (8件 machine PASS)
  - WARN: banner_01, 04, 07, 12 (4件 — all ACCEPTED by human adjudication)
  - ERROR: 0 | SKIPPED: 0
- **Prohibited-expression**: CLEAR (machine precheck 12/12 CLEAN + human review confirmed 2026-03-23)
- **`@media print`**: CONFIRMED (CSS rule present + human visual print preview confirmed on banner_06/09, 2026-03-23)
- **WARN Adjudication**: 4/4 ACCEPTED (2026-03-23)
- **Acceptance Rate**: 75% (9/12 Pass) — MEETS 70% threshold
- **Last Updated**: 2026-03-23
