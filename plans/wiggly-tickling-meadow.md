# Plan: brand_fetch バックエンドタイムアウト延長

## Context

Discovery Hubで `brand_fetch` ステージがタイムアウトし続けている。フロントエンド（Vercel）には自動リトライロジックを追加済みだが、バックエンド（Render）のタイムアウト値が原因なので何度リトライしても同じエラーになる。

**現状のタイムアウト構成**:
- バックエンド `brand_fetch_timeout`: 10秒（デフォルト）
- フロントエンド `STAGE_TIMEOUT_MS.brand_fetch`: 30秒
- `render.yaml` に `DISCOVERY_BRAND_FETCH_TIMEOUT_SEC` の設定なし（ハードコードデフォルト10秒が使われる）

**エラー**:
```
ブランドURLの取得に失敗 (stage=brand_fetch): https://www.muji.com: Timeout / https://muji.com: Timeout / 他2件
```

バックエンドが最大4つの候補URLを順に試すが、各URLに10秒しか許容しておらず、重いサイトでは全滅する。

---

## 修正内容

### 1. `render.yaml` にタイムアウト環境変数を追加

**ファイル**: [render.yaml](../market-lens-ai/render.yaml)（`c:/Users/PEM N-266/work/market-lens-ai/render.yaml`）

`envVars` セクションに以下を追加:

```yaml
      - key: DISCOVERY_BRAND_FETCH_TIMEOUT_SEC
        value: "30"
      - key: DISCOVERY_COMPETITOR_FETCH_TIMEOUT_SEC
        value: "20"
```

- `brand_fetch`: 10s → 30s（重いサイト対応）
- `competitor_fetch`: 12s → 20s（予防的延長）

### 2. バックエンドをRenderにデプロイ

`market-lens-ai` リポの変更をコミット → push → Render自動デプロイをトリガー。

---

## 変更ファイル一覧

| リポ | ファイル | 修正内容 |
|------|---------|---------|
| market-lens-ai | `render.yaml` | タイムアウト環境変数追加 |

## 検証方法

1. Renderでデプロイ完了を確認
2. Discovery Hubで muji.com などの重いサイトを入力
3. brand_fetchステージがタイムアウトせずに完了することを確認
4. フロントエンドの自動リトライも正常に発動することを確認（万が一のネットワーク一時障害時）
