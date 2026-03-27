---
name: devtools-verify
description: Chrome DevToolsでUIを検証するスキル。必ずゲストモード（クリーンなlocalStorage）でChromeを起動してから確認する。「DevToolsで確認」「ブラウザ確認」「UI検証」「画面チェック」等でトリガー。
---

# DevTools Verify

Chrome DevToolsを使ってUIの動作確認・スクリーンショット取得を行うスキル。
**必ずゲストモード（隔離されたプロファイル）で起動する**ことで、localStorageやキャッシュの影響を排除した状態でテストする。

## 起動手順

### 1. Vite dev serverの起動確認

```bash
# すでに起動済みか確認
curl -s http://localhost:3000 > /dev/null 2>&1 && echo "Running" || echo "Not running"

# 起動していない場合
cd /c/Users/"PEM N-266"/work/ads-insights && npx vite --port 3000 &
```

### 2. Chrome をゲストモードで起動

**重要**: 必ず `--user-data-dir` で一時ディレクトリを指定し、`--guest` フラグを付ける。
これにより既存のChromeプロファイル（localStorage、Cookie、拡張機能等）の影響を完全に排除する。

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --remote-debugging-port=9222 \
  --user-data-dir="/c/Users/PEM N-266/AppData/Local/Temp/chrome-guest-devtools" \
  --no-first-run \
  --guest \
  "http://localhost:3000" &
sleep 5
```

### 3. 接続確認

```bash
curl -s http://127.0.0.1:9222/json/version
```

成功すれば `Browser`, `Protocol-Version` 等のJSONが返る。

### 4. MCP Chrome DevTools で操作

- `list_pages` → ページ一覧
- `take_screenshot` → スクリーンショット取得
- `take_snapshot` → A11Yツリー取得（UIの構造確認）
- `evaluate_script` → JavaScript実行（localStorage確認等）
- `click` / `fill` → 操作テスト

### 5. 検証後のクリーンアップ

検証が終わったら一時ディレクトリを削除する:

```bash
rm -rf "/c/Users/PEM N-266/AppData/Local/Temp/chrome-guest-devtools"
```

## チェックリスト（共通）

- [ ] コンソールにエラーがないか（`list_console_messages`）
- [ ] テーマ切替が正常に動作するか
- [ ] レスポンシブ（モバイル表示）が崩れていないか
- [ ] localStorage永続化が動作しているか
- [ ] ネットワークリクエストにエラーがないか（`list_network_requests`）

## 注意事項

- 既存のChromeが9222ポートを使用している場合は別ポートを指定: `--remote-debugging-port=9223`
- ゲストモードは初回訪問と同じ状態を再現できるため、デフォルト値の確認に最適
- スクリーンショットは `verify_output/` ディレクトリに保存する
