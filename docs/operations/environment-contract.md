# Production environment contract

値はVercel / GitHub Environment / managed providerへ秘密として設定し、実値をリポジトリへ追加しない。`VITE_`付き変数はブラウザから読めるため、秘密値には使用しない。

## Frontend public configuration

| Key | Purpose |
| --- | --- |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk browser SDK |
| `VITE_ENABLE_PROJECT_MANAGEMENT` | project UI rollout flag |
| `VITE_BQ_SERVICE_ACCOUNT_EMAIL` | 顧客へ案内する公開サービスアカウントemail |
| `VITE_BILLING_PLAN_KEY` | server allowlistへ渡す公開plan key |
| `VITE_SENTRY_DSN` | PII送信を止めたfrontend Sentry |
| `VITE_ENABLE_SPEED_INSIGHTS` | `true`で有効化 |
| `VITE_GIT_COMMIT_SHA` | frontend release相関 |

ProductionのClerk Frontend APIを独自CNAME（例: `clerk.example.jp`）で使う場合は、その正確なoriginを`vercel.json`の`script-src`と`connect-src`へ追加してからリリースする。未登録のCNAMEや任意のwildcardをProductionで許可しない。Cloudflare本人確認用`frame-src`、Clerk画像、`worker-src 'self' blob:`も削除しない。

## Shared backend

| Key | Rule |
| --- | --- |
| `DATABASE_URL` | managed PostgreSQL。ProductionはSQLite不可 |
| `DATABASE_DIRECT_URL` | migration release job専用のdirect connection。runtimeへは使わない |
| `DATABASE_SSLMODE` | Productionは`require`以上 |
| `DATABASE_POOL_SIZE` / `DATABASE_MAX_OVERFLOW` | provider接続上限以下 |
| `DATABASE_POOL_TIMEOUT_SECONDS` | fail fast。file fallback禁止 |
| `CLERK_JWT_PUBLIC_KEY` | pinned RS256 public key。network fetchに依存しない |
| `CLERK_ISSUER` / `CLERK_ALLOWED_AZP` | issuerとProduction originを固定 |
| `OBSERVABILITY_HASH_SALT` | workspace hash用32bytes以上のsecret |
| `SENTRY_DSN` | Ads / ML / worker用のserver-only DSN。空なら例外送信を無効化 |
| `SENTRY_ENVIRONMENT` | 空白・slashを含まないSentry環境名 |
| `VERCEL_GIT_COMMIT_SHA` | Vercelが注入。health SHA証明 |

## Ads backend

| Key | Rule |
| --- | --- |
| `CLERK_SECRET_KEY` | organization invitation APIだけで使用 |
| `CLERK_WEBHOOK_SIGNING_SECRET` | webhook raw body署名検証 |
| `PROJECT_INVITE_HASH_SECRET` | pending invitationのemail HMAC |
| `RATE_LIMIT_HASH_SECRET` | 共有rate-limit主体のHMAC。32bytes以上、server only |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` | 主要APIの固定窓あたり上限回数 / 秒数。正の整数 |
| `LEGAL_AUDIT_HASH_SECRET` | 同意 / privacy監査のHMAC。32bytes以上 |
| `LEGAL_REQUIRED_DOCUMENT_KEYS` | 公開・同意必須のapproved document keys |
| `PRIVACY_RETENTION_POLICY_VERSION` | 会社承認済み保持方針のversion。空ならprivacy workerは実行しない |
| `PRIVACY_EXPORT_RETENTION_DAYS` | 暗号化exportの保存日数。1〜365を明示 |
| `PRIVACY_EXPORT_MAX_BYTES` | JSON + CSV平文の上限。1KiB〜250MiBを明示 |
| `PRIVACY_EXPORT_ENCRYPTION_KEY_B64` | AES-256-GCM用32bytes鍵のURL-safe Base64。server only |
| `PRIVACY_EXPORT_ENCRYPTION_KEY_ID` | 鍵rotation用の非秘密version label |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | server only |
| `BILLING_PLAN_PRICES_JSON` | `plan_key -> Price ID` allowlist |
| `BILLING_CHECKOUT_SUCCESS_URL` / `BILLING_CHECKOUT_CANCEL_URL` | liveはHTTPS |
| `BILLING_PORTAL_RETURN_URL` | liveはHTTPS |
| `BILLING_RETENTION_POLICY_CONFIGURED` | 承認済み保持方針後だけ`true` |
| `GCP_PROJECT_ID` / ADC or service credential | Web実測データ読取。最小権限 |

`APP_PASSWORD`、`JWT_SECRET`、`ADS_CASES_JSON`はhybrid期間だけのlegacy設定であり、新規顧客の正準認証・案件台帳にしない。全員のClerk招待完了後に削除・rotationする。

## ML backend / durable jobs

| Key | Rule |
| --- | --- |
| `MARKET_LENS_JOB_BACKEND` | `worker`または8項目PASS後の`workflow` |
| `MARKET_LENS_WORKER_ENABLED` | worker選択時だけ`true` |
| `MARKET_LENS_WORKFLOW_ENABLED` | workflow選択時だけ`true` |
| `MARKET_LENS_WORKFLOW_ENDPOINT` / `MARKET_LENS_WORKFLOW_TOKEN` | workflow選択時だけ設定 |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | operator高度分析用。job payload / logへ保存しない |

workerのlease、heartbeat、concurrencyは商用化計画どおり60秒、20秒、2へコードで固定する。worker modeの公開`/api/ml/health`はfresh heartbeatなしで503、認証済み`/api/ml/admin/worker-readiness`はoperator canary証跡を返す。

Workflow suitability用の`WORKFLOW_VITE_ENABLED`、`WORKFLOW_SUITABILITY_ENABLED`、`WORKFLOW_SUITABILITY_TOKEN`はPreviewだけで使う。Productionへ設定しない。

Workflowの例外追跡はserver-onlyの`WORKFLOW_SENTRY_DSN`を使い、空なら`SENTRY_DSN`へfallbackする。どちらも空なら送信しない。ブラウザへ公開する`VITE_SENTRY_DSN`とは別契約であり、WorkflowのDSNに`VITE_`を付けない。

## Release / monitor variables

| Key | Location |
| --- | --- |
| `PRODUCTION_BASE_URL` | GitHub repository variable |
| `MARKET_LENS_JOB_BACKEND` | GitHub repository variable |
| `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_FRONTEND_PROJECT_ID` | GitHub production Environment secrets |
| `WORKFLOW_READINESS_URL` | workflow選択時だけsecret |
| `WORKFLOW_SENTRY_DSN` | Workflow server runtime専用。任意。空なら共有`SENTRY_DSN` |

とどくくん、YouTube広告、Google Ads API向けの環境変数は作成しない。
