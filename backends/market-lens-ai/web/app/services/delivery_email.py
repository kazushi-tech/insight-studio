"""Email delivery service (Phase 8).

Sends digest reports via email. Uses a pluggable transport
(defaults to logging in dev; production uses SendGrid/Resend).
"""

from __future__ import annotations

import html
import logging
from typing import Protocol

logger = logging.getLogger("market-lens.delivery.email")


class EmailTransport(Protocol):
    """Interface for email sending backends."""

    async def send(self, to: str, subject: str, html_body: str) -> bool: ...


class LogEmailTransport:
    """Dev/test transport that just logs the email."""

    async def send(self, to: str, subject: str, html_body: str) -> bool:
        logger.info("EMAIL [to=%s] subject=%s body_len=%d", to, subject, len(html_body))
        return True


class EmailDeliveryService:
    """Delivers digest reports via email."""

    def __init__(self, transport: EmailTransport | None = None):
        self._transport = transport or LogEmailTransport()

    async def send_digest(
        self,
        to: str,
        subject: str,
        summary: str,
        changes: list[dict] | None = None,
    ) -> bool:
        """Send a digest email."""
        changes = changes or []
        change_rows = "".join(
            f"<tr><td>{html.escape(c.get('url', ''))}</td>"
            f"<td>{html.escape(c.get('summary', ''))}</td></tr>"
            for c in changes
        )
        html_body = f"""
        <h2>{html.escape(subject)}</h2>
        <p>{html.escape(summary)}</p>
        {"<table border='1'><tr><th>URL</th><th>Changes</th></tr>" + change_rows + "</table>" if changes else ""}
        <p><small>Sent by Market Lens AI</small></p>
        """
        return await self._transport.send(to, subject, html_body)
