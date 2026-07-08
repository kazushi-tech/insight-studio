# Claude Code をスマホから触れるようにする (Remote Control セットアップ)

## Context

ユーザー（sgaku3154@gmail.com）は Windows 11 Pro 上の VSCode 拡張で Claude Code を利用中。外出先や PC から離れた状態でも、手元のスマホから insight-studio プロジェクトのセッションを操作したい。

Claude Code 公式の **Remote Control** 機能を使えば、ローカルマシンで走るセッションを claude.ai/code または Claude モバイルアプリ経由でリモート操作できる。ローカルのファイルシステム・MCP サーバー・プロジェクト設定はすべてそのまま使えるため、クラウドにコードを送る必要がない。

### 前提確認（既に満たしている）

- Claude Code バージョン: `2.1.116` (必要 v2.1.51 以上 → OK)
- `claude remote-control` サブコマンド存在確認済み
- claude.ai アカウントでログイン済み想定（Max プラン）

## 推奨アプローチ

**ローカル PC で `claude remote-control` を常駐させ、スマホ側の Claude アプリ or ブラウザから接続する**のが最もシンプル。

### 手順

#### 1. スマホ側の準備

- **iOS:** App Store で「Claude by Anthropic」を検索してインストール → claude.ai アカウントでログイン
- **Android:** Google Play で「Claude by Anthropic」を検索してインストール → 同上
- **ブラウザ派:** スマホで `https://claude.ai/code` を開いてログインするだけでも可

#### 2. ローカル PC で Remote Control サーバー起動

PowerShell か bash で、プロジェクトルートに移動してから以下を実行:

```bash
cd "c:\Users\PEM N-266\work\insight-studio"
claude remote-control --name insight-studio
```

- `--name` でスマホ側の一覧に表示される名前を設定（省略時はホスト名）
- 起動すると **セッション URL と QR コード** が表示される
- このターミナルは閉じずにそのまま置いておく（閉じると接続が切れる）

#### 3. スマホからペアリング

以下のいずれかで接続:

- **(A) QR スキャン:** Claude モバイルアプリの Remote Control セクションで PC 画面の QR をスキャン
- **(B) 一覧から選択:** スマホの claude.ai/code を開く → Remote Control セッション一覧から `insight-studio` を選択
- **(C) URL 直接:** 表示された URL をスマホのブラウザで開く

#### 4. 動作確認

スマホから「このプロジェクトの CLAUDE.md を見せて」などと入力し、ローカルの `CLAUDE.md` が読めれば成功。

### オプション: permission mode を明示する

編集権限をどうするかはスマホから操作する以上、事前に決めておくとよい:

```bash
# 読み取り中心にしたい場合（安全）
claude remote-control --name insight-studio --permission-mode plan

# 編集まで許可したい場合
claude remote-control --name insight-studio --permission-mode acceptEdits
```

権限モード一覧: `acceptEdits`, `auto`, `bypassPermissions`, `default`, `dontAsk`, `plan`

### オプション: 常駐させたい場合

- Windows では `claude remote-control` をスタートアップフォルダに登録するか、タスクスケジューラで「ログオン時」に起動するよう設定可能
- ただし PC スリープ時は接続断するため、**電源オプションで「スリープしない」**に変更しておくと安定する
- ネットワーク切断は 10 分までなら自動再接続される

## 注意点・制約

| 項目 | 内容 |
|------|------|
| プラン要件 | Pro / Max / Team / Enterprise のいずれか（API キー単体では不可） |
| 認証 | `claude auth login` で claude.ai OAuth ログインが必要 |
| スリープ | PC がスリープに入ると切断。復帰後は再接続されるが不安定なら電源設定変更推奨 |
| 通信 | 全て Anthropic API 経由の TLS 暗号化、アウトバウンド HTTPS のみ（ポート解放不要） |
| 同時接続 | 複数デバイスから同じセッションに接続可能、会話は自動同期 |
| 停止方法 | ローカルの `claude remote-control` ターミナルで Ctrl+C |

## 検証方法

1. ローカルで `claude remote-control --name insight-studio-test` を起動
2. 表示された QR またはセッション一覧からスマホで接続
3. スマホから以下を試す:
   - `git status` の実行依頼 → ローカルの branch 情報が返るか
   - `src/App.jsx` を表示 → ファイル内容が見えるか
   - 短い編集依頼（例: コメント追加）→ permission mode に応じて挙動確認
4. 接続を切って再度繋ぎ直し、会話履歴が残っているか確認
5. Ctrl+C でサーバー停止、スマホ側で「オフライン」表示になるか確認

## 参考リンク

- [Remote Control 公式ドキュメント](https://code.claude.com/docs/en/remote-control.md)
- [Claude Code 認証設定](https://code.claude.com/docs/en/setup)
- [claude.ai/code Web UI](https://claude.ai/code)
