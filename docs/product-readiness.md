# Insight Studio 販売準備判定

更新日: 2026-07-12

## 商品の範囲

Insight Studio は、Webサイトの実測データを「今回分かったこと」「次にやること」「まだ判断できないこと」と根拠へ整理する。顧客向けの基本レポートでは広告費、広告クリック、CPA、ROASを扱わず、流入元やキャンペーン名もWebサイトへの流入傾向としてのみ説明する。

競合探索、URL比較、LP・クリエイティブ分析は高度分析であり、耐久ジョブの運用実績が揃うまでは運用者限定とする。

## 現在のリポジトリ側到達点

- `report.v2` とv1互換表示、期間ユニーク利用者、比較期間、計測済み0件と未設定の分離
- 根拠IDへ接続した結論・行動・追加質問
- Clerk本人確認、workspace/project権限、PostgreSQL正本の案件・履歴・共有
- A4印刷、CSV、7日以内の読取専用共有リンク
- Stripe Hosted Checkout / Customer PortalとWebhook正本の権限管理
- 承認済み法務文書のversion同意、export・削除申請
- PostgreSQL workerによる高度分析のlease、再試行、取消、artifact・AI利用額の重複防止
- frontend / Ads / ML / security / schema / browserを分けたCIと5分間隔の外形監視

この一覧はコード上の機能であり、本番設定・外部審査・実顧客受入の完了を意味しない。

## 凍結中の範囲

とどくくん、YouTube広告、Google Ads APIは全面凍結中である。専用API、テーブル、環境変数、画面、仮データを追加しない。再開には別ADRと新しい受入基準が必要であり、現在の商品説明へ将来連携を含めない。

## 有料パイロット販売ゲート

- [ ] Clerk Productionの許可origin、組織招待、署名鍵を確認した
- [ ] managed PostgreSQLのTLS、pool、backup、PITR、接続上限を確認した
- [ ] 顧客ごとに別datasetを接続し、2社相当fixtureで交差参照が拒否される
- [ ] 実データの期間利用者、成果、流入元をBigQuery直接集計と照合した
- [ ] ログインからレポート、根拠、別端末履歴、印刷、CSV、共有まで説明なしで完走した
- [ ] 顧客画面に内部用語・dataset・providerエラー・秘密値が出ない
- [ ] 360 / 390 / 768 / 1440px、axe、console、page error、失敗networkのゲートを通した
- [ ] 法務承認済み文書と事業者情報をDBへ公開し、同意versionを固定した
- [ ] 料金、保持、返金、解約、障害時連絡を契約へ記載した
- [ ] `master` とfrontend / Ads / MLのlive SHA、DB revision、durable job backendを本番証跡で一致させた

## セルフサービス販売ゲート

有料パイロットの全条件に加え、signup、workspace作成、Checkout、接続、招待、Portal、解約、export、削除申請を本番相当E2Eで完走する。Stripe webhookの再送・順不同・不正署名、past_due / canceledのread-only化、last owner保護も必須である。

## 現在の判定

- リポジトリ実装: 段階的商用化の基盤あり
- 有料パイロット: **BLOCKED**。外部Production設定、法務承認、実顧客データ照合、live証跡が未取得
- 高度分析: **BLOCKED**。worker heartbeatのfail-closed healthとoperator canary endpointは実装済みだが、本番worker作成・canary監視・5回連続成功証跡が未取得
- セルフサービス: **BLOCKED**。Stripe / Clerk本番E2E、法務・削除運用の実証が未取得
- Production release: **BLOCKED**。push成功では閉じず、`docs/operations/release-and-rollback.md` の全証跡を必要とする
