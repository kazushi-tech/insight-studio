"""BigQuery クライアントラッパー

認証方式:
- Vercel環境: GOOGLE_CREDENTIALS_JSON (Base64) → サービスアカウント認証
- ローカル環境: ADC認証 (gcloud auth application-default login)

bq.auth.setup_credentials() で自動判定される。
"""

from __future__ import annotations

from typing import Optional

import pandas as pd

PROJECT_ID = "analyzedataplatform"


_client_cache: dict = {}


def get_client(project: str = PROJECT_ID):
    """BigQuery クライアントを取得する（シングルトン）。認証はbq.authで自動設定。"""
    if project in _client_cache:
        return _client_cache[project]
    from bq.auth import setup_credentials
    setup_credentials()
    from google.cloud import bigquery
    client = bigquery.Client(project=project)
    _client_cache[project] = client
    return client


def list_datasets(project: str = PROJECT_ID) -> list[str]:
    """プロジェクト内のデータセット一覧を取得する。"""
    client = get_client(project)
    datasets = list(client.list_datasets())
    return [ds.dataset_id for ds in datasets]


def list_tables(dataset_id: str, project: str = PROJECT_ID) -> list[str]:
    """データセット内のテーブル一覧を取得する。"""
    client = get_client(project)
    tables = list(client.list_tables(f"{project}.{dataset_id}"))
    return [t.table_id for t in tables]


def run_query(sql: str, project: str = PROJECT_ID) -> pd.DataFrame:
    """SQLクエリを実行し、DataFrameで返す。"""
    client = get_client(project)
    return client.query(sql).to_dataframe()


def run_query_with_params(
    sql: str,
    params: Optional[dict] = None,
    project: str = PROJECT_ID,
) -> pd.DataFrame:
    """パラメータ付きSQLクエリを実行する。

    params は {name: value} の辞書。SQL内で @name でパラメータ参照。
    """
    from google.cloud import bigquery

    client = get_client(project)
    job_config = bigquery.QueryJobConfig()

    if params:
        query_params = []
        for name, value in params.items():
            if isinstance(value, str):
                query_params.append(bigquery.ScalarQueryParameter(name, "STRING", value))
            elif isinstance(value, int):
                query_params.append(bigquery.ScalarQueryParameter(name, "INT64", value))
            elif isinstance(value, float):
                query_params.append(bigquery.ScalarQueryParameter(name, "FLOAT64", value))
        job_config.query_parameters = query_params

    return client.query(sql, job_config=job_config).to_dataframe()
