# Insight Studio 初回有償導入チェックリスト

更新日: 2026-07-12

最初の商品は、担当者が1社ずつ接続と初回レポートを確認するmanaged pilotとする。高度分析、provider設定、AI予算管理は運用者が扱い、顧客へ秘密値や内部設定を表示しない。

## 受注・法務

- [ ] 対象サイト、担当者、見る成果、対象期間を合意した
- [ ] 料金、提供範囲、保持期間、返金、解約、障害時連絡を個別書面に記載した
- [ ] 利用規約、プライバシー、特商法、security、subprocessorを会社承認した
- [ ] 承認済み文書をversion付きで公開し、同意履歴を確認した
- [ ] とどくくん、YouTube広告、Google Ads APIを提供範囲や将来確約へ含めていない

## 本人確認・顧客分離

- [ ] Clerk Productionのdomain、許可origin、組織、招待メールを設定した
- [ ] workspaceとClerk Organizationが1対1で対応している
- [ ] owner / admin / editor / viewerの正負テストを実資格で行った
- [ ] workspace Aの利用者がworkspace Bのproject / report / job / assetをID直指定しても取得できない
- [ ] 認証JWTとAI keyがlocalStorageへ残らない
- [ ] platform admin以外へdataset、provider設定、API keyが表示されない

## データ接続

- [ ] Insight Studio用サービスアカウントへ必要最小限の権限だけを付与した
- [ ] 顧客ごとに別のGCP project / datasetを登録した
- [ ] テーブル検出、最新日、timezone、成果イベントの過去90日観測を確認した
- [ ] 未設定、対象期間0件、部分取得、失敗が別状態で表示される
- [ ] 期間利用者と主要数値をBigQuery直接集計で照合した
- [ ] 流入分析を広告費用対効果や因果として説明していない

## 顧客体験

- [ ] login → project → wizard → report → graphs → AI質問を説明なしで完走した
- [ ] 結論・行動・判断保留の全項目から根拠へ移動できる
- [ ] 履歴を別端末で復元できる
- [ ] A4印刷、CSV、7日以内の共有リンク、失効・監査が動作する
- [ ] 360 / 390 / 768 / 1440pxで横はみ出しがない
- [ ] axe critical / serious、console error、page error、失敗networkが0

## 運用・復旧

- [ ] PostgreSQLのbackup / PITR、復旧担当、接続上限を記録した
- [ ] frontend / Ads / ML / 選択したdurable job backendを5分間隔で監視している
- [ ] Sentry、Vercel Runtime Logs、Speed Insightsで個人情報を送らない設定を確認した
- [ ] worker選択時は`/api/ml/health`がfresh heartbeatを検知し、認証済み`/api/ml/admin/worker-readiness`にoperator canary成功が残る
- [ ] DB停止時にfileや`/tmp`へfallbackせず503とreadiness failureになる
- [ ] rollback deployment、DB backup、feature flagの戻し先を確定した
- [ ] `master` と全live SHA、DB head、canary、初期エラーscanの証跡を保存した

## 課金・解約を使う場合

- [ ] Stripe商品・Price・KYC・本番Webhookを設定した
- [ ] clientのPrice IDを信用せず、serverの`plan_key` allowlistを使う
- [ ] Checkout成功URLだけでは権限が増えない
- [ ] webhookの正常、再送、順不同、不正署名を確認した
- [ ] past_due / canceled / unpaidのread-only条件を確認した
- [ ] exportと30日猶予の削除申請、取消、last owner保護を確認した
