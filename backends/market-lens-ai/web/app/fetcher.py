"""HTML fetching and screenshot capture."""

from __future__ import annotations

import asyncio
from typing import Optional

import httpx


_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja,en;q=0.9",
}


async def fetch_html(
    url: str,
    timeout: float = 25.0,
    *,
    max_retries: int = 2,
) -> tuple[str, Optional[str]]:
    """Fetch HTML content with retry. Returns (html, error)."""
    last_error = ""
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
        for attempt in range(max_retries + 1):
            try:
                resp = await client.get(url, headers=_BROWSER_HEADERS)
                resp.raise_for_status()
                return resp.text, None
            except httpx.HTTPStatusError as e:
                if e.response.status_code >= 500 and attempt < max_retries:
                    await asyncio.sleep(1 + 2 * attempt)
                    continue
                return "", f"HTTP {e.response.status_code}"
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                last_error = str(e)
                if attempt < max_retries:
                    await asyncio.sleep(1 + 2 * attempt)
                    continue
            except Exception as e:
                return "", str(e)
    return "", last_error


async def take_screenshot(
    url: str, output_path: str, timeout: int = 20000
) -> Optional[str]:
    """Take a screenshot using Playwright. Returns error message or None."""
    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page(viewport={"width": 1280, "height": 800})
            await page.goto(url, wait_until="networkidle", timeout=timeout)
            await page.screenshot(path=output_path, full_page=False)
            await browser.close()
        return None
    except ImportError:
        return "Playwright is not installed"
    except Exception as e:
        return f"Screenshot failed: {e}"
