from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_workspace_dropdown_is_height_limited_and_scrollable():
    app_css = (ROOT / "pwa" / "css" / "app.css").read_text(encoding="utf-8")
    app_js = (ROOT / "pwa" / "js" / "app.js").read_text(encoding="utf-8")

    assert "max-height: min(360px, calc(100vh - 96px))" in app_css
    assert "overflow-y: auto" in app_css
    assert "overscroll-behavior: contain" in app_css
    assert ".workspace-dropdown { scrollbar-width: none; }" in app_css
    assert ".workspace-dropdown::-webkit-scrollbar { display: none; }" in app_css
    assert "workspaceDropdownMaxHeight" in app_js
    assert "window.innerHeight - rect.bottom - 12" in app_js


def test_main_notes_content_keeps_overflow_but_hides_scrollbar():
    app_css = (ROOT / "pwa" / "css" / "app.css").read_text(encoding="utf-8")

    assert ".notes-list {" in app_css
    assert "flex: 1; overflow-y: auto; padding: 16px;" in app_css
    assert ".notes-list { scrollbar-width: none; }" in app_css
    assert ".notes-list::-webkit-scrollbar { display: none; }" in app_css
