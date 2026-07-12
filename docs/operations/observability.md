# Observability / privacy contract

## 収集する項目

構造化JSONログは次のallowlistだけを使う。

- `request_id`
- `deployment_sha`
- `workspace_hash`
- `job_id`
- `stage`
- `duration_ms`
- `error_code`
- HTTP statusや集計済みmetric

workspace識別子は環境ごとの`OBSERVABILITY_HASH_SALT`でHMAC / hash化し、元IDを送らない。frontend、Ads、ML、workerで同じ意味のfield名を使う。

## 収集しない項目

- URL本文、query string、共有token
- GCP project / dataset、抽出本文、顧客レポート本文
- email、氏名、生IP、user agent全文
- JWT、Clerk / Stripe / AI API key、credential JSON
- providerのraw error / response body、SQL、filesystem path

例外追跡は`error_code`とrelease SHAで集約し、顧客向けメッセージと内部例外を分離する。Sentryは`sendDefaultPii=false`とsanitizing hookを必須にする。Speed Insightsはshare / print routeを送らず、URLはorigin + pathnameへ縮約する。

PythonのAds / ML / workerは`default_integrations=False`、`include_local_variables=False`、request body無効、trace / profile sample rate 0で初期化し、捕捉した例外を`service / error_code / stage / deployment_sha / 例外class名`だけへ再構築する。Workflowはserver-onlyの`@sentry/core/server`を使い、HTTP/request integrationを追加しない。`dataCollection`はcookie、header、query、body、生成AI入出力、stack変数、source contextをすべて無効にし、transactionも破棄する。いずれも例外message、stack frame、source、localsをSentryへ送らない。

## 監視面

- Vercel Runtime Logs: request / readiness / duration / error code
- Sentry: frontend、Ads、ML、worker / Workflowの例外
- Vercel Speed Insights: LCP / INP / CLS。share tokenを送信しない
- GitHub Health Monitor: 5分ごとにfrontend、Ads、ML、選択したdurable backend
- Workflow選択時: run / step、resume、retry、cancel、event数、step duration
- worker選択時: DBへ記録したfresh heartbeatとoperator canary

worker modeの`/api/ml/health`は、60秒以内のworker heartbeatが1件もなければ503を返す。公開応答はworker数と最新heartbeat時刻の集計だけで、worker IDやjob IDを出さない。認証済みplatform operatorは`/api/ml/admin/worker-readiness`でdeployment SHA、最後のjob ID・status・完了時刻を確認する。公開healthの成功はプロセス生存だけを示すため、高度分析のProduction gateには同endpointのoperator canary成功証跡も必要である。

## Alert policy

- P1: cross-tenant、秘密漏えい、課金誤付与、継続的な全体停止
- P2: report生成 / login / exportの主要journey停止、durable job滞留
- P3: 一部分析失敗、性能budget超過、単一workspaceの設定不備

アラートにはrequest ID、deployment SHA、hash化workspace、error codeだけを含める。顧客データをSlack / email本文へ転記しない。

## 外形監視の注意

`.github/workflows/monitor.yml`は旧Render URLを直接監視せず、Production originのsame-origin routeを確認する。worker modeでは`/api/ml/health`自体がstale heartbeatを503にする。`MARKET_LENS_JOB_BACKEND`が未設定、または`workflow`なのにreadiness URLがない場合もfail closedとする。
