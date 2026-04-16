"""BigQuery 認証ヘルパー

- GOOGLE_CREDENTIALS_JSON（Base64）環境変数があればデコード→一時ファイル→GOOGLE_APPLICATION_CREDENTIALS設定
- なければADC認証にフォールバック（ローカル開発用: gcloud auth application-default login）
"""

from __future__ import annotations

import os

_credentials_configured = False


def setup_credentials() -> bool:
    """認証を設定する。成功時True、BQ未設定時False。

    GOOGLE_CREDENTIALS_JSON (Base64) が設定されていればデコードして
    GOOGLE_APPLICATION_CREDENTIALS にパスを設定する。
    未設定の場合はADCフォールバック（ローカル開発用）として True を返す。
    """
    global _credentials_configured
    if _credentials_configured:
        return True

    creds_b64 = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    if not creds_b64:
        # ADCフォールバック: gcloud auth application-default login で認証済みならそのまま動く
        _credentials_configured = True
        return True

    try:
        import base64
        import tempfile

        creds_json = base64.b64decode(creds_b64)
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".json", mode="wb")
        tmp.write(creds_json)
        tmp.close()
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = tmp.name
        _credentials_configured = True
        print(f"[bq-auth] Service account credentials configured from GOOGLE_CREDENTIALS_JSON")
        return True
    except Exception as e:
        print(f"[bq-auth] Failed to setup credentials: {e}")
        return False


def is_bq_available() -> bool:
    """BigQueryが利用可能かチェックする。

    google-cloud-bigquery パッケージがインストールされており、
    認証情報が設定可能な場合に True を返す。
    """
    try:
        from google.cloud import bigquery  # noqa: F401
        return setup_credentials()
    except ImportError:
        return False
