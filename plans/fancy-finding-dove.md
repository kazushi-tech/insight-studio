# Phase 3 Chrome DevTools 本番検証プラン

## Context

Phase 3（hero link exclusion + p-tag body extraction + prompt compression）を market-lens-ai にデプロイ済み。本番環境で実際に Compare 分析を実行し、修正が反映されていることを Chrome DevTools で検証する。

## 検証手順

### 1. Chrome ゲストモード起動

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --remote-debugging-port=9222 \
  --user-data-dir="/c/Users/PEM N-266/AppData/Local/Temp/chrome-guest-devtools" \
  --no-first-run \
  --guest \
  "https://insight-studio-ekrm8bhl3-kazushis-projects-49d4e473.vercel.app" &
sleep 5
```

### 2. MCP Chrome DevTools で接続確認

```bash
curl -s http://127.0.0.1:9222/json/version
```

### 3. Compare 分析実行

1. Discovery/Compare ページに移動
2. hits-online.jp と cera.co.jp を入力
3. Compare 実行 → レポート生成完了まで待機

### 4. 結果検証（3項目）

| # | 検証項目 | 期待結果 | 確認方法 |
|---|---------|---------|---------|
| 1 | Hero Copy hits | 「タオルバータオルリング」ではない | スクリーンショット + テキスト確認 |
| 2 | Hero Copy cera | 「セラトレーディングについて」ではない | スクリーンショット + テキスト確認 |
| 3 | 本文抜粋 hits | 「TOP SEARCHES」で始まらない | DevTools ネットワークログ |
| 4 | 本文抜粋 cera | 「GALLERY ギャラリー」で始まらない | DevTools ネットワークログ |
| 5 | Completion Tokens | 4096 未満で完結 | ネットワークレスポンス確認 |
| 6 | レポート途中切断なし | レポートが最後まで表示 | スクリーンショット確認 |

### 5. クリーンアップ

```bash
rm -rf "/c/Users/PEM N-266/AppData/Local/Temp/chrome-guest-devtools"
```
