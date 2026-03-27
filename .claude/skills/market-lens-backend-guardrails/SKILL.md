# market-lens-backend-guardrails

## 目的

Market Lens AI のバックエンドにおけるセキュリティ・安定性・設定整合性を確認する skill。

## いつ使うか

- backend のコード変更をレビューするとき
- staging deploy 前のセキュリティチェック時
- 新しい API エンドポイントを追加するとき

## チェック項目

### SSRF 防御
- `policies.py` の validate_url が http/https のみ許可しているか
- localhost / private IP / link-local / metadata IP がブロックされるか
- DNS 解決後の IP も検証されているか

### Allowlist
- `config/domain_allowlist.json` に登録されたドメインのみ許可されるか
- サブドメインマッチングが正しく動作するか
- allowlist ファイルが存在しない場合に安全にフォールバックするか

### 入力検証
- URL 数が MAX_URLS (3) を超えないか
- 重複 URL が拒否されるか
- Pydantic v2 のバリデーションが適用されているか

### エラーハンドリング
- 例外時のレスポンス形式が統一されているか
- `GEMINI_API_KEY` 未設定時に分かりやすいエラーが出るか
- fetch 失敗時に部分結果を返せるか

### CORS / Config
- CORS 設定が staging/prod を想定しているか
- 環境変数の読み込み順序が明確か（`.env.local` > `.env`）

### Storage
- path traversal が防がれているか（run_id の検証）
- data/scans/ 配下のみに書き込むか
- delete 操作が正しく動作するか

## テスト要件

- `pytest` で全テストが通ること
- SSRF / allowlist / validation のテストカバレッジがあること
- mock を使って外部 API コールを避けること
