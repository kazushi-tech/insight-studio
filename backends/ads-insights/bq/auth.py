"""BigQuery 認証ヘルパー

- GOOGLE_CREDENTIALS_JSON（Base64）環境変数があればデコード→一時ファイル→GOOGLE_APPLICATION_CREDENTIALS設定
- なければADC認証にフォールバック（ローカル開発用: gcloud auth application-default login）
"""

from __future__ import annotations

import os
from pathlib import Path

_credentials_configured = False
_ADC_FILE_NAME = "application_default_credentials.json"


def _candidate_adc_paths() -> list[Path]:
    """Return likely ADC paths for local Windows dev/test processes.

    Some automation runners start Python without APPDATA even though the
    user's gcloud ADC file exists. Google auth normally relies on APPDATA on
    Windows, so we explicitly probe the standard location plus repo-parent
    user directories before falling back to library defaults.
    """
    candidates: list[Path] = []

    appdata = os.environ.get("APPDATA")
    if appdata:
        candidates.append(Path(appdata) / "gcloud" / _ADC_FILE_NAME)

    userprofile = os.environ.get("USERPROFILE")
    if userprofile:
        candidates.append(Path(userprofile) / "AppData" / "Roaming" / "gcloud" / _ADC_FILE_NAME)

    try:
        home = Path.home()
        candidates.append(home / "AppData" / "Roaming" / "gcloud" / _ADC_FILE_NAME)
        candidates.append(home / ".config" / "gcloud" / _ADC_FILE_NAME)
    except Exception:
        pass

    try:
        cwd = Path.cwd().resolve()
        for parent in (cwd, *cwd.parents):
            candidates.append(parent / "AppData" / "Roaming" / "gcloud" / _ADC_FILE_NAME)
            if parent.parent.name == "Users":
                candidates.append(parent / "AppData" / "Roaming" / "gcloud" / _ADC_FILE_NAME)
                break
    except Exception:
        pass

    unique: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key not in seen:
            unique.append(candidate)
            seen.add(key)
    return unique


def _configure_local_adc_if_available() -> bool:
    if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        return True

    for candidate in _candidate_adc_paths():
        if candidate.is_file():
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(candidate)
            print(f"[bq-auth] Local ADC credentials configured: {candidate}")
            return True
    return False


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
        # ADCフォールバック: Windows automation may not expose APPDATA, so
        # first set GOOGLE_APPLICATION_CREDENTIALS when the standard ADC file
        # can be found. If not found, google-auth still gets its normal chance.
        _configure_local_adc_if_available()
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
