# 案件ログインに TOTP（Google Authenticator）2 要素認証を追加

## Context

現状の案件ログインは `case_id`（URL等から容易に推測可能・公開情報）＋ **パスワード単体**（bcrypt）だけで認証しており、顧客提出シナリオではパスワード漏洩 = 即突破のリスクがある。

- 現状: [backends/ads-insights/web/app/backend_api.py:2569-2624](backends/ads-insights/web/app/backend_api.py#L2569-L2624) — `/api/cases/login` は `bcrypt.checkpw()` のみで認証
- 案件定義: [backends/ads-insights/cases/cases.json](backends/ads-insights/cases/cases.json) — `password_hash` のみ保持、2FA 設定なし
- フロント: [src/components/CaseAuthModal.jsx](src/components/CaseAuthModal.jsx) — パスワード1入力フィールドのみ
- 認証トークン: [backends/ads-insights/web/app/backend_api.py:1254-1269](backends/ads-insights/web/app/backend_api.py#L1254-L1269) — メモリ内 dict、TTL 24h

**ゴール:**
1. 全案件を **パスワード + TOTP（6 桁コード）** の 2 要素認証に移行する
2. 一度 TOTP 認証に成功したデバイスは **14 日間は TOTP 入力をスキップ**（パスワードのみで再ログイン可）。運用してみて長短感じたら定数 1 行で調整可能
3. 案件セットアップ時に管理者が QR コードを取得 → 顧客が Google Authenticator 等でスキャン

## Approach

### 全体フロー

```
初回ログイン（または信頼期限切れ）:
  [フロント] パスワード入力 → [バック] bcrypt 検証 OK
  → [バック] "totp_required": true を返却
  → [フロント] TOTP 6 桁入力フォーム表示
  → [バック] pyotp で検証 OK
  → [バック] auth_token (24h) + device_trust_token (30d) を返却
  → [フロント] 両方を localStorage に保存

2 回目以降（30日以内）:
  [フロント] パスワード + device_trust_token を送信
  → [バック] bcrypt 検証 + trust_token 検証 OK
  → [バック] auth_token のみ返却（TOTP スキップ）
```

### バックエンド変更

**1. 依存追加** — [backends/ads-insights/requirements.txt](backends/ads-insights/requirements.txt)
```
pyotp>=2.9.0
qrcode[pil]>=7.4.0
```

**2. cases.json スキーマ拡張** — [backends/ads-insights/cases/cases.json](backends/ads-insights/cases/cases.json)
```json
{
  "case_id": "saurus_japan",
  "password_hash": "$2b$12$...",
  "totp_secret": "JBSWY3DPEHPK3PXP",   // pyotp.random_base32() で発行
  "totp_enabled": true,                 // 段階移行用フラグ
  ...
}
```

**3. 認証エンドポイント改修** — [backends/ads-insights/web/app/backend_api.py](backends/ads-insights/web/app/backend_api.py)

- `/api/cases/login`（L2569 既存を拡張）
  - リクエスト: `{ case_id, password, totp_code?, device_trust_token? }`
  - パスワード OK → `device_trust_token` が有効ならそのまま `auth_token` 発行
  - それ以外 → `totp_code` を `pyotp.TOTP(secret).verify(code, valid_window=1)` で検証
  - TOTP 未入力なら `{ ok: false, totp_required: true, case_id, name }` を返却（パスワードは正しい旨も示す）
  - TOTP OK → 新しい `device_trust_token`（30 日）＋ `auth_token`（24h）を発行
- 新 `_device_trust_tokens: dict[str, tuple[str, float]]`（token -> (case_id, expiry)）をメモリ保持
  - 再起動でリセットされる件は既存 `_auth_tokens` と同じ運用。案件セッションは既に 24h なので許容
  - 将来 Redis 移行時はここを差し替え
- TOTP レート制限: 既存 `_login_failures` 仕組み（L1274-1296）を TOTP 失敗にも適用し、IP 単位で 5 回失敗 → 10 分ロック

**4. QR コード発行エンドポイント新設** — 管理者用
- `POST /api/cases/{case_id}/totp/setup` — `totp_secret` を新規発行 → `otpauth://` URI と QR 画像（base64 PNG）を返却
- 認証: 既存 admin トークン（`_AUTH_PASSWORD` ログイン経由）を要求。案件パスワード単体では叩けない
- 実行後は管理者が `cases.json` の `totp_secret` を手動で更新＋ `totp_enabled: true` 化

### フロントエンド変更

**5. `CaseAuthModal` を 2 段階化** — [src/components/CaseAuthModal.jsx](src/components/CaseAuthModal.jsx)
- step 1: パスワード入力（既存 UI 流用）→ 送信時にサーバーから `totp_required` を受けた場合は step 2 へ
- step 2: 6 桁コード入力（`inputMode="numeric"`, `autocomplete="one-time-code"`, `maxLength=6`）
- TOTP 成功後にサーバーが返す `device_trust_token` を保存 → 次回はこれを送って TOTP スキップ

**6. API クライアント拡張** — [src/api/adsInsights.js:321-332](src/api/adsInsights.js#L321-L332)
- `loginCase(caseId, password, totpCode?, deviceTrustToken?)` のシグネチャに引数追加
- `device_trust_token` 永続化: `localStorage` キー `is_case_trust_{case_id}`（案件ごと）

**7. AuthContext の更新** — [src/contexts/AuthContext.jsx:89-104](src/contexts/AuthContext.jsx#L89-L104)
- `handleLoginWithCase` に trust token 読み書きロジックを追加
- ログアウト時は `auth_token` のみ削除、`device_trust_token` は保持（Google 等と同じ挙動）
- 明示的な「このデバイスから信頼を解除」UI は別タスク（Phase 2）として保留

### 運用・移行

- **段階移行:** 各案件は `totp_enabled: false` で現状維持可能。管理者が QR 発行 → 顧客にスキャン依頼 → `totp_enabled: true` に切替、という順で 1 案件ずつ移行
- **顧客への案内文書:** Google Authenticator / 1Password / Authy のいずれかを推奨。`plans/` とは別に `docs/` 配下にユーザーガイド作成（本計画のスコープ外、別タスク）
- **初回の secret 配布:** QR コードを Slack DM 等で直接共有。cases.json に入った後は secret は平文で持つが、bcrypt password との併用で実質 2 要素は維持される（pyotp の secret 漏洩だけでは突破不可）

## 重要ファイル

| ファイル | 役割 |
|---|---|
| [backends/ads-insights/web/app/backend_api.py:2569-2624](backends/ads-insights/web/app/backend_api.py#L2569-L2624) | `/api/cases/login` 改修 |
| [backends/ads-insights/web/app/backend_api.py:1244-1296](backends/ads-insights/web/app/backend_api.py#L1244-L1296) | トークン管理・レート制限の参照 |
| [backends/ads-insights/cases/cases.json](backends/ads-insights/cases/cases.json) | `totp_secret`, `totp_enabled` 追加 |
| [backends/ads-insights/requirements.txt](backends/ads-insights/requirements.txt) | `pyotp`, `qrcode` 追加 |
| [src/components/CaseAuthModal.jsx](src/components/CaseAuthModal.jsx) | 2 段階 UI |
| [src/api/adsInsights.js:321-332](src/api/adsInsights.js#L321-L332) | `loginCase` 引数拡張 |
| [src/contexts/AuthContext.jsx:89-104](src/contexts/AuthContext.jsx#L89-L104) | `device_trust_token` 永続化 |

## 再利用する既存機構

- **bcrypt 検証:** [backend_api.py:2610](backends/ads-insights/web/app/backend_api.py#L2610) の `bcrypt.checkpw` パターンをそのまま使用
- **ブルートフォース対策:** [backend_api.py:1274-1296](backends/ads-insights/web/app/backend_api.py#L1274-L1296) の `_login_failures` / `_is_login_locked` を TOTP 検証経路にも流用
- **トークン発行:** [backend_api.py:1257-1260](backends/ads-insights/web/app/backend_api.py#L1257-L1260) の `_generate_auth_token` を参考に `_generate_device_trust_token(case_id)` を並行実装
- **localStorage 永続化:** [AuthContext.jsx:10-19](src/contexts/AuthContext.jsx#L10-L19) の `STORAGE_KEY_TOKEN` パターンに `STORAGE_KEY_CASE_TRUST_PREFIX` を追加

## 検証方法

### ローカル単体
1. `cd backends/ads-insights && pip install -r requirements.txt` で `pyotp`, `qrcode` 導入
2. `python -c "import pyotp; print(pyotp.random_base32())"` で試験用 secret を発行し、`cases.json` の 1 案件に投入 → `totp_enabled: true`
3. `./dev.ps1` で全サービス起動
4. Google Authenticator に `otpauth://totp/InsightStudio:saurus_japan?secret=...&issuer=InsightStudio` 相当の URI を登録（手打ちでも OK）

### E2E シナリオ（`webapp-testing` skill で自動化）
- **シナリオ A（初回ログイン）:** パスワード入力 → TOTP 画面表示 → Authenticator の 6 桁コード入力 → ログイン成功 → `localStorage.is_case_trust_saurus_japan` が入っている
- **シナリオ B（30 日以内の再ログイン）:** ブラウザを閉じる → 再度開く → パスワードだけで即ログイン成功（TOTP 画面出ない）
- **シナリオ C（他デバイス）:** 別ブラウザプロファイル → 初回と同じ挙動（TOTP 画面出る）
- **シナリオ D（間違った TOTP を 5 回）:** 429 で 10 分ロック
- **シナリオ E（他案件への regression）:** 隣接案件（例: `petabit`）のログインも同じフローで動くこと

### バックエンドテスト
- `backends/ads-insights/tests/` に `test_cases_login_totp.py` を追加
  - パスワード正しい + TOTP 無し → `totp_required: true`
  - パスワード正しい + TOTP 正しい → `auth_token` + `device_trust_token` 発行
  - パスワード正しい + 有効な trust token → TOTP スキップしてログイン成功
  - TOTP 時刻ズレ（`valid_window=1` の境界）検証

### デプロイ前チェック
- Render の `ads-insights-staging` に `pyotp` 依存が入ったことを確認
- `cases.json` は Git 管理のまま（secret 値は一旦平文、将来的に環境変数化を検討 → 別タスク）
- Vercel 側はフロントのみ再デプロイで OK

## スコープ外（別タスク）

- Admin UI での TOTP secret 再発行・デバイス信頼解除
- `cases.json` の secret を環境変数または Secret Manager に退避
- Render マルチインスタンス時の trust token 共有（Redis 化）
- 顧客向けセットアップガイド作成
