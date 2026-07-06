from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_quick_phrase_groups_have_migration_and_group_toolbar():
    toolbar_js = (ROOT / "pwa" / "js" / "toolbar.js").read_text(encoding="utf-8")

    assert "function normalizeQuickPhraseData(value)" in toolbar_js
    assert "version: 2" in toolbar_js
    assert "quick-phrase-group-chip" in toolbar_js
    assert "quick-phrase-group-main" in toolbar_js
    assert "quick-phrase-group-arrow" in toolbar_js
    assert "showQuickPhraseGroupSheet" in toolbar_js
    assert "rememberPhraseUse" in toolbar_js


def test_quick_phrase_editor_supports_groups_and_move_menu():
    toolbar_js = (ROOT / "pwa" / "js" / "toolbar.js").read_text(encoding="utf-8")
    app_css = (ROOT / "pwa" / "css" / "app.css").read_text(encoding="utf-8")

    assert "quick-phrase-group-card" in toolbar_js
    assert "quick-phrase-group-name" in toolbar_js
    assert "quick-phrase-drag-handle" in toolbar_js
    assert "showMovePhraseSheet" in toolbar_js
    assert "touchstart" in toolbar_js
    assert "contextmenu" in toolbar_js
    assert ".quick-phrase-sheet-list" in app_css
    assert ".quick-phrase-list--groups::-webkit-scrollbar-button { display: none; }" in app_css
    assert "scrollbar-width: thin" in app_css


def test_quick_phrase_menus_do_not_close_on_backdrop_click():
    toolbar_js = (ROOT / "pwa" / "js" / "toolbar.js").read_text(encoding="utf-8")

    assert "if (e.target === overlay) overlay.remove()" not in toolbar_js
    assert "if (e.target === sheet) sheet.remove()" not in toolbar_js
