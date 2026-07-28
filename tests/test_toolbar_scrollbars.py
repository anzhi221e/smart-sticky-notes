from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_tag_toolbar_keeps_horizontal_scroll_but_hides_scrollbar():
    app_css = (ROOT / "pwa" / "css" / "app.css").read_text(encoding="utf-8")

    assert ".toolbar-row { display: flex; gap: 4px; overflow-x: auto;" in app_css
    assert ".toolbar-row--tags { scrollbar-width: none; }" in app_css
    assert ".toolbar-row--tags::-webkit-scrollbar { display: none; }" in app_css


def test_quick_phrase_toolbar_keeps_horizontal_scroll_but_hides_scrollbar():
    app_css = (ROOT / "pwa" / "css" / "app.css").read_text(encoding="utf-8")
    toolbar_js = (ROOT / "pwa" / "js" / "toolbar.js").read_text(encoding="utf-8")

    assert ".toolbar-row { display: flex; gap: 4px; overflow-x: auto;" in app_css
    assert ".toolbar-row--quick-phrases { scrollbar-width: none; }" in app_css
    assert ".toolbar-row--quick-phrases::-webkit-scrollbar { display: none; }" in app_css
    assert "function enableQuickPhraseWheelScroll()" in toolbar_js
    assert "bar.addEventListener('wheel'" in toolbar_js
    assert "bar.scrollLeft + e.deltaY * multiplier" in toolbar_js
    assert "e.preventDefault();" in toolbar_js
    assert "{ passive: false }" in toolbar_js


def test_quick_phrase_wheel_allows_page_scroll_at_horizontal_boundaries():
    toolbar_js = (ROOT / "pwa" / "js" / "toolbar.js").read_text(encoding="utf-8")

    assert "const maxScrollLeft = Math.max(0, bar.scrollWidth - bar.clientWidth);" in toolbar_js
    assert "if (maxScrollLeft === 0) return;" in toolbar_js
    assert "if (Math.abs(nextScrollLeft - bar.scrollLeft) < 0.5) return;" in toolbar_js
