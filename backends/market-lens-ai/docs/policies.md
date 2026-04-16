# Market Lens AI — 運用ポリシー

## スキャン対象

- 公開ページのみ対象（SSRF防御によるプライベートIP除外）
- allowlist によるドメイン制限は廃止済み（内部ツール運用のため）
- 新規ドメインのスキャン時は `robots.txt` と利用規約を事前確認すること（運用ルール）

## URL 検証

- `http` / `https` スキームのみ許可（`ftp`, `javascript`, `file` 等は拒否）
- 1回のスキャンで最大 3 URL
- 重複 URL は拒否
- polite delay: URL 間に 2 秒の待機

## SSRF 防御

以下の宛先へのリクエストをブロック:

- `localhost` / `metadata.google.internal`
- プライベート IP（`10.x`, `172.16-31.x`, `192.168.x`）
- ループバック（`127.x`）
- リンクローカル（`169.254.x`）
- メタデータ IP（`169.254.169.254`）
- 予約済みアドレス

DNS 解決後の IP も検証し、DNS rebinding による SSRF を防止。

## データ保持

- HTML 全文は保存しない
- 保存対象: 抽出済み JSON / レポート MD / スクリーンショット PNG
- `data/scans/<run_id>/` 配下に格納
- `run_id` は UUID v4 形式で path traversal を防止
- 削除 API で個別削除可能

## XSS 防御

- フロントエンドの Markdown 表示は `DOMPurify.sanitize(marked.parse())` を通す
- `innerHTML` に未サニタイズ文字列を直接入れない
- ユーザー入力をそのまま DOM に挿入しない

## 現在の制限（MVP）

- 認証なし（内部利用前提）
- rate limit: インメモリ方式（プロセス再起動でリセット、分散環境非対応）
- CORS: `CORS_ORIGINS` 環境変数で設定（staging/prod ではフロントエンド URL を指定）
- マルチユーザー非対応
- 自動スケジューリング / 差分検知 / PDF出力は未実装
