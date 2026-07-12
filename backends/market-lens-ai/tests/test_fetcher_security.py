"""Redirect-aware SSRF tests for URL fetching."""

from __future__ import annotations

import socket
import ssl
from unittest.mock import AsyncMock

import httpcore
import httpx
import pytest

from web.app import fetcher
from web.app.policies import resolve_public_target


def _public_addrinfo(*args, **kwargs):
    return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.216.34", 0))]


def test_offline_html_removes_active_navigation_and_adds_csp():
    rendered = fetcher._prepare_offline_html(
        "<html><head><meta http-equiv='refresh' content='0;url=file:///etc/passwd'>"
        "<base href='https://example.com/'></head><body>"
        "<iframe src='file:///etc/passwd'></iframe><script>fetch('/x')</script>"
        "<p>safe</p></body></html>"
    )
    assert "default-src 'none'" in rendered
    assert "refresh" not in rendered.lower()
    assert "<base" not in rendered.lower()
    assert "<iframe" not in rendered.lower()
    assert "<script" not in rendered.lower()
    assert "<p>safe</p>" in rendered


class _FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requested = []

    async def get(self, url, headers=None):
        self.requested.append(url)
        return self.responses.pop(0)


class _MemoryTlsStream(httpcore.AsyncNetworkStream):
    def __init__(self):
        self.writes = []
        self.server_hostname = None
        self.ssl_context = None
        self._response = (
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
        )

    async def read(self, max_bytes, timeout=None):
        response, self._response = self._response, b""
        return response

    async def write(self, buffer, timeout=None):
        self.writes.append(buffer)

    async def aclose(self):
        return None

    async def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        self.ssl_context = ssl_context
        self.server_hostname = server_hostname
        return self

    def get_extra_info(self, info):
        if info == "is_readable":
            return False
        return None


@pytest.mark.anyio
async def test_redirect_to_private_ipv4_is_rejected(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _public_addrinfo)
    response = httpx.Response(
        302,
        headers={"location": "http://127.0.0.1/admin"},
        request=httpx.Request("GET", "https://example.com/start"),
    )
    client = _FakeClient([response])
    pins = fetcher._PinnedNetworkBackend()

    with pytest.raises(ValueError, match="not allowed"):
        await fetcher._get_with_safe_redirects(
            client,
            "https://example.com/start",
            pin_backend=pins,
        )
    assert client.requested == ["https://example.com/start"]


@pytest.mark.anyio
async def test_every_public_redirect_hop_is_revalidated(monkeypatch):
    seen_hosts = []

    def _dns(host, *args, **kwargs):
        seen_hosts.append(host)
        return _public_addrinfo()

    monkeypatch.setattr(socket, "getaddrinfo", _dns)
    first = httpx.Response(
        302,
        headers={"location": "https://cdn.example.net/final"},
        request=httpx.Request("GET", "https://example.com/start"),
    )
    final = httpx.Response(
        200,
        text="ok",
        request=httpx.Request("GET", "https://cdn.example.net/final"),
    )
    client = _FakeClient([first, final])
    pins = fetcher._PinnedNetworkBackend()

    response = await fetcher._get_with_safe_redirects(
        client,
        "https://example.com/start",
        pin_backend=pins,
    )
    assert response.text == "ok"
    assert seen_hosts == ["example.com", "cdn.example.net"]


@pytest.mark.anyio
async def test_same_host_dns_rebinding_is_rejected_before_second_request(monkeypatch):
    resolutions = iter(
        [
            _public_addrinfo(),
            [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("127.0.0.1", 0))],
        ]
    )
    monkeypatch.setattr(socket, "getaddrinfo", lambda *args, **kwargs: next(resolutions))
    redirect = httpx.Response(
        302,
        headers={"location": "/private"},
        request=httpx.Request("GET", "https://example.com/start"),
    )
    client = _FakeClient([redirect])

    with pytest.raises(ValueError, match="not allowed"):
        await fetcher._get_with_safe_redirects(
            client,
            "https://example.com/start",
            pin_backend=fetcher._PinnedNetworkBackend(),
        )
    assert client.requested == ["https://example.com/start"]


@pytest.mark.anyio
async def test_pinned_backend_never_passes_hostname_to_network_backend(monkeypatch):
    target = resolve_public_target(
        "https://example.com/path",
        resolver=lambda *args, **kwargs: _public_addrinfo(),
    )
    backend = fetcher._PinnedNetworkBackend()
    backend.pin(target)
    sentinel_stream = object()
    delegate = AsyncMock()
    delegate.connect_tcp.return_value = sentinel_stream
    backend._delegate = delegate

    # A resolver rebinding after validation is irrelevant: connect_tcp uses
    # only the numeric address held by the pin registry.
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("127.0.0.1", 0))
        ],
    )
    stream = await backend.connect_tcp("example.com", 443, timeout=2.0)

    assert stream is sentinel_stream
    delegate.connect_tcp.assert_awaited_once()
    assert delegate.connect_tcp.await_args.args[:2] == ("93.184.216.34", 443)


@pytest.mark.anyio
async def test_pinning_preserves_host_header_tls_sni_and_certificate_verification():
    target = resolve_public_target(
        "https://example.com/path",
        resolver=lambda *args, **kwargs: _public_addrinfo(),
    )
    backend = fetcher._PinnedNetworkBackend()
    backend.pin(target)
    stream = _MemoryTlsStream()
    delegate = AsyncMock()
    delegate.connect_tcp.return_value = stream
    backend._delegate = delegate

    async with httpx.AsyncClient(
        transport=fetcher._PinnedAsyncHTTPTransport(backend),
        trust_env=False,
    ) as client:
        response = await client.get(target.url)

    assert response.text == "ok"
    assert stream.server_hostname == "example.com"
    assert stream.ssl_context.check_hostname is True
    assert stream.ssl_context.verify_mode == ssl.CERT_REQUIRED
    request_bytes = b"".join(stream.writes).lower()
    assert b"host: example.com\r\n" in request_bytes
    assert b"93.184.216.34" not in request_bytes


@pytest.mark.anyio
async def test_unpinned_hostname_is_never_connected():
    backend = fetcher._PinnedNetworkBackend()
    backend._delegate = AsyncMock()

    with pytest.raises(httpx.ConnectError):
        # HTTP Core's error is mapped to HTTPX only at the transport boundary;
        # invoke that boundary to prove an unpinned request fails closed.
        transport = fetcher._PinnedAsyncHTTPTransport(backend)
        async with httpx.AsyncClient(transport=transport, trust_env=False) as client:
            await client.get("https://example.com/")
    backend._delegate.connect_tcp.assert_not_awaited()


@pytest.mark.anyio
async def test_fetch_error_does_not_expose_url_host_or_address(monkeypatch):
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("169.254.169.254", 0))
        ],
    )
    submitted = "https://private-answer.attacker.test/latest/secret"

    html, error = await fetcher.fetch_html(submitted, max_retries=0)

    assert html == ""
    assert error == "URL is not allowed"
    assert submitted not in error
    assert "private-answer.attacker.test" not in error
    assert "169.254.169.254" not in error


@pytest.mark.anyio
@pytest.mark.parametrize(
    "location",
    [
        "http://[::1]/admin",
        "http://[fe80::1]/admin",
        "http://[::ffff:127.0.0.1]/admin",
        "https://example.net:8443/admin",
        "file:///etc/passwd",
    ],
)
async def test_unsafe_redirect_variants_are_rejected(monkeypatch, location):
    monkeypatch.setattr(socket, "getaddrinfo", _public_addrinfo)
    response = httpx.Response(
        302,
        headers={"location": location},
        request=httpx.Request("GET", "https://example.com/start"),
    )
    client = _FakeClient([response])

    with pytest.raises(ValueError, match="not allowed"):
        await fetcher._get_with_safe_redirects(
            client,
            "https://example.com/start",
            pin_backend=fetcher._PinnedNetworkBackend(),
        )
    assert client.requested == ["https://example.com/start"]


@pytest.mark.anyio
async def test_screenshot_renders_pinned_html_with_browser_network_disabled(monkeypatch, tmp_path):
    page = type("FakePage", (), {})()
    page.route_handler = None

    async def _route(pattern, handler):
        assert pattern == "**/*"
        page.route_handler = handler

    page.route = _route
    page.set_content = AsyncMock()
    page.screenshot = AsyncMock()

    context = type("FakeContext", (), {})()
    context.new_page = AsyncMock(return_value=page)
    context.close = AsyncMock()

    browser = type("FakeBrowser", (), {})()
    browser.new_context = AsyncMock(return_value=context)
    browser.close = AsyncMock()

    chromium = type("FakeChromium", (), {})()
    chromium.launch = AsyncMock(return_value=browser)
    playwright = type("FakePlaywright", (), {"chromium": chromium})()

    class _PlaywrightManager:
        async def __aenter__(self):
            return playwright

        async def __aexit__(self, *args):
            return None

    monkeypatch.setattr(
        fetcher,
        "fetch_html",
        AsyncMock(return_value=("<html><img src='http://127.0.0.1/x'></html>", None)),
    )
    monkeypatch.setattr(
        "playwright.async_api.async_playwright",
        lambda: _PlaywrightManager(),
    )

    result = await fetcher.take_screenshot(
        "https://example.com/page",
        str(tmp_path / "shot.png"),
    )

    assert result is None
    browser.new_context.assert_awaited_once_with(
        viewport={"width": 1280, "height": 800},
        java_script_enabled=False,
        service_workers="block",
    )
    page.set_content.assert_awaited_once()
    rendered_html = page.set_content.await_args.args[0]
    assert "Content-Security-Policy" in rendered_html
    assert "default-src 'none'" in rendered_html
    assert "127.0.0.1" in rendered_html  # inert markup is safe; no browser fetch occurs
    page.screenshot.assert_awaited_once()
    assert page.route_handler is not None

    blocked_route = type("FakeRoute", (), {})()
    blocked_route.abort = AsyncMock()
    await page.route_handler(blocked_route)
    blocked_route.abort.assert_awaited_once_with("blockedbyclient")
