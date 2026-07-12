"""Stable, customer-safe API error responses.

The public contract is intentionally independent from Python exception text.
Legacy aliases remain during the hybrid migration, but they never contain a
stack trace, SQL, provider response, filesystem path, dataset identifier, or
secret value.
"""

from __future__ import annotations

import re
import secrets
from contextvars import ContextVar
from typing import Any, Mapping

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{8,96}$")
_ERROR_CODE_RE = re.compile(r"^[a-z][a-z0-9_]{1,63}$")
_REQUEST_ID_CONTEXT: ContextVar[str | None] = ContextVar("request_id", default=None)

_SAFE_MESSAGES = {
    "authentication_required": "ログインが必要です。",
    "unauthorized": "ログインが必要です。",
    "access_denied": "この操作を行う権限がありません。",
    "validation_error": "入力内容を確認してください。",
    "invalid_request": "入力内容を確認してください。",
    "not_found": "対象が見つかりません。",
    "no_data": "対象期間のデータが見つかりませんでした。",
    "bigquery_not_configured": "データ接続の設定が完了していません。",
    "bq_credentials_missing": "データ接続の設定を確認してください。",
    "bq_auth_error": "データ接続を確認できませんでした。管理者へ連絡してください。",
    "query_error": "データを取得できませんでした。時間をおいて再試行してください。",
    "rate_limited": "操作が集中しています。少し待って再試行してください。",
    "internal_error": "処理を完了できませんでした。時間をおいて再試行してください。",
}


def ensure_request_id(request: Request | None) -> str:
    if request is not None:
        current = getattr(request.state, "request_id", None)
        if isinstance(current, str) and current:
            return current
        supplied = (request.headers.get("x-request-id") or "").strip()
        request_id = supplied if _REQUEST_ID_RE.fullmatch(supplied) else f"req_{secrets.token_urlsafe(12)}"
        request.state.request_id = request_id
        _REQUEST_ID_CONTEXT.set(request_id)
        return request_id
    current = _REQUEST_ID_CONTEXT.get()
    return current or f"req_{secrets.token_urlsafe(12)}"


def normalize_legacy_failure(payload: Any, status_code: int) -> Any:
    """Upgrade legacy `_json` failures without trusting exception text."""
    if not isinstance(payload, dict) or payload.get("ok") is not False:
        return payload
    if isinstance(payload.get("error"), dict):
        return payload

    legacy_error = payload.get("error")
    candidate = payload.get("error_code") or legacy_error
    candidate = str(candidate or "").strip().lower().replace(" ", "_")
    if not _ERROR_CODE_RE.fullmatch(candidate):
        candidate = {
            400: "invalid_request",
            401: "authentication_required",
            403: "access_denied",
            404: "not_found",
            409: "conflict",
            429: "rate_limited",
        }.get(int(status_code), "internal_error" if status_code >= 500 else "request_failed")

    category = {
        "authentication_required": "authentication",
        "unauthorized": "authentication",
        "access_denied": "authorization",
        "validation_error": "validation",
        "invalid_request": "validation",
        "not_found": "not_found",
        "rate_limited": "rate_limit",
        "bq_credentials_missing": "configuration",
        "bigquery_not_configured": "configuration",
        "bq_auth_error": "dependency",
        "query_error": "dependency",
        "internal_error": "unexpected",
    }.get(candidate, "unexpected")
    retryable = bool(payload.get("retryable")) or candidate in {"rate_limited", "query_error", "internal_error"}
    message = _SAFE_MESSAGES.get(candidate)
    if not message:
        message = "処理を完了できませんでした。" if status_code < 500 else _SAFE_MESSAGES["internal_error"]
    request_id = ensure_request_id(None)
    normalized = error_payload(
        code=candidate,
        category=category,
        user_message=message,
        retryable=retryable,
        request_id=request_id,
        field_errors=payload.get("field_errors") if isinstance(payload.get("field_errors"), dict) else None,
    )
    # Preserve non-sensitive compatibility metadata (period choices, progress,
    # etc.) while removing any field that can carry raw provider/exception text.
    blocked = {
        "error",
        "error_code",
        "detail",
        "message",
        "raw_error",
        "exception",
        "traceback",
    }
    normalized.update({key: value for key, value in payload.items() if key not in blocked})
    return normalized


def error_payload(
    *,
    code: str,
    category: str,
    user_message: str,
    retryable: bool,
    request_id: str,
    field_errors: Mapping[str, Any] | None = None,
    legacy_detail: str | None = None,
) -> dict[str, Any]:
    """Build the canonical envelope plus safe hybrid-period aliases."""
    problem = {
        "code": code,
        "category": category,
        "user_message": user_message,
        "retryable": bool(retryable),
        "request_id": request_id,
        "field_errors": dict(field_errors or {}),
    }
    return {
        "ok": False,
        "error": problem,
        # Compatibility aliases are safe, flat values for old clients only.
        "error_code": code,
        "message": user_message,
        "detail": legacy_detail or user_message,
        "retryable": bool(retryable),
        "request_id": request_id,
        "field_errors": dict(field_errors or {}),
    }


def problem_response(
    request: Request | None,
    *,
    status_code: int,
    code: str,
    category: str,
    user_message: str,
    retryable: bool = False,
    field_errors: Mapping[str, Any] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    request_id = ensure_request_id(request)
    response_headers = {
        "Cache-Control": "private, no-store",
        "X-Request-ID": request_id,
        **dict(headers or {}),
    }
    return JSONResponse(
        status_code=status_code,
        content=error_payload(
            code=code,
            category=category,
            user_message=user_message,
            retryable=retryable,
            request_id=request_id,
            field_errors=field_errors,
        ),
        headers=response_headers,
    )


def http_exception_response(request: Request, exc: HTTPException) -> JSONResponse:
    """Map HTTPException to stable public copy without echoing arbitrary detail."""
    status = int(exc.status_code)
    if status == 400:
        values = ("invalid_request", "validation", "入力内容を確認してください。", False)
    elif status == 401:
        values = ("authentication_required", "authentication", "ログインが必要です。", False)
    elif status == 403:
        values = ("access_denied", "authorization", "この操作を行う権限がありません。", False)
    elif status == 404:
        values = ("not_found", "not_found", "対象が見つかりません。", False)
    elif status == 409:
        values = ("conflict", "conflict", "ほかの更新と競合しました。画面を更新してください。", True)
    elif status == 429:
        values = ("rate_limited", "rate_limit", "操作が集中しています。少し待って再試行してください。", True)
    elif status in (502, 503, 504):
        values = ("service_unavailable", "dependency", "分析サービスを一時的に利用できません。", True)
    else:
        values = ("request_failed", "unexpected", "処理を完了できませんでした。", status >= 500)
    code, category, message, retryable = values
    return problem_response(
        request,
        status_code=status,
        code=code,
        category=category,
        user_message=message,
        retryable=retryable,
        headers={key: str(value) for key, value in (exc.headers or {}).items()},
    )
