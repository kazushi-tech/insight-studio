# bq: BigQuery 連携モジュール
"""GA4 BigQuery データからレポートを生成するためのモジュール群。

- client: BigQuery クライアントラッパー（ADC認証）
- queries: SQL テンプレートコレクション（6種）
- ga4_extract: GA4 DataFrame → ExtractResult 変換
- reporter: オーケストレーター（クエリ選択→実行→MD生成）
"""
