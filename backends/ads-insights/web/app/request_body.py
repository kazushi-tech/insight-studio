"""Bounded request-body reads for signed public webhook endpoints."""

from __future__ import annotations

from fastapi import HTTPException, Request


MAX_SIGNED_WEBHOOK_BYTES = 1_048_576


async def read_bounded_body(
    request: Request,
    *,
    max_bytes: int = MAX_SIGNED_WEBHOOK_BYTES,
) -> bytes:
    content_length = (request.headers.get("content-length") or "").strip()
    if content_length:
        try:
            declared = int(content_length)
        except ValueError:
            declared = -1
        if declared < 0:
            raise HTTPException(status_code=400, detail="invalid_content_length")
        if declared > max_bytes:
            raise HTTPException(status_code=413, detail="request_body_too_large")

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > max_bytes:
            raise HTTPException(status_code=413, detail="request_body_too_large")
    return bytes(body)
