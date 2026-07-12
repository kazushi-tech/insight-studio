"""URL validation, allowlist, and SSRF protection."""

from __future__ import annotations

import ipaddress
import json
import os
import re
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import ParseResult, urlparse

MAX_URLS = 6
POLITE_DELAY_SEC = 2.0

_BLOCKED_HOSTNAMES = {"localhost", "metadata.google.internal"}
_HOST_LABEL_RE = re.compile(r"^[a-z0-9-]+$", re.IGNORECASE)
_AMBIGUOUS_NUMERIC_LABEL_RE = re.compile(r"^(?:0x[0-9a-f]+|[0-9]+)$", re.IGNORECASE)


class UnsafeUrlError(ValueError):
    """A customer-safe URL validation failure.

    Messages deliberately describe only the failed rule.  They never include
    the submitted URL, hostname, resolved address, or resolver exception.
    """


@dataclass(frozen=True)
class ResolvedPublicTarget:
    """A normalized URL and the complete, validated address set for one hop."""

    url: str
    scheme: str
    hostname: str
    port: int
    addresses: tuple[str, ...]


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
    # `is_global` also rejects unspecified, multicast and documentation ranges
    # for both IPv4 and IPv6. URL analysis only needs publicly routable hosts.
    return not addr.is_global


def _normalize_hostname(hostname: str) -> str:
    """Return a canonical ASCII hostname or reject ambiguous representations."""
    hostname = hostname.rstrip(".").lower()
    if not hostname or "%" in hostname or "\\" in hostname:
        raise UnsafeUrlError("URL hostname is not allowed")

    try:
        ascii_hostname = hostname.encode("idna").decode("ascii")
    except (UnicodeError, ValueError) as exc:
        raise UnsafeUrlError("URL hostname is not allowed") from exc

    if len(ascii_hostname) > 253:
        raise UnsafeUrlError("URL hostname is not allowed")
    labels = ascii_hostname.split(".")
    if any(
        not label
        or len(label) > 63
        or label.startswith("-")
        or label.endswith("-")
        or not _HOST_LABEL_RE.fullmatch(label)
        for label in labels
    ):
        raise UnsafeUrlError("URL hostname is not allowed")

    # Browsers and OS resolvers accept non-canonical IPv4 forms such as a
    # single decimal integer, octal components, and hexadecimal components.
    # Reject numeric-only host forms before DNS so they cannot be interpreted
    # differently by validation and connection layers.
    if all(_AMBIGUOUS_NUMERIC_LABEL_RE.fullmatch(label) for label in labels):
        raise UnsafeUrlError("Numeric URL host representations are not allowed")
    return ascii_hostname


def _validate_ip_address(value: str) -> str:
    """Normalize one resolver result and require a globally routable address."""
    if "%" in value:
        raise UnsafeUrlError("Private or reserved network destinations are blocked")
    try:
        address = ipaddress.ip_address(value)
    except ValueError as exc:
        raise UnsafeUrlError("URL destination could not be resolved") from exc
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        raise UnsafeUrlError("IPv4-mapped IPv6 destinations are blocked")
    if not address.is_global:
        raise UnsafeUrlError("Private or reserved network destinations are blocked")
    return address.compressed


def _normalized_url(parsed: ParseResult, hostname: str) -> str:
    """Rebuild a URL with the exact host identity used for pinning and TLS."""
    try:
        host_is_ipv6 = isinstance(ipaddress.ip_address(hostname), ipaddress.IPv6Address)
    except ValueError:
        host_is_ipv6 = False
    netloc = f"[{hostname}]" if host_is_ipv6 else hostname
    if parsed.port is not None:
        netloc = f"{netloc}:{parsed.port}"
    return parsed._replace(netloc=netloc, fragment="").geturl()


def resolve_public_target(
    url: str,
    *,
    resolver: Callable[..., Iterable[tuple]] | None = None,
) -> ResolvedPublicTarget:
    """Validate and resolve one outbound HTTP hop exactly once.

    The returned numeric addresses are the only destinations that the network
    transport may use.  Every A and AAAA result must be globally routable; a
    mixed public/private response is rejected in full.
    """
    if not isinstance(url, str) or not url or any(ord(char) < 0x20 for char in url):
        raise UnsafeUrlError("Invalid URL")
    try:
        parsed = urlparse(url)
    except Exception as exc:
        raise UnsafeUrlError("Invalid URL") from exc

    if parsed.scheme not in ("http", "https"):
        raise UnsafeUrlError("Only HTTP and HTTPS URLs are allowed")
    if parsed.username is not None or parsed.password is not None:
        raise UnsafeUrlError("User information in URLs is not allowed")
    if "\\" in parsed.netloc:
        raise UnsafeUrlError("URL hostname is not allowed")

    try:
        explicit_port = parsed.port
    except ValueError as exc:
        raise UnsafeUrlError("URL port is not allowed") from exc
    if explicit_port is not None and explicit_port not in (80, 443):
        raise UnsafeUrlError("URL port is not allowed")

    raw_hostname = parsed.hostname
    if not raw_hostname:
        raise UnsafeUrlError("URL hostname is required")
    stripped_hostname = raw_hostname.rstrip(".").lower()
    if stripped_hostname in _BLOCKED_HOSTNAMES or stripped_hostname.endswith(".localhost"):
        raise UnsafeUrlError("Private or reserved network destinations are blocked")

    port = explicit_port or (443 if parsed.scheme == "https" else 80)
    try:
        literal = ipaddress.ip_address(stripped_hostname)
    except ValueError:
        literal = None

    if literal is not None:
        hostname = literal.compressed
        addresses = (_validate_ip_address(hostname),)
    else:
        hostname = _normalize_hostname(stripped_hostname)
        resolve = resolver or socket.getaddrinfo
        try:
            infos = resolve(hostname, port, type=socket.SOCK_STREAM)
        except (OSError, socket.gaierror) as exc:
            raise UnsafeUrlError("URL destination could not be resolved") from exc

        resolved: list[str] = []
        for info in infos:
            try:
                family, _, _, _, sockaddr = info
                if family not in (socket.AF_INET, socket.AF_INET6):
                    continue
                address = _validate_ip_address(str(sockaddr[0]))
            except (IndexError, TypeError) as exc:
                raise UnsafeUrlError("URL destination could not be resolved") from exc
            if address not in resolved:
                resolved.append(address)
        if not resolved:
            raise UnsafeUrlError("URL destination could not be resolved")
        addresses = tuple(resolved)

    return ResolvedPublicTarget(
        url=_normalized_url(parsed, hostname),
        scheme=parsed.scheme,
        hostname=hostname,
        port=port,
        addresses=addresses,
    )


def _check_ssrf(url: str) -> str | None:
    """Shared SSRF checks for all URL validation paths.

    Returns an error message string if the URL is blocked, None if OK.
    Checks: scheme, hostname presence, blocked hostnames, IP literal,
    DNS resolution to private/reserved IPs.
    """
    try:
        resolve_public_target(url)
    except UnsafeUrlError as exc:
        return str(exc)
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
    for index, url in enumerate(urls, start=1):
        err = validate_url(url, allowlist_path)
        if err:
            errors.append(f"URL {index}: {err}")
    return errors
