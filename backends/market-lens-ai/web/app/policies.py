"""URL validation, allowlist, and SSRF protection."""

from __future__ import annotations

import ipaddress
import json
import os
import socket
from pathlib import Path
from urllib.parse import urlparse

MAX_URLS = 6
POLITE_DELAY_SEC = 2.0

_BLOCKED_HOSTNAMES = {"localhost", "metadata.google.internal"}


def load_allowlist(path: str | None = None) -> list[dict]:
    """Load allowlist from ALLOWLIST_JSON env, then ALLOWLIST_PATH file fallback.

    Priority:
      1. ALLOWLIST_JSON env var (JSON string)
      2. ALLOWLIST_PATH env var or path argument (file path)
      3. Empty list (no allowlist configured)
    """
    # Priority 1: ALLOWLIST_JSON environment variable
    json_env = os.getenv("ALLOWLIST_JSON")
    if json_env:
        try:
            data = json.loads(json_env)
        except json.JSONDecodeError as e:
            raise ValueError(
                f"ALLOWLIST_JSON contains invalid JSON: {e}"
            ) from e
        return data.get("domains", [])

    # Priority 2: File-based allowlist
    path = path or os.getenv("ALLOWLIST_PATH", "config/domain_allowlist.json")
    p = Path(path)
    if not p.exists():
        return []
    data = json.loads(p.read_text(encoding="utf-8"))
    return data.get("domains", [])


def allowed_domains(path: str | None = None) -> list[str]:
    return [
        d["domain"]
        for d in load_allowlist(path)
        if d.get("allowed", False)
    ]


def _is_private_ip(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or ip_str == "169.254.169.254"
    )


def _check_ssrf(url: str) -> str | None:
    """Shared SSRF checks for all URL validation paths.

    Returns an error message string if the URL is blocked, None if OK.
    Checks: scheme, hostname presence, blocked hostnames, IP literal,
    DNS resolution to private/reserved IPs.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        return "Invalid URL"

    if parsed.scheme not in ("http", "https"):
        return f"Scheme '{parsed.scheme}' is not allowed (http/https only)"

    hostname = parsed.hostname
    if not hostname:
        return "No hostname in URL"

    if hostname in _BLOCKED_HOSTNAMES:
        return f"Hostname '{hostname}' is blocked"

    # Check if IP literal
    try:
        if _is_private_ip(hostname):
            return f"Private/reserved IP '{hostname}' is blocked"
    except Exception:
        pass

    # DNS resolution check
    try:
        infos = socket.getaddrinfo(hostname, None)
        for _, _, _, _, sockaddr in infos:
            ip = sockaddr[0]
            if _is_private_ip(ip):
                return f"Hostname '{hostname}' resolves to private IP '{ip}'"
    except socket.gaierror:
        return f"Cannot resolve hostname '{hostname}'"

    return None


def validate_url(url: str, allowlist_path: str | None = None) -> str | None:
    """SSRF protection only. Allowlist enforcement removed for internal tool use."""
    return _check_ssrf(url)


def validate_operator_url(url: str) -> str | None:
    """Validate URL with SSRF protection but WITHOUT allowlist check.

    Used by Pack B routes (discovery, compare, generation) where operators
    submit arbitrary competitor URLs. SSRF defences (private IP, loopback,
    metadata IP, blocked hostnames) are still enforced.
    """
    return _check_ssrf(url)


def _domain_in_allowlist(hostname: str, domains: list[str]) -> bool:
    for d in domains:
        if hostname == d or hostname.endswith("." + d):
            return True
    return False


def validate_urls(urls: list[str], allowlist_path: str | None = None) -> list[str]:
    """Return list of error messages. Empty list means all OK."""
    errors: list[str] = []
    if not urls:
        errors.append("At least one URL is required")
        return errors
    if len(urls) > MAX_URLS:
        errors.append(f"Maximum {MAX_URLS} URLs allowed, got {len(urls)}")
        return errors
    if len(set(urls)) != len(urls):
        errors.append("Duplicate URLs are not allowed")
        return errors
    for url in urls:
        err = validate_url(url, allowlist_path)
        if err:
            errors.append(f"{url}: {err}")
    return errors
