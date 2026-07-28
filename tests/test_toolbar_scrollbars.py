from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_tag_toolbar_keeps_horizontal_scroll_but_hides_scrollbar():
    app_css = (ROOT / "pwa" / "css" / "app.css").read_text(encoding="utf-8")

    assert ".toolbar-row { display: flex; gap: 4px; overflow-x: auto;" in app_css
    assert ".toolbar-row--tags { scrollbar-width: none; }" in app_css
    assert ".toolbar-row--tags::-webkit-scrollbar { display: none; }" in app_css


def test_quick_phrase_toolbar_keeps_horizontal_scroll_but_hides_scrollbar():
    app_css = (ROOT / "pwa" / "css" / "app.css").read_text(encoding="utf-8")

    assert ".toolbar-row { display: flex; gap: 4px; overflow-x: auto;" in app_css
    assert ".toolbar-row--quick-phrases { scrollbar-width: none; }" in app_css
    assert ".toolbar-row--quick-phrases::-webkit-scrollbar { display: none; }" in app_css


def test_every_toolbar_row_uses_mouse_wheel_horizontal_scrolling():
    toolbar_js = (ROOT / "pwa" / "js" / "toolbar.js").read_text(encoding="utf-8")

    assert "function enableToolbarRowWheelScroll()" in toolbar_js
    assert "document.querySelectorAll('.toolbar-row').forEach(row =>" in toolbar_js
    assert "row.addEventListener('wheel'" in toolbar_js
    assert "row.scrollLeft + e.deltaY * multiplier" in toolbar_js
    assert "e.preventDefault();" in toolbar_js
    assert "{ passive: false }" in toolbar_js


def test_toolbar_wheel_allows_page_scroll_at_horizontal_boundaries():
    toolbar_js = (ROOT / "pwa" / "js" / "toolbar.js").read_text(encoding="utf-8")

    assert "const maxScrollLeft = Math.max(0, row.scrollWidth - row.clientWidth);" in toolbar_js
    assert "if (maxScrollLeft === 0) return;" in toolbar_js
    assert "if (Math.abs(nextScrollLeft - row.scrollLeft) < 0.5) return;" in toolbar_js


def test_mobile_touch_and_trackpad_horizontal_gestures_remain_native():
    toolbar_js = (ROOT / "pwa" / "js" / "toolbar.js").read_text(encoding="utf-8")

    assert "if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;" in toolbar_js
    assert "touchstart" not in toolbar_js
    assert "touchmove" not in toolbar_js
