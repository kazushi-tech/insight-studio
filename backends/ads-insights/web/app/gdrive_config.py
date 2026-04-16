"""
Google Drive API 設定モジュール

フロントエンドおよびバックエンドで使用するGoogle API設定を管理。
環境変数から読み込みます。
"""
from __future__ import annotations

import os

# =============================================
# Google Cloud Platform 設定
# =============================================

# OAuth 2.0 クライアントID（フロントエンドのPicker認証用）
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")

# Picker API用のAPIキー
GOOGLE_PICKER_API_KEY = os.environ.get("GOOGLE_PICKER_API_KEY", "")

# GCPプロジェクト番号（App ID）
GOOGLE_APP_ID = os.environ.get("GOOGLE_APP_ID", "")

# =============================================
# スコープ設定
# =============================================

# Google Drive読み取り専用スコープ
GDRIVE_SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly"
]


def is_gdrive_configured() -> bool:
    """
    Google Drive連携が設定されているかチェック
    
    Returns:
        必要な設定がすべて揃っていればTrue
    """
    return bool(GOOGLE_CLIENT_ID and GOOGLE_PICKER_API_KEY and GOOGLE_APP_ID)


def get_config_for_frontend() -> dict:
    """
    フロントエンドに渡す設定を取得
    
    Returns:
        設定辞書（APIキーなどを含む）
    """
    return {
        "client_id": GOOGLE_CLIENT_ID,
        "api_key": GOOGLE_PICKER_API_KEY,
        "app_id": GOOGLE_APP_ID,
        "scopes": GDRIVE_SCOPES,
        "configured": is_gdrive_configured()
    }


def get_missing_config() -> list[str]:
    """
    未設定の項目を取得
    
    Returns:
        未設定の環境変数名リスト
    """
    missing: list[str] = []
    if not GOOGLE_CLIENT_ID:
        missing.append("GOOGLE_CLIENT_ID")
    if not GOOGLE_PICKER_API_KEY:
        missing.append("GOOGLE_PICKER_API_KEY")
    if not GOOGLE_APP_ID:
        missing.append("GOOGLE_APP_ID")
    return missing
