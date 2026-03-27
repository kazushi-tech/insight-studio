---
name: ads-debug
description: KPI extraction debugging skill for ads-insights project. This skill should be used when users report that KPIs are not being extracted from Excel files, when adding support for new Excel formats, or when debugging extraction issues. Triggers on phrases like "KPIが取れない", "新しいExcel形式", "抽出をデバッグ".
---

# Ads Debug

KPI抽出の問題をデバッグするためのスキル。新しいExcel形式への対応や抽出エラーの診断に使用する。

## デバッグワークフロー

### Step 1: 環境変数でデバッグモードを有効化

`.env.local`に以下を追加:

```
DEBUG_KPI_EXTRACTION=2
```

デバッグレベル:
- `0` = オフ
- `1` = エラーのみ
- `2` = 警告 + 列マッピング（推奨）
- `3` = 詳細すべて

### Step 2: アプリを再起動してログを確認

```powershell
.\scripts\boot.ps1
```

コンソールに以下のような診断メッセージが出力される:

```
[DEBUG] Column mapping:
  ✓ cost   -> 費用
  ✓ impr   -> インプレッション数
  ✗ cv     -> None
[DEBUG] ⚠ Unmapped important columns:
    - 購入完了件数
```

### Step 3: 未マッチの列名をKPI_SPECSに追加

[web/app/kpi_extractor.py](web/app/kpi_extractor.py) の `KPI_SPECS` リストに新しいシノニムを追加:

```python
KPI_SPECS = [
    ("cv", "CV", ["CV", "コンバージョン", ..., "購入完了件数"]),  # ← 追加
    ...
]
```

詳細は [references/kpi_specs.md](references/kpi_specs.md) を参照。

### Step 4: デバッグモードをオフにして検証

`.env.local`から`DEBUG_KPI_EXTRACTION`を削除（または`0`に設定）してアプリを再起動。

## スクリプト

### debug_excel.py

Excelファイルの構造を診断するスクリプト:

```powershell
python .claude/skills/ads-debug/scripts/debug_excel.py <path-to-excel>
```

出力例:
- シート一覧とヘッダー行の位置
- 検出されたKPIカラムとマッピング状況
- 未マッチのカラム警告

## よくある問題

### 「表示回数」が取れない

原因: 「インプレッション」「Imp」などの別名が使われている
解決: すでに対応済み。それ以外の名前なら`KPI_SPECS`に追加。

### CVが0になる

原因: CV列の名前が「購入完了件数」「申し込み件数」など
解決: `KPI_SPECS`のcv行にシノニムを追加。

### 特定のシートだけ読めない

原因: ヘッダー行の位置が異なる（1行目以外）
解決: `kpi_extractor.py`の`_find_header_row()`は最初の50行を検索するため、通常は自動検出される。検出されない場合はシート構造を確認。
