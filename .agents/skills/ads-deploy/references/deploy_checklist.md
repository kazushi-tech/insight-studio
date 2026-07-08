# デプロイ前チェックリスト

## 必須チェック項目

### 1. コードの状態

- [ ] すべての変更がコミット済み (`git status`でクリーン)
- [ ] mainブランチが最新 (`git pull origin main`)
- [ ] マージコンフリクトなし

### 2. テスト

- [ ] `test_v2_5_basic.py` - 基本KPI抽出テスト
- [ ] `test_v2_5_display.py` - 表示フォーマットテスト
- [ ] `test_data_providers.py` - データプロバイダーテスト

```powershell
python tests/test_v2_5_basic.py
python tests/test_v2_5_display.py
python tests/test_data_providers.py
```

### 3. ローカル動作確認

- [ ] アプリが起動する (`.\scripts\boot.ps1`)
- [ ] フロントエンドが表示される (http://localhost:3000)
- [ ] 期間選択が動作する
- [ ] AI考察が生成される

### 4. 環境変数

- [ ] `.env.local`のデバッグ設定がオフ
  - `DEBUG_KPI_EXTRACTION` が削除または `0`
  - `DATA_PROVIDER` が `excel` または未設定

## オプションチェック項目

### UI変更がある場合

- [ ] モバイルビューで表示崩れなし
- [ ] チャートが正しく描画される
- [ ] エラーメッセージが適切

### KPI抽出変更がある場合

- [ ] 既存のExcelファイルで動作確認
- [ ] 新しいシノニムが追加された場合、テストケース追加

### API変更がある場合

- [ ] エンドポイントのレスポンス形式確認
- [ ] エラーハンドリング確認

## コミットメッセージ規則

```
<type>: <description>

Types:
- feat: 新機能
- fix: バグ修正
- refactor: リファクタリング
- docs: ドキュメント
- test: テスト追加・修正
- chore: その他（ビルド設定など）
```

例:
```
feat: 媒体別KPI抽出の改善（V2.8）
fix: NaN/Inf値のJSON変換エラーを修正
```

## トラブルシューティング

### デプロイが失敗した場合

1. Vercelのビルドログを確認
2. 依存関係のバージョン問題をチェック
3. 環境変数が正しく設定されているか確認

### ローカルで動くが本番で動かない

1. 環境変数の差異をチェック
2. Python/Nodeのバージョン差異
3. ファイルパスの大文字/小文字（Vercelはケースセンシティブ）
