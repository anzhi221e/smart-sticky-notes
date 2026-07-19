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
