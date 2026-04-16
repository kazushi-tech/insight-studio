"""Tests for industry template endpoints and service."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client():
    from web.app.main import app
    return TestClient(app)


class TestListTemplates:
    def test_list_returns_all(self, client):
        resp = client.get("/api/templates/industries")
        assert resp.status_code == 200
        data = resp.json()
        assert "templates" in data
        ids = [t["id"] for t in data["templates"]]
        assert "real_estate" in ids
        assert "ecommerce" in ids
        assert "beauty" in ids
        assert "b2b" in ids

    def test_template_has_required_fields(self, client):
        resp = client.get("/api/templates/industries")
        for t in resp.json()["templates"]:
            assert "id" in t
            assert "name_ja" in t
            assert "name_en" in t
            assert "rubric_weights" in t
            assert "focus_areas" in t
            assert isinstance(t["focus_areas"], list)

    def test_rubric_weights_sum_to_one(self, client):
        resp = client.get("/api/templates/industries")
        for t in resp.json()["templates"]:
            total = sum(t["rubric_weights"].values())
            assert abs(total - 1.0) < 0.01, f"{t['id']} weights sum to {total}"


class TestGetTemplate:
    def test_get_existing(self, client):
        resp = client.get("/api/templates/industries/real_estate")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "real_estate"
        assert data["name_ja"] == "不動産"
        assert "prompt_augmentation" in data

    def test_get_nonexistent(self, client):
        resp = client.get("/api/templates/industries/nonexistent")
        assert resp.status_code == 404

    def test_each_template_accessible(self, client):
        for tid in ["real_estate", "ecommerce", "beauty", "b2b"]:
            resp = client.get(f"/api/templates/industries/{tid}")
            assert resp.status_code == 200
            assert resp.json()["id"] == tid


class TestServiceLayer:
    def test_get_prompt_augmentation(self):
        from web.app.services.templates.industry_templates import get_prompt_augmentation
        aug = get_prompt_augmentation("beauty")
        assert "美容" in aug
        assert get_prompt_augmentation("nonexistent") == ""

    def test_list_templates_no_prompt(self):
        from web.app.services.templates.industry_templates import list_templates
        templates = list_templates()
        for t in templates:
            assert "prompt_augmentation" not in t
