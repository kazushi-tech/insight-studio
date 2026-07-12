# ローカル / Production確認ガイド

ローカルとProductionは別の証拠として扱う。push成功やローカル画面だけで本番反映済みと判断しない。

| | ローカル | Production |
| --- | --- | --- |
| frontend | `http://127.0.0.1:3002` | Vercel Production domain |
| Ads API | Vite `/api/ads` → `127.0.0.1:8001` | Vercel service rewrite |
| ML API | Vite `/api/ml` → `127.0.0.1:8002` | Vercel service rewrite |
| DB | local PostgreSQL / test-only SQLite | managed PostgreSQL必須 |
| 認証 | Clerk development instance | Clerk Production instance |

## 秘密値の境界

- frontendはsame-originの`/api/ads`、`/api/ml`、`/api/insights`だけを使う。
- Viteの`VITE_`変数はブラウザへ露出する。API key、JWT、DB URL、webhook secretには付けない。
- 認証JWTとAI keyをlocalStorageへ保存しない。
- 顧客レスポンスへSQL、path、provider raw error、secretを返さない。
- 正準の環境変数は`docs/operations/environment-contract.md`を参照する。

## 起動

```powershell
npm ci
./dev.ps1
```

個別に起動する場合:

```powershell
cd backends/market-lens-ai
python -m uvicorn web.app.main:app --host 127.0.0.1 --port 8002 --reload

cd ../ads-insights
python -m uvicorn web.app.backend_api:app --host 127.0.0.1 --port 8001 --reload --timeout-keep-alive 300

cd ../..
npm run dev -- --host 127.0.0.1
```

proxyを変更するときだけ`ADS_PROXY_TARGET` / `ML_PROXY_TARGET`を設定する。

## ローカル検証

```powershell
npm run lint
npm test -- --maxWorkers=1
npm run test:coverage -- --maxWorkers=1
npm run build:verified
python scripts/check_ci_config.py
python scripts/check_secret_leaks.py
python scripts/check_python_locks.py
```

Python依存を変更した場合はproduction 2つとCI 3つの`.in`を入力に、`uv pip compile --generate-hashes --python-version 3.12 --python-platform x86_64-manylinux_2_28`で5つのlockをすべて再生成し、`python scripts/check_python_locks.py --write`でmanifestを更新する。CIとProductionは`--require-hashes`でlock以外をinstallしない。

Backend全件:

```powershell
cd backends/ads-insights
python -m pytest -q

cd ../market-lens-ai
python -m pytest -q
```

Workflowのcompile確認:

```powershell
npm run workflow:verify
```

これはPreview用Nitro server functionのcompileだけを確認する。6分sleep、redeploy後resume、503 retry、cancel等の適合8項目をPASSしたことにはならない。Windows sandboxでfile traceの`EPERM readlink`が出る場合は、Ubuntu CI / Vercel Previewの証跡を正本にする。

## ブラウザ確認

clean storageで以下を確認する。

1. Clerk login / organization選択
2. project作成・編集・接続試験・招待
3. wizardで「全体」「集客」「成果」を選択
4. reportで結論・行動・判断保留から根拠へ移動
5. graphs、根拠付きAI質問、別端末履歴
6. A4印刷、CSV、共有作成・失効
7. 360 / 390 / 768 / 1440px、h1 / main、focus、reduced motion
8. console error、page error、失敗network、横はみ出しが0

顧客向け面に`GA4`、`BigQuery`、dataset、内部chart ID、`null`、API keyを出さない。

CIのbrowser fixtureはclean storageからhybrid管理者loginを通し、JWTをlocalStorageへ残さないことを検証する。ただしClerk本人確認、Organization選択、招待状態は外部Clerk Previewでしか証明できないため、Clerk Previewのlogin → organization → project権限E2Eを有料パイロットの別証跡として必須にする。

## Production確認

`docs/operations/release-and-rollback.md`に従う。最低限、次を別々に証明する。

- Vercel Production aliasが期待master SHAの`READY` deploymentを指す
- Ads / ML healthが同じ40桁SHAとreadyを返す
- DB revisionがsingle head
- 選択したdurable backend modeが一致する。WorkflowならWorkflow route、workerなら`/api/ml/health`のfresh heartbeatと認証済み`/api/ml/admin/worker-readiness`のcanary
- demo reportとoperator高度分析canary
- 60秒 / 1時間のerror scan

Production確認は`python scripts/ci_verify_production.py`の成功だけでは完結しない。外部backup、実顧客データ照合、法務・課金承認も保存する。
