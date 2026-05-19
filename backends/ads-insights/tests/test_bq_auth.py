"""Tests for BigQuery auth helper."""

from __future__ import annotations

from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from bq import auth


def test_setup_credentials_finds_windows_adc_when_appdata_missing(monkeypatch, tmp_path):
    user_home = tmp_path / "PEM N-266"
    adc = user_home / "AppData" / "Roaming" / "gcloud" / "application_default_credentials.json"
    adc.parent.mkdir(parents=True)
    adc.write_text('{"type":"authorized_user"}', encoding="utf-8")

    monkeypatch.delenv("GOOGLE_CREDENTIALS_JSON", raising=False)
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)
    monkeypatch.delenv("APPDATA", raising=False)
    monkeypatch.setenv("USERPROFILE", str(user_home))
    monkeypatch.setattr(auth, "_credentials_configured", False)

    assert auth.setup_credentials() is True
    assert Path(auth.os.environ["GOOGLE_APPLICATION_CREDENTIALS"]) == adc


def test_setup_credentials_keeps_existing_google_application_credentials(monkeypatch, tmp_path):
    existing = tmp_path / "service-account.json"
    existing.write_text("{}", encoding="utf-8")

    monkeypatch.delenv("GOOGLE_CREDENTIALS_JSON", raising=False)
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(existing))
    monkeypatch.delenv("APPDATA", raising=False)
    monkeypatch.delenv("USERPROFILE", raising=False)
    monkeypatch.setattr(auth, "_credentials_configured", False)

    assert auth.setup_credentials() is True
    assert Path(auth.os.environ["GOOGLE_APPLICATION_CREDENTIALS"]) == existing
