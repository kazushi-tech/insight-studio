---
name: ads-test
description: Testing skill for ads-insights project. This skill should be used when users want to run tests, verify KPI extraction, or test with mock data. Triggers on phrases like "テストを実行", "テストして", "動作確認", "モックデータでテスト".
---

# Ads Test

ads-insightsのテスト実行とモックデータでの検証を行うスキル。

## テストファイル一覧

| ファイル | 目的 |
|---------|------|
| `test_v2_5_basic.py` | KPI抽出の基本機能テスト |
| `test_v2_5_display.py` | 表示フォーマットと変化率計算テスト |
| `test_data_providers.py` | MockProvider/ExcelProviderのテスト |
| `test_kpi_aggregation.py` | KPI集計ロジックのテスト |
| `verify_insights.py` | AI考察生成の検証 |

## テスト実行方法

### 個別テスト

```powershell
python tests/test_v2_5_basic.py
python tests/test_v2_5_display.py
python tests/test_data_providers.py
```

### 全テスト一括実行

```powershell
.\scripts\run_tests.ps1
```

## MockProvider vs ExcelProvider

### MockProvider（デフォルト）

テストはデフォルトでMockProviderを使用。Excelファイル不要。

固定の期間データを返す:
- 月次: `2025-10`, `2025-11`, `2025-12`
- 週次: `2025-W47`, `2025-W48`

### ExcelProvider

実際のExcelファイルでテストする場合:

```powershell
# .env.localで設定
DATA_PROVIDER=excel
```

必要なファイル構造:
```
data/users/{user_id}/{client}/
├── 2025-11_report.xlsx
├── 2025-12_report.xlsx
└── ...
```

## UIテスト（手動）

```powershell
# モックデータでアプリを起動
# .env.localに DATA_PROVIDER=mock を設定

.\scripts\boot.ps1

# ブラウザで確認
# http://localhost:3000
```

確認項目:
1. 期間選択ドロップダウンが動作する
2. 比較期間が正しく表示される
3. チャートが描画される
4. AI考察が生成される

## よくあるテスト失敗

### ImportError

```
ModuleNotFoundError: No module named 'openpyxl'
```

解決: `pip install -r requirements.txt`

### AssertionError in test_v2_5_basic

KPI抽出ロジックの変更後に発生しやすい。
期待値を更新するか、抽出ロジックを修正。

### 環境変数の影響

`DEBUG_KPI_EXTRACTION=true` が設定されていると、
テスト出力にデバッグログが混ざる。テスト時はオフ推奨。

## テストカバレッジ

現在のテストは以下をカバー:
- KPI抽出（12種類のKPI）
- 変化率計算
- 期間タグ生成
- MockProvider/ExcelProviderの切り替え

カバーされていない領域:
- E2Eテスト（フロントエンド）
- AI考察の品質テスト
- 画像抽出
