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


def test_quick_phrase_toolbar_refreshes_atomically_after_async_load():
    toolbar_js = (ROOT / "pwa" / "js" / "toolbar.js").read_text(encoding="utf-8")
    render_start = toolbar_js.index("export async function renderQuickPhraseBar()")
    render_end = toolbar_js.index("function showQuickPhraseGroupSheet", render_start)
    render_body = toolbar_js[render_start:render_end]

    assert "bar.innerHTML = ''" not in render_body
    assert "const { data } = await getQuickPhrases();" in render_body
    assert "document.createDocumentFragment()" in render_body
    assert "bar.replaceChildren(content);" in render_body
    assert "renderVersion !== _quickPhraseRenderVersion" in render_body


def test_quick_phrase_editor_supports_groups_and_move_menu():
    toolbar_js = (ROOT / "pwa" / "js" / "toolbar.js").read_text(encoding="utf-8")
    app_css = (ROOT / "pwa" / "css" / "app.css").read_text(encoding="utf-8")

    assert "quick-phrase-group-card" in toolbar_js
    assert "quick-phrase-group-name" in toolbar_js
    assert "quick-phrase-drag-handle" in toolbar_js
    assert "startPhraseDrag" in toolbar_js
    assert "document.elementFromPoint" in toolbar_js
    assert "showMovePhraseSheet" not in toolbar_js
    assert "touchstart" not in toolbar_js
    assert "contextmenu" not in toolbar_js
    assert ".quick-phrase-sheet-list" in app_css
    assert ".quick-phrase-list--groups::-webkit-scrollbar-button { display: none; }" in app_css
    assert "scrollbar-width: thin" in app_css
    assert "max-height: min(52vh, 470px)" in app_css


def test_quick_phrase_editor_uses_compact_collapsible_icon_ui():
    toolbar_js = (ROOT / "pwa" / "js" / "toolbar.js").read_text(encoding="utf-8")
    app_css = (ROOT / "pwa" / "css" / "app.css").read_text(encoding="utf-8")

    assert "quick-phrase-group-toggle" in toolbar_js
    assert "quick-phrase-group-count" in toolbar_js
    assert "quick-phrase-group-name-edit" in toolbar_js
    assert "quick-phrase-icon-btn" in toolbar_js
    assert "quick-phrase-icon-btn--delete" in toolbar_js
    assert "quickPhraseIcon('edit')" in toolbar_js
    assert "quickPhraseIcon('trash')" in toolbar_js
    assert "quickPhraseIcon('drag')" in toolbar_js
    assert ".quick-phrase-group-card.is-collapsed" in app_css
    assert ".quick-phrase-icon-btn--delete { color: var(--text-secondary); }" in app_css


def test_quick_phrase_menus_do_not_close_on_backdrop_click():
    toolbar_js = (ROOT / "pwa" / "js" / "toolbar.js").read_text(encoding="utf-8")

    assert "if (e.target === overlay) overlay.remove()" not in toolbar_js
    assert "if (e.target === sheet) sheet.remove()" not in toolbar_js
