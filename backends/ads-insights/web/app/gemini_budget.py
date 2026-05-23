"""Local Gemini monthly budget guard for personal API spend control."""

from __future__ import annotations

import json
import math
import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

GEMINI_FLASH_LITE_INPUT_USD_PER_1M = 0.25
GEMINI_FLASH_LITE_OUTPUT_USD_PER_1M = 1.50
GEMINI_FLASH_LITE_MODEL = "gemini-3.1-flash-lite"
LEGACY_GEMINI_FLASH_MODELS = {
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.5-flash",
}
DEFAULT_MONTHLY_BUDGET_USD = 18.0
DEFAULT_USD_JPY = 159.0

_JST = timezone(timedelta(hours=9))


class GeminiBudgetExceeded(RuntimeError):
    """Raised before a Gemini call when the local monthly budget is exceeded."""


def is_gemini_model(model: str | None) -> bool:
    return str(model or "").strip().lower().startswith("gemini")


def normalize_gemini_model(model: str | None) -> str:
    normalized = str(model or "").strip()
    lowered = normalized.lower()
    if not normalized:
        return GEMINI_FLASH_LITE_MODEL
    if lowered == GEMINI_FLASH_LITE_MODEL:
        return GEMINI_FLASH_LITE_MODEL
    if lowered in LEGACY_GEMINI_FLASH_MODELS or lowered.startswith("gemini"):
        return GEMINI_FLASH_LITE_MODEL
    return normalized


def current_month_key(now: datetime | None = None) -> str:
    dt = now or datetime.now(_JST)
    return dt.astimezone(_JST).strftime("%Y-%m")


def monthly_budget_usd() -> float:
    return _float_env("GEMINI_MONTHLY_BUDGET_USD", DEFAULT_MONTHLY_BUDGET_USD)


def usd_jpy_rate() -> float:
    return _float_env("GEMINI_BUDGET_USD_JPY", DEFAULT_USD_JPY)


def usage_path() -> Path:
    raw = os.getenv("GEMINI_USAGE_PATH")
    if raw:
        return Path(raw).expanduser().resolve()
    return Path(__file__).resolve().parents[3] / ".runtime" / "gemini_usage_budget.json"


def estimate_text_tokens(text: str | None) -> int:
    if not text:
        return 0
    return max(1, math.ceil(len(str(text)) / 2))


def calculate_cost_usd(input_tokens: int, output_tokens: int) -> float:
    return (
        max(0, int(input_tokens)) * GEMINI_FLASH_LITE_INPUT_USD_PER_1M
        + max(0, int(output_tokens)) * GEMINI_FLASH_LITE_OUTPUT_USD_PER_1M
    ) / 1_000_000


def estimate_request_cost(
    *,
    prompt: str,
    max_output_tokens: int,
    model: str | None = None,
) -> dict[str, Any]:
    input_tokens = estimate_text_tokens(prompt)
    output_tokens = max(0, int(max_output_tokens or 0))
    cost_usd = calculate_cost_usd(input_tokens, output_tokens)
    return {
        "model": model or "",
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        "cost_usd": round(cost_usd, 8),
        "estimated": True,
    }


def get_budget_summary() -> dict[str, Any]:
    month = current_month_key()
    budget = monthly_budget_usd()
    rate = usd_jpy_rate()
    data, corrupt_error = _load_usage()
    if corrupt_error:
        return _summary_payload(
            month=month,
            budget_usd=budget,
            usd_jpy=rate,
            used_usd=0.0,
            events=[],
            storage_status="corrupt",
            error=corrupt_error,
        )

    events = [event for event in data.get("events", []) if event.get("month") == month]
    used_usd = sum(float(event.get("cost_usd") or 0) for event in events)
    return _summary_payload(
        month=month,
        budget_usd=budget,
        usd_jpy=rate,
        used_usd=used_usd,
        events=events,
        storage_status="ok",
        error=None,
    )


def assert_gemini_budget_available(
    *,
    model: str | None,
    prompt: str,
    max_output_tokens: int,
    feature: str,
) -> dict[str, Any] | None:
    if not is_gemini_model(model):
        return None

    data, corrupt_error = _load_usage()
    if corrupt_error:
        raise GeminiBudgetExceeded(
            "gemini_budget_storage_corrupt: Gemini usage budget file is unreadable; "
            "Gemini execution is blocked to avoid uncontrolled spend."
        )
    _save_usage(data)

    summary = get_budget_summary()
    estimate = estimate_request_cost(
        prompt=prompt,
        max_output_tokens=max_output_tokens,
        model=model,
    )
    projected = float(summary["used_usd"]) + float(estimate["cost_usd"])
    if projected > float(summary["budget_usd"]):
        raise GeminiBudgetExceeded(
            "gemini_budget_exceeded: monthly Gemini budget would be exceeded "
            f"(used=${summary['used_usd']:.4f}, estimate=${estimate['cost_usd']:.4f}, "
            f"budget=${summary['budget_usd']:.2f}, feature={feature})."
        )
    return estimate


def record_gemini_usage(
    *,
    model: str | None,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int | None = None,
    feature: str,
    estimated: bool = False,
    request_estimate: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if not is_gemini_model(model):
        return None

    input_tokens = max(0, int(prompt_tokens or 0))
    output_tokens = max(0, int(completion_tokens or 0))
    event = {
        "id": uuid.uuid4().hex[:12],
        "month": current_month_key(),
        "created_at": datetime.now(_JST).isoformat(),
        "feature": feature,
        "model": model or "",
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": int(total_tokens or (input_tokens + output_tokens)),
        "cost_usd": round(calculate_cost_usd(input_tokens, output_tokens), 8),
        "estimated": bool(estimated),
    }
    if request_estimate:
        event["request_estimate"] = request_estimate

    data, corrupt_error = _load_usage()
    if corrupt_error:
        raise GeminiBudgetExceeded("gemini_budget_storage_corrupt: cannot record Gemini usage.")
    data.setdefault("events", []).append(event)
    _save_usage(data)
    return event


def record_gemini_usage_from_response(
    *,
    model: str | None,
    prompt: str,
    output_text: str,
    max_output_tokens: int,
    usage_metadata: dict[str, Any] | None,
    feature: str,
    request_estimate: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    usage = usage_metadata or {}
    prompt_tokens = _first_int(
        usage.get("promptTokenCount"),
        usage.get("prompt_token_count"),
        estimate_text_tokens(prompt),
    )
    output_tokens = _first_int(
        usage.get("candidatesTokenCount"),
        usage.get("candidates_token_count"),
        estimate_text_tokens(output_text) or max_output_tokens,
    )
    total_tokens = _first_int(
        usage.get("totalTokenCount"),
        usage.get("total_token_count"),
        prompt_tokens + output_tokens,
    )
    has_real_usage = bool(usage_metadata) and (
        usage.get("promptTokenCount") is not None
        or usage.get("candidatesTokenCount") is not None
        or usage.get("totalTokenCount") is not None
    )
    return record_gemini_usage(
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=output_tokens,
        total_tokens=total_tokens,
        feature=feature,
        estimated=not has_real_usage,
        request_estimate=request_estimate,
    )


def reset_budget_for_dev() -> dict[str, Any]:
    if os.getenv("RENDER") and os.getenv("ALLOW_GEMINI_BUDGET_RESET") != "1":
        raise PermissionError("Gemini budget reset is disabled in production.")
    data = {"version": 1, "events": []}
    _save_usage(data)
    return get_budget_summary()


def _summary_payload(
    *,
    month: str,
    budget_usd: float,
    usd_jpy: float,
    used_usd: float,
    events: list[dict[str, Any]],
    storage_status: str,
    error: str | None,
) -> dict[str, Any]:
    remaining_usd = max(0.0, budget_usd - used_usd)
    usage_ratio = (used_usd / budget_usd) if budget_usd > 0 else 1.0
    threshold_ratio = usage_ratio + 1e-9
    if storage_status != "ok":
        status = "unknown"
    elif threshold_ratio >= 1:
        status = "exceeded"
    elif threshold_ratio >= 0.9:
        status = "danger"
    elif threshold_ratio >= 0.7:
        status = "warning"
    else:
        status = "ok"
    recent_events = sorted(events, key=lambda item: str(item.get("created_at", "")), reverse=True)[:10]
    return {
        "ok": storage_status == "ok",
        "month": month,
        "budget_usd": round(budget_usd, 4),
        "used_usd": round(used_usd, 8),
        "remaining_usd": round(remaining_usd, 8),
        "usage_ratio": round(usage_ratio, 6),
        "used_jpy_estimate": round(used_usd * usd_jpy),
        "budget_jpy_estimate": round(budget_usd * usd_jpy),
        "usd_jpy": usd_jpy,
        "status": status,
        "storage_status": storage_status,
        "error": error,
        "events": recent_events,
        "pricing": {
            "model": GEMINI_FLASH_LITE_MODEL,
            "input_usd_per_1m": GEMINI_FLASH_LITE_INPUT_USD_PER_1M,
            "output_usd_per_1m": GEMINI_FLASH_LITE_OUTPUT_USD_PER_1M,
        },
    }


def _load_usage() -> tuple[dict[str, Any], str | None]:
    path = usage_path()
    if not path.exists():
        return {"version": 1, "events": []}, None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"version": 1, "events": []}, str(exc)
    if not isinstance(data, dict):
        return {"version": 1, "events": []}, "usage file root is not an object"
    events = data.get("events")
    if not isinstance(events, list):
        return {"version": 1, "events": []}, "usage file events is not a list"
    return data, None


def _save_usage(data: dict[str, Any]) -> None:
    path = usage_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=str(path.parent),
        delete=False,
        prefix=f".{path.name}.",
        suffix=".tmp",
    ) as tmp:
        tmp.write(payload)
        tmp_path = Path(tmp.name)
    tmp_path.replace(path)


def _float_env(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
        return value if value > 0 else default
    except Exception:
        return default


def _first_int(*values: Any) -> int:
    for value in values:
        try:
            if value is None:
                continue
            return int(value)
        except Exception:
            continue
    return 0
