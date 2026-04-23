"""共通エラー封筒定義。

全 API エンドポイントで統一されたエラーレスポンス形式を返すためのヘルパー。
フロントエンド側は { ok, error_code, detail, retryable, request_id } の形式を期待する。
"""
from __future__ import annotations

import uuid
from fastapi.responses import JSONResponse


def error_response(
    *,
    error_code: str,
    detail: str,
    retryable: bool,
    status_code: int,
    request_id: str | None = None,
) -> JSONResponse:
    if request_id is None:
        request_id = uuid.uuid4().hex[:8]
    return JSONResponse(
        {
            "ok": False,
            "error_code": error_code,
            "detail": detail,
            "retryable": retryable,
            "request_id": request_id,
        },
        status_code=status_code,
    )


ERROR_RATE_LIMIT = lambda req_id=None: error_response(
    error_code="rate_limit",
    detail="APIのレート制限に達しました。しばらく待ってから再試行してください。",
    retryable=True,
    status_code=429,
    request_id=req_id,
)

ERROR_OVERLOADED = lambda req_id=None: error_response(
    error_code="overloaded",
    detail="AIサービスが一時的に混み合っています。数分後に再試行してください。",
    retryable=True,
    status_code=529,
    request_id=req_id,
)

ERROR_AUTH = lambda req_id=None: error_response(
    error_code="auth_error",
    detail="APIキーが無効です。設定を確認してください。",
    retryable=False,
    status_code=401,
    request_id=req_id,
)

ERROR_BILLING = lambda req_id=None: error_response(
    error_code="billing",
    detail="APIクレジットが不足しています。支払い設定を確認してください。",
    retryable=False,
    status_code=402,
    request_id=req_id,
)

ERROR_SERVER = lambda detail="サーバーエラーが発生しました。", req_id=None: error_response(
    error_code="server_error",
    detail=detail,
    retryable=True,
    status_code=500,
    request_id=req_id,
)

ERROR_UPSTREAM = lambda detail="バックエンドサービスのエラーです。再試行してください。", req_id=None: error_response(
    error_code="upstream_error",
    detail=detail,
    retryable=True,
    status_code=503,
    request_id=req_id,
)
