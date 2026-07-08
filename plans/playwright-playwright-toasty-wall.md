# Playwright 動作確認の導入プラン

## Context

これまで insight-studio では Playwright を使った動作確認を禁止していたが、「動作が早いし変更反映＋リグレッションを目視で確認したい」という要望に切り替え。以下を同時に満たす。

- UI/フロントエンドを変更したとき、Claude が port 3002 を立ち上げて画面を開き、変更の反映と関連画面の regression を確認してから完了報告するワークフローにする
- 新しい npm dev 依存は足さず、既にプラグインキャッシュにある **webapp-testing skill**（Python + Playwright sync API）をそのまま利用する
- 「必ず確認する」は hook で強制するのではなく、CLAUDE.md のルールとして Claude に守らせる（柔軟性重視）

## 採用する方針

| 項目 | 選択 |
|------|------|
| Playwright 実行手段 | `webapp-testing` skill（Python sync API） |
| 強制方法 | プロジェクト CLAUDE.md にルール追記 |
| スコープ | フロントエンド（port 3002）。変更箇所＋関連画面のリグレッション |
| npm 依存追加 | **なし**（`@playwright/test` は入れない） |

`.claude/settings.local.json` には既に `Bash(npx playwright:*)` と `Bash(python -m playwright install chromium)` が allow されているため、追加の permission 変更は不要。

## 変更内容

### 1. [CLAUDE.md](CLAUDE.md) にセクション追加

`## テスト` の直後に `## 動作確認（Playwright）` セクションを新設する。内容の趣旨：

- **対象:** `src/` 配下（React フロント）を変更したとき
- **やること:**
  1. `npm run build` で型・ビルド確認
  2. `npm run dev` を別プロセスで起動（port 3002）
  3. `webapp-testing` skill（`scripts/with_server.py` + Playwright sync API）で変更画面を開く
  4. 変更箇所の挙動を確認 + 隣接画面（Layout や共通コンポーネントを共有する画面）も1つ以上開いて regression 確認
  5. コンソールエラー／ネットワークエラーを `page.on('console', ...)` で拾って報告
- **対象外:** `backends/` のみの変更（pytest で足りる）、ドキュメントのみの変更
- **初回セットアップ:** `pip install playwright && python -m playwright install chromium`
- **タイムアウトの扱い:** `feedback_never_increase_timeouts` に従い、タイムアウトが出たら値を増やさず根本原因を探す

既存の `feedback_no_confirmation.md`（許可を求めず自律的に進める）との整合: このルールは「Claude が自律的に毎回やること」なので、ユーザーへの承認要求は不要。

### 2. 初回セットアップ手順の記載

`CLAUDE.md` の `## 標準コマンド` に以下を追記：

```bash
# 動作確認（Playwright、初回のみ）
pip install playwright
python -m playwright install chromium
```

### 3. 再利用する既存資産

- **webapp-testing skill:** `~/.claude/plugins/cache/anthropic-agent-skills/example-skills/<hash>/skills/webapp-testing/`
  - `scripts/with_server.py` — dev server ライフサイクル管理（複数サーバー対応）
  - `SKILL.md` — 使い方サンプル
- **Vite 設定:** [vite.config.js:19](vite.config.js#L19) — port 3002 固定、`/api/ml` `/api/ads` proxy 済み。バックエンド不要で画面確認したい場合は mock か、フロントだけ起動する

### 4. 作らないもの

- `playwright.config.js` — webapp-testing skill を使うので不要
- `tests/e2e/` ディレクトリ — 恒常的な E2E スイートは今回スコープ外（必要になったら別プランで `@playwright/test` 導入を検討）
- `package.json` への新 script — 追加しない
- `.claude/settings.json` の hook — 追加しない（今回は CLAUDE.md ルールのみ）

## 重要ファイル

- [CLAUDE.md](CLAUDE.md) — ルール追記先（唯一の変更ファイル）
- [.claude/settings.local.json](.claude/settings.local.json) — 既に Playwright 実行許可あり。変更不要
- [vite.config.js](vite.config.js) — port 3002・proxy 参照用。変更なし

## 検証方法

1. CLAUDE.md を更新する
2. 動作確認：ダミーの小さな UI 変更（例：[src/pages](src/pages) 配下の何かしらのページでタイトル文字列を変える）を Claude にやらせ、自発的に `npm run dev` を起動して Playwright で画面を開き、変更反映を報告するかを試す
3. 初回のみ `pip install playwright && python -m playwright install chromium` を走らせて Chromium が入ることを確認
4. `python scripts/with_server.py --server "npm run dev" --port 3002 -- python -c "from playwright.sync_api import sync_playwright; ..."` が通ることを1回手動で確認

## 今後の拡張（今回はやらない）

- E2E スイートが欲しくなったら `@playwright/test` を別途導入し `tests/e2e/` に配置
- hook で Stop 時に「Playwright 確認したか？」のリマインダーを出す運用も検討可能
- CI（Vercel / Render）での E2E 実行は別論点
