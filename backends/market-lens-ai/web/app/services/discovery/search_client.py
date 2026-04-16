"""Abstract search client and shared types."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class SearchResult:
    """Single result from a search provider."""

    url: str
    title: str
    snippet: str


class SearchClient(ABC):
    """Abstract interface for web search providers."""

    @abstractmethod
    async def search(
        self, query: str, *, num: int = 10, brand_context: str = "",
        deadline: float | None = None, request_id: str | None = None,
    ) -> list[SearchResult]:
        """Execute a search query and return results."""
        ...


class SearchClientError(Exception):
    """Raised when search client encounters an error."""
