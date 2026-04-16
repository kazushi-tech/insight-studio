"""Tests for URL validation and SSRF protection policies."""

from __future__ import annotations

import json
import socket

import pytest

from web.app.policies import (
    MAX_URLS,
    allowed_domains,
    load_allowlist,
    validate_operator_url,
    validate_url,
    validate_urls,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _public_addrinfo(*args, **kwargs):
    """Fake socket.getaddrinfo that always returns a routable public IP."""
    return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.216.34", 0))]


# ---------------------------------------------------------------------------
# validate_url — scheme checks
# ---------------------------------------------------------------------------

class TestNonHttpSchemeBlocked:
    def test_ftp_scheme(self, tmp_allowlist):
        err = validate_url("ftp://example.com/file", str(tmp_allowlist))
        assert err is not None
        assert "scheme" in err.lower() or "allowed" in err.lower()

    def test_javascript_scheme(self, tmp_allowlist):
        err = validate_url("javascript:alert(1)", str(tmp_allowlist))
        assert err is not None

    def test_file_scheme(self, tmp_allowlist):
        err = validate_url("file:///etc/passwd", str(tmp_allowlist))
        assert err is not None


# ---------------------------------------------------------------------------
# validate_url — private / reserved IP checks
# ---------------------------------------------------------------------------

class TestPrivateIpBlocked:
    def test_loopback_127(self, tmp_allowlist):
        err = validate_url("http://127.0.0.1/admin", str(tmp_allowlist))
        assert err is not None

    def test_private_192(self, tmp_allowlist):
        err = validate_url("http://192.168.1.1/secret", str(tmp_allowlist))
        assert err is not None

    def test_private_10(self, tmp_allowlist):
        err = validate_url("http://10.0.0.1/secret", str(tmp_allowlist))
        assert err is not None

    def test_private_172(self, tmp_allowlist):
        err = validate_url("http://172.16.0.1/secret", str(tmp_allowlist))
        assert err is not None

    def test_link_local_metadata(self, tmp_allowlist):
        err = validate_url("http://169.254.169.254/latest/meta-data/", str(tmp_allowlist))
        assert err is not None

    def test_localhost_hostname(self, tmp_allowlist):
        err = validate_url("http://localhost/admin", str(tmp_allowlist))
        assert err is not None


# ---------------------------------------------------------------------------
# validate_url — allowlist checks
# ---------------------------------------------------------------------------

class TestAllowlistRemovedPublicDomainPasses:
    """Allowlist enforcement removed — any public domain should pass."""

    def test_unknown_domain_passes(self, tmp_allowlist, monkeypatch):
        monkeypatch.setattr(socket, "getaddrinfo", _public_addrinfo)
        err = validate_url("https://evil.com/steal", str(tmp_allowlist))
        assert err is None

    def test_blocked_entry_passes(self, tmp_allowlist, monkeypatch):
        # blocked.com was in file with allowed=False — now passes (no allowlist)
        monkeypatch.setattr(socket, "getaddrinfo", _public_addrinfo)
        err = validate_url("https://blocked.com/page", str(tmp_allowlist))
        assert err is None


class TestAllowlistAllowsKnownDomain:
    def test_allowed_domain_passes(self, tmp_allowlist, monkeypatch):
        monkeypatch.setattr(socket, "getaddrinfo", _public_addrinfo)
        err = validate_url("https://example.com/page", str(tmp_allowlist))
        assert err is None

    def test_allowed_subdomain_passes(self, tmp_allowlist, monkeypatch):
        monkeypatch.setattr(socket, "getaddrinfo", _public_addrinfo)
        err = validate_url("https://www.example.com/page", str(tmp_allowlist))
        assert err is None


# ---------------------------------------------------------------------------
# validate_urls — bulk validation
# ---------------------------------------------------------------------------

class TestDuplicateUrlsRejected:
    def test_duplicate_detected(self, tmp_allowlist):
        urls = ["https://example.com", "https://example.com"]
        errors = validate_urls(urls, str(tmp_allowlist))
        assert errors
        combined = " ".join(errors).lower()
        assert "duplicate" in combined

    def test_unique_urls_pass_duplicate_check(self, tmp_allowlist, monkeypatch):
        monkeypatch.setattr(socket, "getaddrinfo", _public_addrinfo)
        urls = ["https://example.com/a", "https://acme.com/b"]
        errors = validate_urls(urls, str(tmp_allowlist))
        assert errors == []


class TestMaxUrlsExceeded:
    def test_exceeds_max(self, tmp_allowlist):
        urls = [f"https://example.com/{i}" for i in range(MAX_URLS + 1)]
        errors = validate_urls(urls, str(tmp_allowlist))
        assert errors
        combined = " ".join(errors).lower()
        assert "maximum" in combined or "max" in combined

    def test_exactly_max_passes_count_check(self, tmp_allowlist, monkeypatch):
        monkeypatch.setattr(socket, "getaddrinfo", _public_addrinfo)
        urls = [f"https://example.com/{i}" for i in range(MAX_URLS)]
        errors = validate_urls(urls, str(tmp_allowlist))
        # All URLs point to example.com which is allowed — no errors expected
        assert errors == []

    def test_empty_list_rejected(self, tmp_allowlist):
        errors = validate_urls([], str(tmp_allowlist))
        assert errors


# ---------------------------------------------------------------------------
# allowed_domains helper
# ---------------------------------------------------------------------------

class TestAllowedDomains:
    def test_returns_only_allowed(self, tmp_allowlist):
        domains = allowed_domains(str(tmp_allowlist))
        assert "example.com" in domains
        assert "acme.com" in domains
        assert "blocked.com" not in domains

    def test_missing_file_returns_empty(self, tmp_path):
        p = tmp_path / "nonexistent.json"
        assert allowed_domains(str(p)) == []

    def test_empty_domains_list(self, tmp_path):
        p = tmp_path / "empty.json"
        p.write_text('{"domains": []}', encoding="utf-8")
        assert allowed_domains(str(p)) == []


# ---------------------------------------------------------------------------
# ALLOWLIST_JSON environment variable
# ---------------------------------------------------------------------------

class TestAllowlistJson:
    def test_load_from_env(self, monkeypatch):
        payload = json.dumps({
            "domains": [
                {"domain": "staging.example.com", "allowed": True}
            ]
        })
        monkeypatch.setenv("ALLOWLIST_JSON", payload)
        result = load_allowlist()
        assert len(result) == 1
        assert result[0]["domain"] == "staging.example.com"

    def test_invalid_json_raises(self, monkeypatch):
        monkeypatch.setenv("ALLOWLIST_JSON", "{broken json")
        with pytest.raises(ValueError, match="invalid JSON"):
            load_allowlist()

    def test_env_takes_priority_over_file(self, monkeypatch, tmp_allowlist):
        payload = json.dumps({
            "domains": [
                {"domain": "env-priority.com", "allowed": True}
            ]
        })
        monkeypatch.setenv("ALLOWLIST_JSON", payload)
        result = load_allowlist(path=str(tmp_allowlist))
        assert len(result) == 1
        assert result[0]["domain"] == "env-priority.com"

    def test_empty_allowlist_json(self, monkeypatch):
        monkeypatch.setenv("ALLOWLIST_JSON", '{"domains": []}')
        result = load_allowlist()
        assert result == []


# ---------------------------------------------------------------------------
# validate_operator_url — SSRF protection WITHOUT allowlist
# ---------------------------------------------------------------------------

class TestOperatorUrlSsrfBlocked:
    """Operator URLs skip allowlist but SSRF defences must still apply."""

    def test_private_ip_blocked(self):
        err = validate_operator_url("http://192.168.1.1/page")
        assert err is not None
        assert "private" in err.lower() or "blocked" in err.lower()

    def test_loopback_blocked(self):
        err = validate_operator_url("http://127.0.0.1/admin")
        assert err is not None

    def test_metadata_ip_blocked(self):
        err = validate_operator_url("http://169.254.169.254/latest/meta-data/")
        assert err is not None

    def test_localhost_hostname_blocked(self):
        err = validate_operator_url("http://localhost/secret")
        assert err is not None

    def test_ftp_scheme_blocked(self):
        err = validate_operator_url("ftp://example.com/file")
        assert err is not None


class TestOperatorUrlAllowlistSkipped:
    """Operator URLs should pass even for domains NOT on the allowlist."""

    def test_unlisted_domain_passes(self, monkeypatch):
        monkeypatch.setattr(socket, "getaddrinfo", _public_addrinfo)
        err = validate_operator_url("https://competitor-not-in-allowlist.com/lp")
        assert err is None

    def test_public_domain_passes(self, monkeypatch):
        monkeypatch.setattr(socket, "getaddrinfo", _public_addrinfo)
        err = validate_operator_url("https://any-public-site.co.jp/banner")
        assert err is None


# ---------------------------------------------------------------------------
# DNS rebinding — validate_operator_url blocks hostnames resolving to private IPs
# ---------------------------------------------------------------------------

class TestDnsRebindingBlocked:
    """Hostnames that resolve to private IPs must be blocked even via operator URL."""

    def test_resolves_to_10_network(self, monkeypatch):
        def _fake(*a, **kw):
            return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("10.0.0.1", 0))]
        monkeypatch.setattr(socket, "getaddrinfo", _fake)
        err = validate_operator_url("https://rebind-10.attacker.com/steal")
        assert err is not None
        assert "private" in err.lower()

    def test_resolves_to_172_16_network(self, monkeypatch):
        def _fake(*a, **kw):
            return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("172.16.5.5", 0))]
        monkeypatch.setattr(socket, "getaddrinfo", _fake)
        err = validate_operator_url("https://rebind-172.attacker.com/steal")
        assert err is not None
        assert "private" in err.lower()

    def test_resolves_to_192_168_network(self, monkeypatch):
        def _fake(*a, **kw):
            return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("192.168.0.99", 0))]
        monkeypatch.setattr(socket, "getaddrinfo", _fake)
        err = validate_operator_url("https://rebind-192.attacker.com/steal")
        assert err is not None
        assert "private" in err.lower()
