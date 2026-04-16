"""Tests for delivery services — HTML escape, Slack mrkdwn escape, target validation."""

from __future__ import annotations

import pytest


# ---------------------------------------------------------------------------
# Email HTML Escape (Stage 1-4)
# ---------------------------------------------------------------------------

class TestEmailHTMLEscape:
    @pytest.mark.asyncio
    async def test_html_escape_in_subject(self):
        from web.app.services.delivery_email import EmailDeliveryService

        captured = {}

        class CaptureTransport:
            async def send(self, to, subject, html_body):
                captured["html"] = html_body
                return True

        svc = EmailDeliveryService(transport=CaptureTransport())
        await svc.send_digest(
            to="test@test.com",
            subject="<script>alert('xss')</script>",
            summary="Normal summary",
        )
        assert "<script>" not in captured["html"]
        assert "&lt;script&gt;" in captured["html"]

    @pytest.mark.asyncio
    async def test_html_escape_in_summary(self):
        from web.app.services.delivery_email import EmailDeliveryService

        captured = {}

        class CaptureTransport:
            async def send(self, to, subject, html_body):
                captured["html"] = html_body
                return True

        svc = EmailDeliveryService(transport=CaptureTransport())
        await svc.send_digest(
            to="test@test.com",
            subject="Safe Subject",
            summary='<img src=x onerror="alert(1)">',
        )
        # Raw HTML tags should be escaped
        assert "<img" not in captured["html"]
        assert "&lt;img" in captured["html"]

    @pytest.mark.asyncio
    async def test_html_escape_in_changes(self):
        from web.app.services.delivery_email import EmailDeliveryService

        captured = {}

        class CaptureTransport:
            async def send(self, to, subject, html_body):
                captured["html"] = html_body
                return True

        svc = EmailDeliveryService(transport=CaptureTransport())
        await svc.send_digest(
            to="test@test.com",
            subject="Report",
            summary="ok",
            changes=[
                {"url": "<script>bad</script>", "summary": "<b>bold</b>"},
            ],
        )
        assert "<script>bad</script>" not in captured["html"]
        assert "&lt;script&gt;" in captured["html"]
        assert "&lt;b&gt;" in captured["html"]


# ---------------------------------------------------------------------------
# Slack mrkdwn Escape (Stage 1-4)
# ---------------------------------------------------------------------------

class TestSlackMrkdwnEscape:
    @pytest.mark.asyncio
    async def test_slack_escape_summary(self):
        from web.app.services.delivery_slack import SlackDeliveryService

        captured = {}

        class CaptureTransport:
            async def post(self, webhook_url, payload):
                captured["payload"] = payload
                return True

        svc = SlackDeliveryService(transport=CaptureTransport())
        await svc.send_digest(
            webhook_url="https://hooks.slack.com/test",
            title="Test",
            summary="Check <https://evil.com|click> & more",
        )
        blocks = captured["payload"]["blocks"]
        summary_text = blocks[1]["text"]["text"]
        assert "<https://evil.com" not in summary_text
        assert "&amp;" in summary_text

    @pytest.mark.asyncio
    async def test_slack_escape_changes(self):
        from web.app.services.delivery_slack import SlackDeliveryService

        captured = {}

        class CaptureTransport:
            async def post(self, webhook_url, payload):
                captured["payload"] = payload
                return True

        svc = SlackDeliveryService(transport=CaptureTransport())
        await svc.send_digest(
            webhook_url="https://hooks.slack.com/test",
            title="Test",
            summary="ok",
            changes=[{"url": "https://example.com", "summary": "a <b> change & more"}],
        )
        blocks = captured["payload"]["blocks"]
        change_text = blocks[2]["text"]["text"]
        assert "&amp;" in change_text
        assert "&lt;b&gt;" in change_text


# ---------------------------------------------------------------------------
# Auth module unit tests
# ---------------------------------------------------------------------------

class TestAuthModule:
    @pytest.mark.asyncio
    async def test_verify_token_mvp_mode(self):
        from web.app.auth import verify_token
        result = await verify_token(None, None)
        assert result == "dev"

    @pytest.mark.asyncio
    async def test_verify_auth_optional_mvp_mode(self):
        from web.app.auth import verify_auth_optional
        result = await verify_auth_optional(None, None)
        assert result == "dev"
