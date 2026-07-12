"""Customer-safe error envelope for Market Lens endpoints."""

from __future__ import annotations

import re
import secrets
from typing import Any, Mapping

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{8,96}$")


def ensure_request_id(request: Request) -> str:
    current = getattr(request.state, "request_id", None)
    if isinstance(current, str) and current:
        return current
    candidate = (request.headers.get("x-request-id") or "").strip()
    request_id = candidate if _REQUEST_ID_RE.fullmatch(candidate) else f"req_{secrets.token_urlsafe(12)}"
    request.state.request_id = request_id
    return request_id


def problem_response(
    request: Request,
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
    fields = dict(field_errors or {})
    return JSONResponse(
        status_code=status_code,
        content={
            "ok": False,
            "error": {
                "code": code,
                "category": category,
                "user_message": user_message,
                "retryable": bool(retryable),
                "request_id": request_id,
                "field_errors": fields,
            },
            "error_code": code,
            "detail": user_message,
            "retryable": bool(retryable),
            "request_id": request_id,
            "field_errors": fields,
        },
        headers={
            "Cache-Control": "private, no-store",
            "X-Request-ID": request_id,
            **dict(headers or {}),
        },
    )


def http_exception_response(request: Request, exc: HTTPException) -> JSONResponse:
    status = int(exc.status_code)
    values = {
        400: ("invalid_request", "validation", "入力内容を確認してください。", False),
        422: ("validation_failed", "validation", "入力内容を確認してください。", False),
        401: ("authentication_required", "authentication", "ログインが必要です。", False),
        403: ("access_denied", "authorization", "この操作を行う権限がありません。", False),
        404: ("not_found", "not_found", "対象が見つかりません。", False),
        409: ("conflict", "conflict", "ほかの更新と競合しました。画面を更新してください。", True),
        429: ("rate_limited", "rate_limit", "操作が集中しています。少し待って再試行してください。", True),
    }.get(status, ("request_failed", "unexpected", "処理を完了できませんでした。", status >= 500))
    code, category, message, retryable = values
    # Keep route-authored validation details so existing clients can identify
    # the invalid field (cron/email/slack/policy, etc.).  Other status classes
    # retain customer-safe generic messages and never echo provider failures.
    if status in {400, 422} and isinstance(exc.detail, str):
        authored_detail = exc.detail.strip()
        if authored_detail:
            message = authored_detail[:500]
    return problem_response(
        request,
        status_code=status,
        code=code,
        category=category,
        user_message=message,
        retryable=retryable,
        headers={key: str(value) for key, value in (exc.headers or {}).items()},
    )
