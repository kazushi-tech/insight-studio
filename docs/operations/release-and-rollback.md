# Production release / rollback runbook

## 原則

- `master` のexact SHAだけをProduction sourceとする。
- feature branchからProductionへ直接push・promoteしない。
- merge、push、Vercelの`Ready`だけでは完了にしない。frontend / Ads / ML / durable job backend、DB revision、canary、error scanの証跡が必要である。
- DB migrationは`backends/market-lens-ai/alembic`だけが実行する。アプリ起動時の`create_all`やfile fallbackを使わない。
- とどくくん、YouTube広告、Google Ads APIをrelease scopeへ含めない。

## GitHub / Vercelの事前設定

1. `master`をbranch protection対象にし、PR、承認、`.github/workflows/ci.yml`の7 required jobsを必須にする。
2. feature branchからのProduction deploymentを禁止する。`.github/workflows/production-guard.yml`は事後検知でもあるため、Vercel側のProduction Branchも`master`へ固定する。
3. Vercelがmerge直後に自動Production deployする設定は、DB backup / migrationより先にcodeが出る競合を起こす。保護されたrelease jobからだけdeployする運用へ変更するまではProduction gateを閉じない。
4. GitHub `production` Environmentへ承認者を設定し、DB direct URL、Vercel token、project / team IDをEnvironment secretsとして保持する。
5. `MARKET_LENS_JOB_BACKEND` repository variableを`worker`または`workflow`へ明示する。両方を同時に有効化しない。

## PR gate

PRでは少なくとも次を通す。

- frontend: locked install、lint、全Vitest 1 worker、coverage、build、bundle budget、preview-only Workflow server compile
- Ads / ML: collection floor、全pytest、coverage、PostgreSQL integration
- security: npm / pip audit、secret、凍結差分、CORS、SSRF、rate / budget、error leak、cross-tenant
- schema: single head、SQLiteとPostgreSQLのblank→head / 007→head、v1 / v2、必須path契約と完全OpenAPI hash snapshot。意図した契約変更だけ、生成artifactをレビュー後に`python scripts/ci_openapi_snapshot.py --output-dir artifacts/openapi --write-baseline`で基準を更新する
- browser: clean storage、360 / 390 / 768 / 1440、主要journey、share / print、console / page / network、横はみ出し

repository browser gateの認証はclean-storage hybrid fixtureであり、Clerk Organizationの実招待を代替しない。Production前にClerk Previewで本人確認、Organization選択、project権限の正負E2Eを別途保存する。

`npm run workflow:verify`はNitro + Workflowがpreview server functionまでcompileできることだけを証明する。6分sleep、redeploy resume、503 retry、cancel、100 events未満等の8項目を証明しない。8項目のpreview証跡が1つでも欠ける場合は`worker`を選ぶ。

## Production release sequence

1. リリース対象が最新`master`の40桁SHAと一致することを記録する。
2. DB backup ID、PITR時刻、復元手順、直前deployment IDを記録する。
3. Alembic差分がexpand-onlyであることを確認する。
4. 保護されたrelease jobからdirect connectionで`alembic upgrade head`を実行する。
5. preview E2Eと、選択したdurable job backendのcanaryを通す。
6. exact master SHAからfrontend / Ads / MLをProductionへdeployする。
7. `python scripts/ci_verify_production.py`でProduction aliasそのもの、Ads / ML health SHA、durable backend modeを照合する。worker modeでは`/api/ml/health`のfresh heartbeatもここで必須になる。
8. demo projectで基本レポート、operator projectで高度分析を1件実行し、認証済み`/api/ml/admin/worker-readiness`に同じcanary job ID、`succeeded`、現在のdeployment SHAが記録されたことを保存する。
9. 課金を有効にするreleaseではStripe test webhookを送る。
10. 60秒後と1時間後にRuntime Logs / Sentry / Workflowまたはworker canaryを確認し、新規fatal / 500 / timeoutが0である証跡を保存する。

`scripts/release-production.ps1`はPRを作成・mergeし、GitHub CIとlive SHAを待つ補助である。外部backup、法務承認、実顧客canaryを代行しない。

## Rollback

1. 新規受付をfeature flagで一段戻す。
2. 直前の正常deploymentをpromoteする。
3. frontend / Ads / MLのSHA一致を再確認する。
4. expand migrationは残す。旧`asyncio.create_task`、file repository、`/tmp` fallbackへ戻さない。
5. data corruptionがある場合だけ承認済みPITR手順を使う。通常のcode rollbackでDBを巻き戻さない。
6. 原因、影響workspace、開始 / 復旧時刻、request ID、再発防止をincident recordへ残す。dataset、email、生IP、token、秘密値は記録しない。

## Release evidence template

```text
release_sha:
pull_request:
db_backup_reference:
db_revision_before / after:
rollback_deployment:
frontend_deployment / sha:
ads_deployment / sha:
ml_deployment / sha:
job_backend: worker | workflow
workflow_run_or_worker_canary:
report_canary:
stripe_webhook_if_applicable:
error_scan_60s:
error_scan_1h:
approver:
```
