"""Tests for VisibleTextElement Pydantic validation."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from web.app.schemas.review_result import VisibleTextElement


class TestVisibleTextElement:
    def test_valid_roles(self):
        for role in ["headline", "sub_copy", "cta", "price", "note", "brand_name"]:
            elem = VisibleTextElement(role=role, text="テスト")
            assert elem.role == role

    def test_invalid_role_rejected(self):
        with pytest.raises(ValidationError, match="role"):
            VisibleTextElement(role="caption", text="テスト")

    def test_empty_role_rejected(self):
        with pytest.raises(ValidationError):
            VisibleTextElement(role="", text="テスト")

    def test_text_required(self):
        with pytest.raises(ValidationError, match="text"):
            VisibleTextElement(role="headline", text="")

    def test_approximate_position_defaults_to_empty(self):
        elem = VisibleTextElement(role="cta", text="購入する")
        assert elem.approximate_position == ""

    def test_approximate_position_set(self):
        elem = VisibleTextElement(role="headline", text="見出し", approximate_position="top-left")
        assert elem.approximate_position == "top-left"

    def test_extra_fields_forbidden(self):
        with pytest.raises(ValidationError):
            VisibleTextElement(role="headline", text="テスト", unknown_field="x")
