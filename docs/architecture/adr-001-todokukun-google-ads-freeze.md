# ADR-001: とどくくん / Google Ads 連携を凍結する

- Status: Accepted
- Date: 2026-07-12
- Scope: Insight Studio commercialisation work

## Decision

今回の商用化実装では、とどくくん、YouTube 広告、Google Ads API に関する連携をすべて対象外とする。

次のものは追加しない。

- Google Ads API の認証、customer ID、campaign ID、広告アカウント設定
- 広告費、表示回数、広告クリック、CPA、ROAS の取得・保存・表示
- とどくくん専用の API route、DB table、環境変数、画面、ジョブ
- 将来連携を先取りした仮の interface や未使用 field
- Web サイト成果を広告施策の効果だと断定する表現

GA4 BigQuery に既に含まれる `source`、`medium`、`campaign` は、Web サイトへの流入経路として分析してよい。ただし、広告費用対効果や Google Ads 実績としては扱わない。

## Product boundary

この期間の Insight Studio は、次の価値に限定する。

1. GA4 BigQuery の Web 成果レポート
2. 数値根拠とデータ不足を分けた判断支援
3. 次に確認・改善する行動の提示
4. 運用者向けの競合、LP、クリエイティブ分析

顧客画面では、広告データが存在しない状態で `広告成果`、`広告効果`、`CPA`、`ROAS` を表示しない。

## Revisit condition

この決定を変更するには、別 ADR で以下を先に確定する。

- Google Ads API の OAuth とアカウント所有権
- とどくくんと Insight Studio の tenant / project 対応
- 広告指標の正準 schema と attribution policy
- 利用規約、データ取扱い、保存期間
- sandbox と実アカウントを分けた E2E 検証

それまでは、本 ADR を優先する。
