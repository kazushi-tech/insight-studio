"""HTML fetching and screenshot capture."""

from __future__ import annotations

import asyncio
import re
import time
from typing import Optional
from urllib.parse import urljoin

import httpcore
import httpx

from .policies import (
    ResolvedPublicTarget,
    UnsafeUrlError,
    resolve_public_target,
)


_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja,en;q=0.9",
}
_MAX_REDIRECTS = 5
_OFFLINE_CSP = (
    "<meta http-equiv=\"Content-Security-Policy\" content=\""
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; "
    "font-src data:; media-src 'none'; frame-src 'none'; object-src 'none'; "
    "script-src 'none'; base-uri 'none'; form-action 'none'\">"
)
_ACTIVE_HTML_BLOCK_RE = re.compile(
    r"<(?:script|iframe|frame|object|embed|base)\b[^>]*>.*?</(?:script|iframe|frame|object|embed|base)\s*>"
    r"|<(?:iframe|frame|object|embed|base)\b[^>]*?/?>"
    r"|<meta\b(?=[^>]*http-equiv\s*=\s*['\"]?refresh\b)[^>]*>",
    re.IGNORECASE | re.DOTALL,
)


class _PinnedNetworkBackend(httpcore.AsyncNetworkBackend):
    """Connect only to numeric addresses produced by SSRF validation.

    HTTP Core still receives the original hostname in the request URL.  It
    therefore retains the correct Host header, TLS SNI value, and certificate
    hostname verification, while this backend replaces only the raw TCP
    destination.  No hostname is ever handed to the operating-system resolver.
    """

    def __init__(self) -> None:
        self._pins: dict[tuple[str, int], tuple[str, ...]] = {}
        self._delegate = httpcore.AnyIOBackend()

    @staticmethod
    def _key(host: str, port: int) -> tuple[str, int]:
        return (host.rstrip(".").lower(), port)

    def pin(self, target: ResolvedPublicTarget) -> None:
        self._pins[self._key(target.hostname, target.port)] = target.addresses

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options=None,
    ) -> httpcore.AsyncNetworkStream:
        addresses = self._pins.get(self._key(host, port))
        if not addresses:
            raise httpcore.ConnectError("Outbound destination was not pinned")

        deadline = time.monotonic() + timeout if timeout is not None else None
        last_error: Exception | None = None
        for address in addresses:
            remaining = None if deadline is None else max(0.0, deadline - time.monotonic())
            if remaining == 0.0:
                raise httpcore.ConnectTimeout("Pinned connection timed out")
            try:
                return await self._delegate.connect_tcp(
                    address,
                    port,
                    timeout=remaining,
                    local_address=local_address,
                    socket_options=socket_options,
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as exc:
                last_error = exc
        raise httpcore.ConnectError("Pinned connection failed") from last_error

    async def connect_unix_socket(self, path: str, timeout=None, socket_options=None):
        raise httpcore.ConnectError("Unix sockets are not available to URL fetching")

    async def sleep(self, seconds: float) -> None:
        await self._delegate.sleep(seconds)


class _PinnedAsyncHTTPTransport(httpx.AsyncHTTPTransport):
    """HTTPX transport backed by a per-fetch public-address pin registry."""

    def __init__(self, backend: _PinnedNetworkBackend) -> None:
        super().__init__(
            trust_env=False,
            limits=httpx.Limits(max_keepalive_connections=0, max_connections=10),
        )
        # HTTPX 0.28.1 / HTTP Core 1.0.9 are exact-locked by this repository.
        # HTTP Core exposes network_backend on AsyncConnectionPool's public
        # constructor, but HTTPX does not forward it, so replace that one
        # constructor-created backend before the client can make a request.
        self._pool._network_backend = backend


def _prepare_offline_html(html: str) -> str:
    """Add a deny-by-default CSP and remove active navigation containers."""
    inert = _ACTIVE_HTML_BLOCK_RE.sub("", html)
    head = re.search(r"<head\b[^>]*>", inert, flags=re.IGNORECASE)
    if head:
        return f"{inert[:head.end()]}{_OFFLINE_CSP}{inert[head.end():]}"
    return f"{_OFFLINE_CSP}{inert}"


async def _get_with_safe_redirects(
    client: httpx.AsyncClient,
    url: str,
    *,
    pin_backend: _PinnedNetworkBackend,
) -> httpx.Response:
    current_url = url
    for redirect_count in range(_MAX_REDIRECTS + 1):
        try:
            target = resolve_public_target(current_url)
        except UnsafeUrlError as exc:
            raise ValueError("URL is not allowed") from exc
        pin_backend.pin(target)
        response = await client.get(target.url, headers=_BROWSER_HEADERS)
        if response.status_code not in (301, 302, 303, 307, 308):
            return response
        if redirect_count >= _MAX_REDIRECTS:
            await response.aclose()
            raise ValueError("Too many redirects")
        location = response.headers.get("location")
        if not location:
            await response.aclose()
            raise ValueError("Redirect has no destination")
        await response.aclose()
        current_url = urljoin(target.url, location)
    raise ValueError("Too many redirects")


async def fetch_html(
    url: str,
    timeout: float = 25.0,
    *,
    max_retries: int = 2,
) -> tuple[str, Optional[str]]:
    """Fetch HTML content with retry. Returns (html, error)."""
    last_error = ""
    pin_backend = _PinnedNetworkBackend()
    transport = _PinnedAsyncHTTPTransport(pin_backend)
    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=timeout,
        transport=transport,
        trust_env=False,
    ) as client:
        for attempt in range(max_retries + 1):
            try:
                resp = await _get_with_safe_redirects(
                    client,
                    url,
                    pin_backend=pin_backend,
                )
                resp.raise_for_status()
                return resp.text, None
            except httpx.HTTPStatusError as e:
                if e.response.status_code >= 500 and attempt < max_retries:
                    await asyncio.sleep(1 + 2 * attempt)
                    continue
                return "", f"HTTP {e.response.status_code}"
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                last_error = "Connection failed" if isinstance(e, httpx.ConnectError) else "Request timed out"
                if attempt < max_retries:
                    await asyncio.sleep(1 + 2 * attempt)
                    continue
            except ValueError as e:
                return "", str(e)
            except Exception:
                return "", "Request failed"
    return "", last_error


async def take_screenshot(
    url: str, output_path: str, timeout: int = 20000
) -> Optional[str]:
    """Render pinned-fetched HTML in Chromium with all browser networking off."""
    html, fetch_error = await fetch_html(
        url,
        timeout=max(1.0, timeout / 1000),
        max_retries=0,
    )
    if fetch_error:
        return "Screenshot source could not be loaded"
    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            try:
                context = await browser.new_context(
                    viewport={"width": 1280, "height": 800},
                    java_script_enabled=False,
                    service_workers="block",
                )
                page = await context.new_page()

                async def block_all_network(route):
                    await route.abort("blockedbyclient")

                await page.route("**/*", block_all_network)
                await page.set_content(
                    _prepare_offline_html(html),
                    wait_until="domcontentloaded",
                    timeout=timeout,
                )
                await page.screenshot(path=output_path, full_page=False)
                await context.close()
            finally:
                await browser.close()
        return None
    except ImportError:
        return "Playwright is not installed"
    except Exception:
        return "Screenshot failed"
