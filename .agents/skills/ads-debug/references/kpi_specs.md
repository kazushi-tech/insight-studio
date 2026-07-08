# KPI_SPECS リファレンス

## 現在のKPI定義（12種類）

`web/app/kpi_extractor.py` で定義されている KPI_SPECS:

| Key | 表示名 | シノニム（一部） |
|-----|--------|-----------------|
| `cost` | 費用 | 費用, 広告費, ご利用金額, コスト, Cost, Spend |
| `impr` | 表示回数 | 表示回数, インプレッション, Imp, Impressions |
| `click` | クリック | クリック, クリック数, Clicks |
| `cv` | CV | CV, コンバージョン, 獲得, 成約, 購入完了件数 |
| `conversion_value` | CV値 | CV値, コンバージョン値, Conversion value |
| `revenue` | 売上 | 売上, 売上高, Revenue, Sales, 購入金額 |
| `ctr` | CTR | CTR, クリック率, Click through rate |
| `cvr` | CVR | CVR, コンバージョン率, 獲得率 |
| `cpa` | CPA | CPA, 獲得単価, Cost / conv. |
| `cpc` | CPC | CPC, クリック単価, Cost per click |
| `roas` | ROAS | ROAS, 広告費用対効果, 投資対効果 |
| `revenue_per_cv` | 売上単価 | 売上単価, 1件あたり売上, 売上/CV |

## 必須KPI

以下の3つは必須（欠けると抽出失敗）:
- `cost` - 費用
- `click` - クリック
- `cv` - コンバージョン

## シノニム追加の手順

### 1. 問題のExcelファイルを確認

debug_excel.pyを使用:
```powershell
python .claude/skills/ads-debug/scripts/debug_excel.py path/to/file.xlsx
```

### 2. 未マッチのカラム名を特定

出力例:
```
   [--] cv              -> NOT FOUND
   ...
   Unmatched Columns (potential new synonyms):
   [?]  Col 5: '購入完了件数'
```

### 3. KPI_SPECSに追加

`web/app/kpi_extractor.py` を編集:

```python
# Before
("cv", "CV", ["CV", "コンバージョン", "獲得", ...]),

# After
("cv", "CV", ["CV", "コンバージョン", "獲得", ..., "購入完了件数"]),
```

### 4. テストで検証

```powershell
python tests/test_v2_5_basic.py
```

## 注意事項

### 大文字/小文字

マッチングは **大文字小文字を区別しない**。
`"Cost"` と `"cost"` は同じシノニムとして扱われる。

### 部分一致ではない

完全一致のみ。`"広告費用"` は `"広告費"` にマッチしない。
必要なら両方をシノニムに追加する。

### 優先順位

同じ行に複数のKPIに該当する列がある場合、リストの先頭に近いシノニムが優先される。

## よく追加されるシノニム例

| KPI | よくある別名 |
|-----|-------------|
| cv | 申し込み件数, 購入完了件数, 成約件数, 予約件数 |
| cost | 消化金額, 利用金額, 出稿費 |
| impr | imp, 表示, 露出回数 |
| revenue | 売却金額, 総売上, 購入総額 |
