# Compare/Scan 分析レポート品質改善 Phase 2

## Context

前回プラン（shimmering-wondering-fountain.md）のデプロイ後、本番環境で hits-online.jp vs cera.co.jp の Compare 分析レポートを実行し、広告運用プロフェッショナル視点でレビューした結果、以下の改善が確認できた一方、新たな品質問題が残存している。

### 前回改善で解決した問題
- レポートの途中切断（Completion Tokens 4096上限到達）→ 解消
- Hero Copy に「ようこそ ゲスト 様」混入 → 解消（ただし別の問題が残存）
- Main CTA が「取得不可」→ 解消（hits: 「見積もり依頼BOX」、cera: 「お客様窓口」を検出）
- モバイル最適化/価格戦略分析の欠如 → 追加された
- LP種別ベースのスコアキャリブレーション → 機能している（EC基準/コーポレート基準タグ付き）

### 残存する品質問題

| # | 問題 | 影響度 | 根本原因 |
|---|------|--------|---------|
| 1 | Hero Copy がナビラベル（hits: 「BRAND／ブランド」、cera: 「インスピレーション」） | CRITICAL | `_HERO_GARBAGE` にナビ構造ラベルが未登録 + h2/h3が p より先に検索される |
| 2 | 本文抜粋に検索ウィジェット混入（「TOP SEARCHES 検索数の多いワード...」） | HIGH | `_extract_body_snippet()` が `<aside>`・sidebar・widget クラスを除去していない |
| 3 | 抽出データが誤っている場合の LLM 対処ルールが不在 | HIGH | プロンプトに「取得不可」対処はあるが「誤データ」対処がない |
| 4 | FV訴求力: 1 がナビラベルに基づく不当な低評価 | HIGH | スコアリング時のデータ品質ガードなし |
| 5 | token_budget テストが stale（12288/5120 を期待するが実際は 4096） | LOW | ユーザーが意図的に 4096 に変更済み |

---

## 変更対象ファイル（market-lens-ai リポ）

| ファイル | 変更内容 |
|---------|---------|
| `web/app/extractor.py` | Hero Copy ナビラベル除外 + タグ検索順序変更 + 本文抜粋 widget 除去 |
| `web/app/analyzer.py` | データ品質アノテーション + プロンプト強化 |
| `tests/test_extractor.py` | Hero Copy ナビラベルテスト + body widget 除外テスト |
| `tests/test_analyzer.py` | 品質アノテーションテスト + stale token budget テスト修正 |

---

## Phase 1: Hero Copy 抽出精度改善（CRITICAL）

### 1A. ナビ構造ラベル専用フィルター追加

**ファイル**: `web/app/extractor.py` line 66 付近

既存の `_HERO_GARBAGE` は UI 操作語（ログイン、カート等）をフィルタする。これに加えて、**テキスト全体がナビ構造ラベルのみで構成されるケース**を弾く新規正規表現を追加:

```python
_HERO_NAV_LABELS = re.compile(
    r"^(?:BRAND|CATEGORY|RANKING|SHOP|COLLECTION|MENU|NEWS|ABOUT|"
    r"ブランド|カテゴリ|ランキング|新着|特集|お知らせ|"
    r"インスピレーション|コレクション|ショップ|"
    r"TOP SEARCHES|人気検索|検索数の多い)"
    r"(?:[／/\s　]*(?:BRAND|CATEGORY|RANKING|SHOP|COLLECTION|MENU|NEWS|ABOUT|"
    r"ブランド|カテゴリ|ランキング|新着|特集|お知らせ|"
    r"インスピレーション|コレクション|ショップ))*$",
    re.IGNORECASE,
)
```

**設計判断**: `_HERO_GARBAGE`（部分一致）とは別に `_HERO_NAV_LABELS`（完全一致）にすることで、「新ブランド誕生。世界を変えるプロダクト。」のような「ブランド」を含む正当なマーケティングコピーは弾かない。

### 1B. テキストタグ検索順序を p 優先に変更

**ファイル**: `web/app/extractor.py` line 80

```python
# Before
_HERO_TEXT_TAGS = ["h2", "h3", "p", "span", "div"]

# After
_HERO_TEXT_TAGS = ["p", "h2", "h3", "span", "div"]
```

**理由**: hero コンテナ内の `<p>` はマーケティングコピーの可能性が圧倒的に高い。日本の EC サイトでは `<h2>` がセクションラベル（「ブランド」等）として使われるパターンが多い。

### 1C. `_extract_hero_copy()` にナビラベルフィルター + nav 祖先チェック追加

**ファイル**: `web/app/extractor.py` line 83-91

```python
def _extract_hero_copy(soup: BeautifulSoup) -> str:
    for container_sel in _HERO_CONTAINERS:
        for tag_name in _HERO_TEXT_TAGS:
            sel = f"{container_sel} {tag_name}"
            for tag in soup.select(sel):
                if tag.find_parent("nav"):
                    continue
                text = tag.get_text(strip=True)
                if text and len(text) >= 8 and not _HERO_GARBAGE.search(text):
                    if _HERO_NAV_LABELS.match(text):
                        continue
                    return text
    return ""
```

### テスト（先に書く）

`tests/test_extractor.py` に `TestHeroCopyNavLabelExclusion` クラスを追加:

| テスト名 | 入力 HTML | 期待結果 |
|---------|----------|---------|
| `test_hero_rejects_brand_slash_label` | `<header><h2>BRAND／ブランド</h2><p>本格的なバスルーム製品をお届け</p></header>` | hero_copy = 「本格的なバスルーム製品をお届け」 |
| `test_hero_rejects_inspiration_label` | `<section class="hero"><h2>インスピレーション</h2><p>暮らしを彩る空間デザイン</p></section>` | hero_copy = 「暮らしを彩る空間デザイン」 |
| `test_hero_rejects_category_only` | `<header><h2>カテゴリ</h2></header>` | hero_copy = "" |
| `test_hero_accepts_brand_in_real_copy` | `<div class="hero"><p>新ブランド誕生。世界を変えるプロダクト。</p></div>` | hero_copy に「ブランド」を含む（正常） |
| `test_hero_skips_nav_ancestor` | `<header><nav><h2>ブランド一覧</h2></nav><p>素敵な暮らしをご提案します</p></header>` | hero_copy = 「素敵な暮らしをご提案します」 |
| `test_hero_p_preferred_over_h2` | `<div class="hero"><h2>SHOP</h2><p>高品質な製品を手頃な価格で</p></div>` | hero_copy = 「高品質な製品を手頃な価格で」 |

---

## Phase 2: 本文抜粋の widget 除去（HIGH）

### 2A. Phase 1 パス（main/article）に除去対象を追加

**ファイル**: `web/app/extractor.py` `_extract_body_snippet()` Phase 1（line 197-205 付近）

`script, style, noscript` に加えて以下を除去:
- `<aside>` 要素
- `<nav>` 要素（main 内のサブナビゲーション）
- `role="search"` / `role="complementary"` 要素
- `class` に `sidebar|widget|breadcrumb|search-box|search-form` を含む要素

### 2B. Phase 2 パス（body fallback）にも同じ除去を追加

**ファイル**: `web/app/extractor.py` `_extract_body_snippet()` Phase 2（line 207-219 付近）

既存の `nav/footer/role=navigation` 除去に追加:
- `<aside>` 要素
- `role="search"` / `role="complementary"` 要素
- `class` に `sidebar|widget|breadcrumb|search-box|search-form` を含む要素

### テスト（先に書く）

`tests/test_extractor.py` に `TestBodySnippetWidgetExclusion` クラスを追加:

| テスト名 | 入力 HTML | 期待結果 |
|---------|----------|---------|
| `test_body_excludes_aside` | `<body><aside>Sidebar</aside><p>Main content...</p></body>` | "Sidebar" を含まない |
| `test_body_excludes_search_widget` | `<body><div class="search-box">TOP SEARCHES...</div><p>本文</p></body>` | "TOP SEARCHES" を含まない |
| `test_body_excludes_breadcrumb` | `<body><div class="breadcrumb">ホーム > カテゴリ</div><p>説明文</p></body>` | "ホーム > カテゴリ" を含まない |
| `test_body_excludes_role_search` | `<body><div role="search">検索</div><p>コンテンツ</p></body>` | 検索フォームテキストを含まない |
| `test_main_excludes_aside_inside` | `<body><main><aside>Related</aside><p>[200+ chars]</p></main></body>` | "Related" を含まない |
| `test_main_excludes_nav_inside` | `<body><main><nav>Sub nav</nav><p>[200+ chars]</p></main></body>` | "Sub nav" を含まない |

---

## Phase 3: プロンプト品質強化（HIGH）

### 3A. `_format_site_data()` にデータ品質アノテーション追加

**ファイル**: `web/app/analyzer.py` line 15 付近

Hero Copy がナビラベルの可能性がある場合にインラインで注記を追加する軽量関数:

```python
import re as _re

_NAV_LABEL_CHECK = _re.compile(
    r"^(?:BRAND|CATEGORY|RANKING|SHOP|COLLECTION|MENU|NEWS|"
    r"ブランド|カテゴリ|ランキング|新着|特集|お知らせ|"
    r"インスピレーション|コレクション|ショップ)(?:[／/\s　]|$)",
    _re.IGNORECASE,
)

def _hero_copy_quality_note(hero: str) -> str:
    if not hero:
        return ""
    if len(hero) < 20 and _NAV_LABEL_CHECK.match(hero):
        return " 【注意: ナビゲーションラベルの可能性。本文抜粋を参照】"
    return ""
```

`_format_site_data()` の Hero Copy 行に付加:

```python
hero_note = _hero_copy_quality_note(data.hero_copy)
# ...
f"- **Hero Copy**: {data.hero_copy or '取得不可'}{hero_note}"
```

**設計判断**: ExtractedData モデルに新フィールドを追加しない（DB/API契約を変更しない）。アノテーションは `_format_site_data()` 内で生成してプロンプトにのみ影響させる。Phase 1 の抽出改善でほとんどのナビラベルは排除されるが、カバーしきれないケースに対する二重防御。

### 3B. `build_deep_comparison_prompt()` 注意事項セクション強化

**ファイル**: `web/app/analyzer.py` line 120-124

```python
## 注意事項
# 既存ルール（そのまま維持）
- 「取得不可」はHTML抽出の技術的制限であり...
# 追加
- Hero Copyに「【注意: ナビゲーションラベルの可能性】」タグがある場合、そのデータは信頼できない。FV訴求力は本文抜粋から推定し、スコアに「（本文推定）」タグを付与すること。ナビラベルを根拠にスコア1を付けてはならない
- 抽出データに品質問題がある項目（ナビラベル混入、ウィジェットテキスト混入等）は、D評価の根拠にしてはならない。代わりに本文抜粋・メタデータから推定し「（推定ベース）」タグを付与
```

### 3C. LP評価の基準セクションにデータ品質ガード追加

**ファイル**: `web/app/analyzer.py` line 126-130

```python
## LP評価の基準
# 既存（そのまま維持）
A: 業界トップ水準のCRO施策 / B: ...
# 追加
- 【スコアリング補正】抽出データに「【注意】」タグが含まれるフィールドは、当該スコアに「（データ制限）」タグを付与し、本文抜粋からの推定で再評価すること
```

### 3D. token_budget テスト修正

**ファイル**: `tests/test_analyzer.py` line 277-292

token_budget が 4096 に統一されたため、テストの期待値を修正:

```python
# test_multi_url_passes_12288_max_tokens → test_multi_url_passes_4096_max_tokens
assert mock_text.call_args[1]["max_output_tokens"] == 4096

# test_single_url_passes_5120_max_tokens → test_single_url_passes_4096_max_tokens
assert mock_text.call_args[1]["max_output_tokens"] == 4096
```

### テスト（先に書く）

`tests/test_analyzer.py` に `TestDataQualityAnnotations` クラスを追加:

| テスト名 | 入力 | 期待結果 |
|---------|------|---------|
| `test_nav_label_hero_gets_note` | hero_copy="BRAND／ブランド" | 出力に「ナビゲーションラベルの可能性」を含む |
| `test_normal_hero_no_note` | hero_copy="Transform your business" | 「注意」を含まない |
| `test_long_text_with_brand_no_note` | hero_copy="新ブランド誕生。世界を変えるプロダクト体験。" | 「注意」を含まない |
| `test_prompt_has_nav_label_rule` | 比較プロンプト生成 | 「ナビゲーションラベル」対処ルールを含む |
| `test_prompt_has_data_quality_guard` | 比較プロンプト生成 | 「データ制限」ガードを含む |

---

## 実装順序

```
テスト先行: Phase 1 テスト → Phase 1 実装 → Phase 2 テスト → Phase 2 実装 → Phase 3 テスト → Phase 3 実装
```

各 Phase はテストを先に書き、fail を確認してから実装する。

---

## 検証手順

### 1. ユニットテスト
```bash
cd "c:/Users/PEM N-266/work/market-lens-ai"
.venv/Scripts/python.exe -m pytest tests/test_extractor.py tests/test_analyzer.py -v
# → 全テスト PASS
```

### 2. 既存テストリグレッション確認
```bash
.venv/Scripts/python.exe -m pytest tests/test_extractor.py tests/test_analyzer.py -v
# → 既存 63 + 43 テストが全て PASS（+ 新規テスト約 17 個）
```

### 3. コミット & デプロイ
```bash
git add web/app/extractor.py web/app/analyzer.py tests/test_extractor.py tests/test_analyzer.py
git commit -m "fix: Compare report quality Phase 2 — hero nav filter + body widget cleanup + prompt quality guard"
git push origin main
```

### 4. 本番 E2E 確認（デプロイ後）
hits-online.jp + cera.co.jp で Compare 再実行し以下を確認:
- Hero Copy が「BRAND／ブランド」「インスピレーション」ではなく、実際のマーケティングコピーであること
- 本文抜粋が「TOP SEARCHES...」で始まらないこと
- FV訴求力スコアが 1 ではなく、本文ベースの合理的なスコアであること
- スコアに「（データ制限）」「（本文推定）」タグが必要に応じて付与されていること

---

## 明示的な非目標

- **token_budget 変更**: ユーザーが 4096 に意図的に設定済み。変更しない
- **timeout 増加**: ユーザーフィードバックで禁止
- **temperature 変更**: 根本原因は抽出品質であり、LLM サンプリング設定ではない
- **ExtractedData モデル変更**: 新フィールド追加しない。品質アノテーションは `_format_site_data()` 内で完結
- **Playwright ベース抽出**: 静的 HTML 抽出の範囲内で対処
