# Insight Studio 現状調査レポート (Phase 0)

> 作成日: 2026-05-03  
> 調査者: Claude Code (Sonnet 4.6)  
> 目的: `ec-hd-api-froad-gemini-gemini-3-1-froad-zesty-kitten.md` (ハンドオフ) Phase 0 完了条件を満たす

---

## 1. Claude API 利用箇所の全洗い出し

### 1.1 market-lens-ai バックエンド（SDK経由）

**中央クライアント:**
- [backends/market-lens-ai/web/app/anthropic_client.py](backends/market-lens-ai/web/app/anthropic_client.py) — Anthropic Python SDK ラッパー。リトライ3回、フォールバックモデル対応、出力截断検知あり。`max_tokens` デフォルト 4096、temperature 0.2
- [backends/market-lens-ai/web/app/llm_client.py](backends/market-lens-ai/web/app/llm_client.py) — Provider ルーティング層（現状 Claude-only。`normalize_provider` が常に `PROVIDER_ANTHROPIC` を返す。**シェルは存在するが中身が空**）

**呼び出し元 6箇所:**

| ファイル | 行 | 機能 | モダリティ |
|----------|-----|------|-----------|
| [web/app/analyzer.py](backends/market-lens-ai/web/app/analyzer.py) | L1910, L1994, L2018 | AI考察 narrative 生成 | text + multimodal |
| [web/app/banner_review_service.py](backends/market-lens-ai/web/app/banner_review_service.py) | L99, L126, L134 | バナーレビュー | multimodal → text fallback |
| [web/app/ad_lp_fit_service.py](backends/market-lens-ai/web/app/ad_lp_fit_service.py) | L102, L129, L137 | LP適合度評価 | multimodal → text fallback |
| [web/app/competitor_compare_service.py](backends/market-lens-ai/web/app/competitor_compare_service.py) | L127 | 競合比較レポート | text |
| [web/app/keyword_extractor.py](backends/market-lens-ai/web/app/keyword_extractor.py) | L194 | Discovery キーワード抽出 | text |
| [web/app/candidate_ranker.py](backends/market-lens-ai/web/app/candidate_ranker.py) | L340 | Discovery 候補ランキング | text |

### 1.2 ads-insights バックエンド（urllib 直実装）

- [backends/ads-insights/web/app/backend_api.py](backends/ads-insights/web/app/backend_api.py) L12924–L13340 — `_anthropic_generate()` 関数で **urllib ベース直接実装**（SDK 未使用、非同期未対応）
- Provider 分岐: `X-Analysis-Provider` ヘッダ → anthropic / google の切り替えロジックあり（L13093–13105）
- `NEON_MAX_OUTPUT_TOKENS` 環境変数対応、max_tokens 8192

### 1.3 プロンプト構造

| 特性 | 現状 |
|------|------|
| ターン数 | 単一ターン（user role のみ、system prompt 未使用） |
| 構成方式 | 動的組み立て（Pythonテンプレート + データ注入） |
| Prompt Caching | **未実装**（`cache_control` 利用なし）← 最大の最適化余地 |
| Function calling / Tool use | **未使用** |
| JSON強制 | banner/LP review のみ（`json` instruction をプロンプト末尾に付与） |

---

## 2. データコネクター・認証・マルチテナント

### 2.1 GA4 連携（BigQuery 経由）

- **連携方式**: GA4 Data API 直結ではなく **BigQuery エクスポートテーブル (`events_*`) をワイルドカードクエリ**で取得
- **クライアント**: [backends/ads-insights/bq/client.py](backends/ads-insights/bq/client.py) — シングルトン BigQuery クライアント
- **認証**: [backends/ads-insights/bq/auth.py](backends/ads-insights/bq/auth.py) — `GOOGLE_CREDENTIALS_JSON`（Base64エンコード SA キー）/ ADC フォールバック
- **クエリ種類**: [backends/ads-insights/bq/queries.py](backends/ads-insights/bq/queries.py) — 9種テンプレート（PV、流入チャネル、CV、検索クエリ、異常検知、LP別、デバイス、時間帯、ユーザー属性）
- **GCP プロジェクト**: `analyzedataplatform`（環境変数 `GCP_PROJECT_ID`）

### 2.2 DataProvider パターン（ads-insights）

[backends/ads-insights/web/app/data_providers/factory.py](backends/ads-insights/web/app/data_providers/factory.py) — `BaseDataProvider` 抽象クラス実装済み:

| Provider | ステータス |
|----------|-----------|
| `ExcelProvider` | 実装済み |
| `MockProvider` | 実装済み |
| `GA4Provider` | **TODO（未実装）** |
| EC Direct Provider | **未存在** |

`DATA_PROVIDER` 環境変数で切り替える Factory パターン。**EC Direct 追加は既存パターンを拡張するだけでよい。**

### 2.3 認証・マルチテナント

| 項目 | 現状 |
|------|------|
| 認証方式 | `X-API-Key` / Bearer Token（market-lens-ai の [auth.py](backends/market-lens-ai/web/app/auth.py:20-44)） |
| ユーザー識別 | `X-Insight-User` ヘッダ（`auth:` / `guest:` プレフィックス） |
| テナント分離 | **未実装**（DB テーブルに `tenant_id` / `client_id` カラムなし） |
| `X-Client-ID` | CORS 許可済みだが**バックエンドで未使用** |

---

## 3. レポート生成パイプライン

### 3.1 全体フロー（Discovery / 競合比較）

```
データ取得（HTML fetch, asyncio並列）
  ↓
抽出（extractor）+ 業界分類（classify_industry）
  ↓
競合候補検索（keyword_extractor → candidate_ranker）
  ↓
品質ゲート（quality_gate: 11項目決定論的チェック）
  ↓
AI narrative生成（call_anthropic → Markdown出力）
  ↓
ReportEnvelope v0（JSON side-channel: priority_actions / brand_evaluations）
```

- **非同期ジョブ**: [routers/discovery_routes.py](backends/market-lens-ai/web/app/routers/discovery_routes.py:269-432) で `asyncio.Task` 管理、タイムアウト 360秒
- **5段階フォールバック**: コンパクトモード → サイト数削減 → 軽量モデル（`_analysis_attempts()`）
- **PDF エクスポート**: [pdf_export_service.py](backends/market-lens-ai/web/app/pdf_export_service.py) — Playwright 経由

### 3.2 出力フォーマット

| 機能 | フォーマット |
|------|-------------|
| AI考察（ads-insights） | Markdown（5セクション必須） |
| 競合比較レポート | Markdown |
| Discovery レポート | Markdown + ReportEnvelope JSON（`REPORT_ENVELOPE_V0=true` 時） |
| バナーレビュー / LP適合度 | JSON structured output |
| PDF 出力 | Playwright export（オプション） |

**フロントエンド対応ページ:**
- `/ads/ai` → [src/pages/AiExplorer.jsx](src/pages/AiExplorer.jsx)
- `/discover` → [src/pages/Discovery.jsx](src/pages/Discovery.jsx)
- `/compare` → [src/pages/Compare.jsx](src/pages/Compare.jsx)

### 3.3 テスト基盤

| 項目 | 状況 |
|------|------|
| market-lens-ai tests | **77ファイル**（discovery pipeline / report envelope / quality pipeline 等） |
| ads-insights tests | 存在するが規模不明 |
| A/B比較フレームワーク | **未存在**（Phase 4 で要構築） |
| モックデータ | `src/pages/debug/fixtures/` に discovery-sample.js 等あり |

---

## 4. Open Questions 回答

ハンドオフドキュメントで「Phase 0 で解明すべき」とされた8項目への回答:

1. **EC Direct 側の API 仕様**: 未確認（社外システム）。`DataProvider` パターンで拡張可能な枠は整っておる
2. **Claude API 呼び出し箇所の数と粒度**: market-lens-ai 6箇所（`llm_client.py` 経由）+ ads-insights 1箇所（直実装）。**適度に集約されておるが統一されていない**
3. **Prompt caching 現状**: **全く使っていない**。stable なシステムプロンプト部分があるため、Context Caching 導入で 75%オフが狙える
4. **既存テスト基盤**: 77ファイル存在するが **A/B品質比較フレームワークはゼロから構築が必要**
5. **認証・マルチテナント**: 簡素な API キー認証のみ。**テナント分離は未実装**（EC Direct 連携時に設計必要）
6. **競合発見 / バナーレビュー の実装場所**: market-lens-ai の `candidate_ranker.py` / `banner_review_service.py`。**バナーレビューは multimodal 必須**
7. **Gemini Pro の併用方針**: バナーレビュー・LP適合度は画像入力ありのため **Flash でも動作するが Pro の方が品質高い**。Phase 2 の A/B で検証すべき
8. **月次レポート出力フォーマット**: Markdown 主体、ReportEnvelope JSON サイドチャネルあり、PDF エクスポート対応済み

---

## 5. Phase 1 以降の優先順位とリスク提案

### 推奨実施順

#### Phase 1+4（同時実装・Hard Requirement）: LLM Provider 抽象層 + 品質ログ機構

**優先度: 最高 / 工数: 中**

- `llm_client.py` は既にシェルが存在。`normalize_provider` を env var ベース分岐に置換するだけ
- `gemini_client.py` 新規作成（Vertex AI SDK、`call_gemini` / `call_gemini_multimodal`）
- market-lens-ai の 6箇所を `call_anthropic` → `call_llm` に置換
- ads-insights の urllib 直実装を SDK ベースに統一（**ここだけ工数大**）
- Alembic migration で `quality_log` テーブル追加
- 自動品質チェック（数値ハルシネーション検出、schema 違反、短すぎる出力）を LLM 呼び出し直後に挿入

**リスク:**
- ads-insights は urllib 直実装のため SDK 切替工数あり（低〜中リスク）
- Gemini の multimodal API は Anthropic と仕様が異なる（中リスク）

---

#### Phase 2: Gemini 3.1 Flash への移行検証・切替

**優先度: 高 / 工数: 中**

1. Claude 出力サンプル 10件以上を `quality-comparison/baseline-claude-{date}/` に凍結保存
2. `LLM_PROVIDER=gemini` で同一入力を Gemini 3.1 Flash で実行
3. ブラインド A/B 評価（峯林氏 + 不二樹氏）
4. 重大品質低下機能のみ個別に Pro 昇格 or Claude 残留判断
5. **Vertex AI Context Caching** を有効化（stable なシステムプロンプト部分で 75%オフ）
6. `render.yaml` の `LLM_PROVIDER` を `gemini` に切替

**リスク:**
- Discovery narrative（最も複雑なプロンプト）の品質低下 → **最大リスク**。長文・構造的 Markdown 生成は Claude が得意
- バナーレビューの multimodal 品質（Flash vs Pro）→ A/B で確認必要
- Vertex AI 設定（GCP SA、リージョン、API 有効化）の初期コスト

---

#### Phase 3: EC Direct コネクタ

**優先度: 中 / 工数: 大（外部依存あり）**

- `DataProvider` パターン拡張で `ECDirectProvider` 追加は設計上自然
- **ブロッカー: EC Direct API 仕様・認証方式が未確定**。Phase 3 開始前に EC Direct チームとの協議が必須
- マルチテナント（顧客データ分離）を DB レベルで設計する必要あり（現状ゼロから）
- 横断分析（GA4 × EC Direct）は `aggregate*` パイプラインの拡張で対応可

**リスク: 高（外部システム依存、テナント設計が必要）**

---

### リスクマトリクス

| リスク | 確率 | 影響 | 対策 |
|--------|------|------|------|
| Discovery narrative の品質低下 | 高 | 高 | Phase 2 で A/B 先行、問題機能のみ Claude 残留 |
| バナーレビューの multimodal 品質 | 中 | 中 | Flash/Pro の A/B 比較、必要なら Pro に昇格 |
| Vertex AI 初期設定 | 低 | 中 | GCP SA 作成・API 有効化は Phase 1 中に並行で進める |
| ads-insights urllib → SDK 書き換え | 中 | 低 | Phase 1 の ads-insights 側は後回し可（market-lens-ai を先行） |
| EC Direct API 仕様不明 | 高 | 高 | Phase 3 着手前に仕様確定を必須条件とする |
| マルチテナント設計複雑化 | 中 | 高 | Phase 3 の設計フェーズで時間を取る |

---

### 最大の Quick Win（Phase 1 と同時に実施推奨）

**Prompt Caching の導入**: 現状ゼロなのに、stable なシステムプロンプト部分が存在する。Anthropic prompt caching で最大 75%オフ、Gemini Context Caching でも同等。**Phase 1 の LLM 抽象層実装時に同時導入すると、移行コスト比較の baseline を改善できる。**

---

*Phase 1 開始前に確認を求めること（ハンドオフ指示に従い）*
