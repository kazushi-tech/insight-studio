# 「セッションの有効期限が切れました」赤バナー多発 — 根本原因と対応

**Date:** 2026-04-20
**Status:** Plan（ユーザー承認待ち）
**Scope:** Phase A のみ（応急対応）

---

## 1. 現象

- 本番 `insight-studio-chi.vercel.app` で、ログイン直後〜数分後に「**セッションの有効期限が切れました。再ログインしてください。**」の赤バナーが出続ける
- DevTools Console には `/api/ads/bq/generate_batch` → **401** が連発、`/api/ads/cases/login` → **401** も出る
- 再ログインしても復旧しない（ユーザー報告）
- AI考察画面が「考察を生成中です... ✨」のスケルトンで止まるのも、この認証エラーで reportBundle が組めないため

**ユーザーの元質問「AI考察は本当にバックグラウンド処理されているのか」への回答:**
現時点で `neon/generate` は **同期 HTTP（120s timeout）** の実装で、バックグラウンド化は [設計書](./2026-04-20-ai-explorer-background-job-design.md) のみ存在し未実装じゃ。commit [ec6f2e9](https://github.com/…/pull/58) 本文にも「実装は後続PRで別途進める」と明記。**が、今回の画面ハングの主因はBG未実装ではなく認証の方じゃ。**

---

## 2. 根本原因 — 認証トークンが **インメモリ辞書** に保存されている

[backends/ads-insights/web/app/backend_api.py:1255-1289](../backends/ads-insights/web/app/backend_api.py#L1255-L1289):

```python
_auth_tokens: dict[str, float] = {}  # token -> expiry timestamp
_AUTH_TOKEN_TTL = 24 * 3600  # 24 hours

_device_trust_tokens: dict[str, tuple[str, float]] = {}  # token -> (case_id, expiry)
_DEVICE_TRUST_TTL = 14 * 24 * 3600  # 14 days
# コメント: "memory only, resets on restart (same trade-off as _auth_tokens)"
```

**両辞書ともサーバープロセスのメモリ内。プロセス再起動で完全消去される。**

### なぜ頻発しているか

本日 2026-04-20 だけで **5回の deploy** が走っている:

| Commit | 内容 |
|--------|------|
| 96d292a | TOTP 2FA 追加 |
| 0992dab | TOTP 有効化 |
| 0cdfe60 | TOTP revert |
| ec6f2e9 | AI Explorer freeze fix |
| a43f0ed | pyotp/qrcode 依存追加 |

deploy のたびに `market-lens-ai` サービスが再起動 → `_auth_tokens` 全消去 → 全クライアントが 401 → 赤バナー。加えて Render Starter の auto-restart も寄与する。

### 再ログインしても復旧しない理由（推定）

ユーザーが再ログインして新規トークンを取得 → ただし別タブや他機能で古いトークン（localStorage に残存）を送り続ける → その 401 を受けて `onAuthError` が発火し、新規で取得したばかりのトークンも **巻き添えで破棄** される可能性。これは [src/api/adsInsights.js:210](../src/api/adsInsights.js#L210) の 401 ハンドラが「どのリクエストで 401 が起きたか」を問わず一律ログアウト扱いする作りのため。

もしくは、`isAuthError` 判定の `isUnauthorizedErrorPayload(body)` 条件によって、サーバーが返すエラー本文の形式次第ですり抜けが起きている可能性もある（要検証）。

---

## 3. 提案 — Phase A 応急対応（JWT 化）

### 方針: **インメモリ辞書を JWT（ステートレス）に置き換える**

JWT 化により:
- サーバー再起動してもトークンが有効
- disk / DB 追加不要（JWT_SECRET 環境変数のみ）
- 既存の `market-lens-ai` RBAC 用に [render.yaml:79](../render.yaml#L79) で `JWT_SECRET` が既に設定されている → 流用可

### 変更内容

#### 3.1 バックエンド

[backends/ads-insights/web/app/backend_api.py](../backends/ads-insights/web/app/backend_api.py)

**追加:** ファイル冒頭付近で `import jwt` (既に `requirements.txt` に `PyJWT` あれば使う。無ければ追加)

**置き換え:** Lines 1255-1289 のトークン関数を JWT 化

```python
import os, jwt, secrets

_JWT_SECRET = os.environ.get("JWT_SECRET") or secrets.token_urlsafe(64)
_JWT_ALG = "HS256"
_AUTH_TOKEN_TTL = 24 * 3600
_DEVICE_TRUST_TTL = 14 * 24 * 3600

def _generate_auth_token() -> str:
    payload = {
        "typ": "auth",
        "exp": int(time.time()) + _AUTH_TOKEN_TTL,
        "jti": secrets.token_urlsafe(8),
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALG)

def _validate_token(token: str) -> bool:
    try:
        payload = jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALG])
        return payload.get("typ") == "auth"
    except jwt.InvalidTokenError:
        return False

def _generate_device_trust_token(case_id: str) -> str:
    payload = {
        "typ": "device_trust",
        "case_id": case_id,
        "exp": int(time.time()) + _DEVICE_TRUST_TTL,
    }
    return jwt.encode(payload, _JWT_SECRET, algorithm=_JWT_ALG)

def _validate_device_trust_token(token: str, case_id: str) -> bool:
    try:
        payload = jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALG])
        return payload.get("typ") == "device_trust" and payload.get("case_id") == case_id
    except jwt.InvalidTokenError:
        return False
```

**削除:** `_auth_tokens` / `_device_trust_tokens` 辞書および関連コード。

**互換性:** 既に配られている旧トークン（URL-safe ランダム文字列）は JWT として decode に失敗し、`_validate_token → False` となる。これにより「deploy 直後は全員もう一度ログイン」が 1 回だけ必要になる（既に起きていることと同じ）。以降は deploy しても維持される。

**JWT_SECRET 環境変数:**
- Render Dashboard に既に `JWT_SECRET` が設定されているなら利用
- 未設定なら Render にランダム値を投入（secrets.token_urlsafe(64) で生成、運用者が一度だけセット）

#### 3.2 フロントエンド — 401 の暴走止め（最小 diff）

[src/api/adsInsights.js:210](../src/api/adsInsights.js#L210)

**問題:** 現在の 401 ハンドラは `isAuthError=true` で `onAuthError` を発火、AuthContext がトークンを破棄。ただしこれが別のリクエスト（例: Discovery 409、background poller）の 401 で発火すると、**ログイン直後の新規トークンも消える**。

**修正:** `onAuthError` の発火を、「**AuthContext に保存中のトークンがそのリクエストで送られていた** かつ **401**」に限定する。ただし [src/contexts/AuthContext.jsx:144](../src/contexts/AuthContext.jsx#L144) の挙動を確認し、token ref が stale でないことも確認。

具体的には:
- `didSendAuth && res.status === 401` のときのみ `onAuthError` 発火
- `isUnauthorizedErrorPayload(body)` のゆるい AND 条件を維持
- ただしリクエストヘッダの `X-Case-Token` が現在の `authToken` と一致する場合のみ、との追加条件を足す

**補足:** この FE 修正は BE の JWT 化が入れば発火頻度自体が減るので副次的。優先度は低い。まず BE JWT 化だけで様子見。

#### 3.3 Discovery 409 の副作用止め（任意・後回し可）

[src/contexts/AnalysisRunsContext.jsx](../src/contexts/AnalysisRunsContext.jsx) の Discovery poller が `/ads/ai` 画面でも動き続けている件は、本件とは独立。コンソールノイズ減らしたい場合のみ別途対応。今回の PR スコープ外とする。

---

## 4. Critical Files（本PRで触る）

| File | 変更 |
|------|------|
| [backends/ads-insights/web/app/backend_api.py](../backends/ads-insights/web/app/backend_api.py) | Lines 1255-1289 を JWT 関数に置換。PyJWT import 追加 |
| [backends/ads-insights/requirements.txt](../backends/ads-insights/requirements.txt) | `PyJWT>=2.8.0` 追加（既にあれば不要） |
| [backends/market-lens-ai/requirements.txt](../backends/market-lens-ai/requirements.txt) | 同上（デプロイされるのは market-lens-ai 側なので要確認） |
| （FE 修正）[src/api/adsInsights.js](../src/api/adsInsights.js) | Lines 203-218 の 401 ハンドラ条件 | 

## 5. 既存コード再利用

- `JWT_SECRET`: [render.yaml:79](../render.yaml#L79) で既に定義済み、Render Dashboard から取得可
- market-lens-ai の RBAC 側で既に JWT 利用中（[src/api/adsInsights.js:425](../src/api/adsInsights.js#L425) の `/api/auth/login-email`）: 同じ `JWT_SECRET` を使えば署名互換

## 6. Verification

### ローカル
- [ ] `cd backends/ads-insights && python -m pytest` — 既存のauth系テストが通る
- [ ] uvicorn で起動 → `/api/auth/login` → トークン取得 → プロセス再起動 → トークン送信 → 200 が返る（JWT なので）
- [ ] 期限切れトークン（手動で `exp` を過去にセット）→ 401

### ステージ
- [ ] Render に deploy → 本番 URL で案件ログイン
- [ ] Render Dashboard で「Manual Deploy」を打って再起動 → **赤バナーが出ずにそのまま使える** こと
- [ ] `/ads/ai` アクセス → reportBundle 読み込み → 「昨日の結果を教えて」→ 120秒以内に応答

### ブラウザ
- [ ] localStorage の古いトークンが残っている状態で初回アクセス → 自動的に 401 → ログイン画面 → 再ログインで JWT トークン取得 → 以降 deploy しても維持

## 7. リスク

| リスク | 緩和 |
|--------|------|
| JWT_SECRET が未設定で起動失敗 | fallback に `secrets.token_urlsafe(64)` を使うが、これだとプロセスごとに違う値になる → 起動時に環境変数必須化。未設定なら RuntimeError を上げる |
| 旧トークンが無効化される副作用 | 全ユーザー 1 回だけ再ログイン必要（既に起きていることと同じ） |
| PyJWT が未インストール | requirements.txt で固定、deploy 時に自動インストール |

---

## 8. Phase B（本PRスコープ外）

AI Explorer のバックグラウンドジョブ化: [plans/2026-04-20-ai-explorer-background-job-design.md](./2026-04-20-ai-explorer-background-job-design.md) を別PRで実装。本件（赤バナー問題）とは独立。
