# market-lens-release-check

## 目的

Market Lens AI のリリース前品質ゲートを実行する skill。

## いつ使うか

- フェーズ完了時の検証
- staging deploy 前の最終チェック
- PR マージ前の品質確認

## チェックリスト

### 1. テスト
```powershell
.venv\Scripts\python -m pytest
```
- 全テストが PASS すること
- 新しいテストが追加されていれば実行確認

### 2. フロントエンドビルド
```powershell
npm run build
```
- エラーなくビルドが完了すること
- `dist/` に成果物が生成されること

### 3. ローカル起動確認
```powershell
.\scripts\boot.ps1
```
- backend が `localhost:8002` で応答すること
- frontend が `localhost:3001` で応答すること
- `/api/health` が `{"ok": true}` を返すこと

### 4. Staging スモーク（staging deploy 後のみ）
- staging URL で health check が通ること
- scan が 1 回成功すること
- history に結果が表示されること
- delete が動作すること

### 5. ドキュメント整合性
- README.md と実装が一致していること
- known limitations が明記されていること
- release note の抜け漏れがないこと

## 報告フォーマット

```
Release Check 結果
- pytest: PASS/FAIL (N tests)
- npm run build: PASS/FAIL
- local boot: PASS/FAIL
- staging smoke: PASS/FAIL/未実施
- doc consistency: PASS/FAIL
- blocking issues: (あれば記載)
```
