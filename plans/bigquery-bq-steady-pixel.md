# `/api/cases` invalid-token 時に 401 を返す対応プラン（案A）

## Context

Render 再デプロイのたびに ads-insights バックエンドの **インメモリ `_auth_tokens` dict が揮発** するため、ユーザの localStorage に残ったトークンはサーバ側で無効になる。しかし現状の `/api/cases` は未認証でも叩ける共用エンドポイントなので、invalid token を付けて呼ばれても **200 OK（ただし `dataset_id` を含まない）** を返してしまう。結果、フロントの `onAuthError → logoutAds → 再ログイン促し` フローが発火せず、ユーザ視点では「BQ接続が未設定になった／ステータスが変わった」等の表面的な表示崩れだけが見える。

この不一致を根本から塞ぐため、**`Authorization: Bearer <token>` ヘッダが付いている場合は必ずトークン検証し、無効なら 401 `Unauthorized` を返す**。ヘッダ無し（ログイン画面の `getCasesPublic()`）は従来通り 200 のまま。これによりセッション失効が即座に検知され、自動ログアウト & 再ログイン誘導が動く。

## 根本原因の整理

1. `_AUTH_PUBLIC_PATHS` に `/api/cases` が含まれている（[backend_api.py:1272](backends/ads-insights/web/app/backend_api.py#L1272)）
   - 理由: ログイン画面 `/cases` で未認証ユーザに案件一覧を見せる必要がある
2. `auth_middleware` はパブリックパスだと素通り（[backend_api.py:1323-1336](backends/ads-insights/web/app/backend_api.py#L1323-L1336)）
3. PR #30 で `/api/cases` ハンドラ自身がトークン検証するようになったが、**invalid token のときは `is_authenticated=False` として「200 + dataset_id なし」** にフォールバックしてしまう（[backend_api.py:2506-2535](backends/ads-insights/web/app/backend_api.py#L2506-L2535)）
4. フロント [adsInsights.js:311-313](src/api/adsInsights.js#L311-L313) の `getCases()` は `suppressAuthErrorHandler: true` を渡しているため、仮に 401 が返っても `onAuthError` は発火しない設計になっている

## 方針

- **バックエンド**: `Authorization` ヘッダが空 → 200 (公開挙動維持)、ヘッダ有り & invalid → 401、ヘッダ有り & valid → 200 + `dataset_id` 付き
- **フロント**: `getCases()` から `suppressAuthErrorHandler: true` を削除し、認証切れ時に `onAuthError` → `logoutAds()` → `setAuthExpiredMessage(...)` フローを走らせる
- `getCasesPublic()`（`skipAuth: true` で Authorization ヘッダを送らない）は **変更しない**。ログイン画面の案件一覧表示を壊さないため

## 変更ファイル

### 1. `backends/ads-insights/web/app/backend_api.py`

[backend_api.py:2506-2535](backends/ads-insights/web/app/backend_api.py#L2506-L2535) の `api_cases` を以下のように修正:

```python
@app.get("/api/cases")
def api_cases(request: Request):
    cases_master = _load_cases_master()

    auth_header = request.headers.get("Authorization", "")
    has_bearer = auth_header.startswith("Bearer ")
    token = auth_header.replace("Bearer ", "") if has_bearer else ""

    if has_bearer and not _validate_token(token):
        # 明示的にトークンを送っている ≒ 認証済みクライアントのつもり。
        # 無効ならセッション失効として 401 を返し、フロントの onAuthError を発火させる。
        return _json({"ok": False, "error": "Unauthorized"}, status=401)

    is_authenticated = bool(token)  # has_bearer かつ検証通過した場合のみ True

    cases = []
    for c in cases_master:
        if not c.get("is_active", True):
            continue
        entry = {
            "case_id": c["case_id"],
            "name": c.get("name", c["case_id"]),
            "description": c.get("description", ""),
            "is_internal": c.get("is_internal", False),
            "status": "active" if c.get("is_active", True) else "inactive",
        }
        if is_authenticated:
            entry["dataset_id"] = c.get("dataset_id", "")
        cases.append(entry)

    return _json({"ok": True, "cases": cases})
```

ポイント:
- `has_bearer` で「ヘッダがついているか」を明示判定（空文字トークンを誤って弾かないように）
- 401 レスポンスボディは **`{"ok": false, "error": "Unauthorized"}`** とし、`_auth_middleware` が返す形式（[backend_api.py:1334-1335](backends/ads-insights/web/app/backend_api.py#L1334-L1335)）と一致させる。これによりフロントの `isUnauthorizedErrorPayload()`（小文字 `"unauthorized"` を検知）が成立し、`error.isAuthError = true` になる
- `_AUTH_PUBLIC_PATHS` は **変更しない**。middleware 側でゲートすると Authorization ヘッダ無しのログイン画面アクセスも 401 になってしまうため、ハンドラ内で細粒度ゲートする

### 2. `src/api/adsInsights.js`

[adsInsights.js:311-313](src/api/adsInsights.js#L311-L313) の `getCases()` から `suppressAuthErrorHandler: true` を削除:

```javascript
/** GET /api/cases — 案件一覧 */
export function getCases() {
  return request('/cases')
}
```

- `getCasesPublic()`（[adsInsights.js:315-318](src/api/adsInsights.js#L315-L318)）は変更しない
- 削除後、invalid token 時は [adsInsights.js:208-214](src/api/adsInsights.js#L208-L214) のロジックで `error.isAuthError = true` となり、`onAuthError?.(error)` が呼ばれる
- `onAuthError` ハンドラ（[AuthContext.jsx:141-147](src/contexts/AuthContext.jsx#L141-L147)）が `logoutAds()` を叩き、`setAuthExpiredMessage('セッションの有効期限が切れました。再ログインしてください。')` を表示

### 3. テスト追加（任意・推奨）

`backends/ads-insights/tests/test_auth_security_followup.py` に 3 ケース追加:

```python
def test_api_cases_without_auth_returns_200_without_dataset_id(client):
    res = client.get("/api/cases")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    for case in body["cases"]:
        assert "dataset_id" not in case

def test_api_cases_with_invalid_token_returns_401(client):
    res = client.get("/api/cases", headers={"Authorization": "Bearer invalid_xxx"})
    assert res.status_code == 401
    body = res.json()
    assert body["ok"] is False
    assert body["error"].lower() == "unauthorized"

def test_api_cases_with_valid_token_returns_dataset_id(client, valid_token):
    res = client.get("/api/cases", headers={"Authorization": f"Bearer {valid_token}"})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    for case in body["cases"]:
        assert "dataset_id" in case
```

既存 `valid_token` fixture が無ければ `/api/auth/login` を叩いて取得するヘルパを追加。

## 既存資産の流用

- `_validate_token` — [backend_api.py:1262-1269](backends/ads-insights/web/app/backend_api.py#L1262-L1269)
- `_json` レスポンスヘルパ — `status=` 引数付きで 401 を返せる
- `isUnauthorizedErrorPayload` — [adsInsights.js:94-100](src/api/adsInsights.js#L94-L100)
- `onAuthError` / `logoutAds` / `setAuthExpiredMessage` — [AuthContext.jsx:111-147](src/contexts/AuthContext.jsx#L111-L147)

## 検証手順

1. **ユニットテスト**:
   `cd backends/ads-insights && python -m pytest tests/test_auth_security_followup.py -v`
   - 既存 21 ケース全 PASS
   - 追加 3 ケース全 PASS

2. **ローカル E2E**:
   - `./dev.ps1` で全サービス起動
   - Incognito タブで `/cases`（ログイン画面）を開き、案件一覧が表示される（未認証 200 維持）
   - 通常タブでログイン → `/projects` でサウルスジャパンが `CONNECTED (168テーブル)` 表示
   - DevTools Console で `localStorage.setItem('ads_auth_token', 'bogus_xxx')` → リロード
   - 期待動作: `/api/cases` が 401 を返し、自動的にログアウト & 「セッションの有効期限が切れました。再ログインしてください。」が表示される

3. **Render 本番検証**（CLAUDE.md「Vercel+Render 両方の稼働確認」遵守）:
   - PR マージ後、Render `market-lens-ai` のデプロイ完了を待つ
   - Vercel 本番 `insight-studio-chi.vercel.app` にアクセス
   - 手動で Render の「Manual Redeploy」を打ち、意図的に `_auth_tokens` を揮発させる
   - フロントが数秒以内に自動ログアウトして再ログイン画面に遷移することを確認
   - 再ログイン後、プロジェクト一覧が正しく表示される

4. **回帰観測**:
   - `getCasesPublic()` 経由のログイン画面アクセスが 401 にならないこと（`skipAuth` で Authorization ヘッダが付かないはず）
   - `CaseSelector.jsx` / `ProjectManagement.jsx` / `CaseManagement.jsx` の getCases 呼び出し点でハンドリングされない例外が発生しないこと（各呼び出しは `.catch` でエラー表示する既存ロジックが残るため安全）

## 想定しないリスク / 非対応項目

- トークンストアを persistent 化する対応（Redis 等）は **やらない**。今回のスコープは「失効を即座にユーザに見せる」ことに絞る
- 他エンドポイント（`/api/cases/login` など）の 401 挙動は既存 middleware 任せで変更しない
- フロントの `CaseSelector.jsx` 等は getCases の例外を個別に表示する既存ロジックに任せる（`onAuthError` が先に発火 → ログアウト → リロード後は再ログイン画面なので、二重エラー表示は実害ない）
