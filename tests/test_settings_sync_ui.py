from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_settings_shows_last_sync_without_manual_sync_request_button():
    settings_js = (ROOT / "pwa" / "js" / "settings.js").read_text(encoding="utf-8")

    assert "last_sync_at" in settings_js
    assert "sync-status-hint" in settings_js
    assert "cfg-sync-now" not in settings_js
    assert "sync_requests" not in settings_js
