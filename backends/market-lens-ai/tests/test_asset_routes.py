"""Tests for creative asset upload / retrieve / delete routes."""

from __future__ import annotations

import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from web.app.repositories.file_asset_repository import FileAssetRepository
from web.app.routers.creative_asset_routes import create_asset_router


PNG_1PX = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
)


@pytest.fixture
def client(tmp_path):
    repo = FileAssetRepository(base_dir=tmp_path / "assets")
    app = FastAPI()
    app.include_router(create_asset_router(repo))
    return TestClient(app)


class TestUploadRoute:
    def test_upload_png(self, client):
        resp = client.post(
            "/api/assets",
            files={"file": ("banner.png", io.BytesIO(PNG_1PX), "image/png")},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["file_name"] == "banner.png"
        assert body["mime_type"] == "image/png"
        assert "asset_id" in body

    def test_upload_rejected_mime(self, client):
        resp = client.post(
            "/api/assets",
            files={"file": ("script.js", io.BytesIO(b"alert(1)"), "text/javascript")},
        )
        assert resp.status_code == 422
        assert "Unsupported file type" in resp.json()["detail"]

    def test_upload_empty_file(self, client):
        resp = client.post(
            "/api/assets",
            files={"file": ("empty.png", io.BytesIO(b""), "image/png")},
        )
        assert resp.status_code == 422
        assert "Empty file" in resp.json()["detail"]


class TestRetrieveRoute:
    def test_get_metadata(self, client):
        upload = client.post(
            "/api/assets",
            files={"file": ("b.png", io.BytesIO(PNG_1PX), "image/png")},
        )
        aid = upload.json()["asset_id"]

        resp = client.get(f"/api/assets/{aid}")
        assert resp.status_code == 200
        assert resp.json()["asset_id"] == aid

    def test_get_not_found(self, client):
        resp = client.get("/api/assets/000000000000")
        assert resp.status_code == 404

    def test_download(self, client):
        upload = client.post(
            "/api/assets",
            files={"file": ("b.png", io.BytesIO(PNG_1PX), "image/png")},
        )
        aid = upload.json()["asset_id"]

        resp = client.get(f"/api/assets/{aid}/download")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.content == PNG_1PX


class TestDeleteRoute:
    def test_delete(self, client):
        upload = client.post(
            "/api/assets",
            files={"file": ("b.png", io.BytesIO(PNG_1PX), "image/png")},
        )
        aid = upload.json()["asset_id"]

        resp = client.delete(f"/api/assets/{aid}")
        assert resp.status_code == 204

        resp = client.get(f"/api/assets/{aid}")
        assert resp.status_code == 404

    def test_delete_not_found(self, client):
        resp = client.delete("/api/assets/000000000000")
        assert resp.status_code == 404
