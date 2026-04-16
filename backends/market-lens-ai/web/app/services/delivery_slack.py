"""Slack delivery service (Phase 8).

Sends digest reports via Slack Webhook. Uses a pluggable transport.
"""

from __future__ import annotations

import logging
from typing import Protocol

logger = logging.getLogger("market-lens.delivery.slack")


def _escape_mrkdwn(text: str) -> str:
    """Escape Slack mrkdwn special characters in user-supplied text."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class SlackTransport(Protocol):
    """Interface for Slack webhook backends."""

    async def post(self, webhook_url: str, payload: dict) -> bool: ...


class LogSlackTransport:
    """Dev/test transport that just logs the Slack message."""

    async def post(self, webhook_url: str, payload: dict) -> bool:
        logger.info("SLACK [webhook=%s] blocks=%d", webhook_url, len(payload.get("blocks", [])))
        return True


class SlackDeliveryService:
    """Delivers digest reports via Slack Webhook."""

    def __init__(self, transport: SlackTransport | None = None):
        self._transport = transport or LogSlackTransport()

    async def send_digest(
        self,
        webhook_url: str,
        title: str,
        summary: str,
        changes: list[dict] | None = None,
    ) -> bool:
        """Send a digest message to Slack."""
        changes = changes or []
        change_lines = "\n".join(
            f"• <{_escape_mrkdwn(c.get('url', ''))}|{_escape_mrkdwn(c.get('url', ''))}> — {_escape_mrkdwn(c.get('summary', ''))}"
            for c in changes
        )
        blocks = [
            {"type": "header", "text": {"type": "plain_text", "text": title[:150]}},
            {"type": "section", "text": {"type": "mrkdwn", "text": _escape_mrkdwn(summary)}},
        ]
        if change_lines:
            blocks.append(
                {"type": "section", "text": {"type": "mrkdwn", "text": change_lines}}
            )
        blocks.append(
            {"type": "context", "elements": [{"type": "mrkdwn", "text": "_Sent by Market Lens AI_"}]}
        )
        payload = {"blocks": blocks}
        return await self._transport.post(webhook_url, payload)
