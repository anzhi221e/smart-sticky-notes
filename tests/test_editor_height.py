from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_bubble_editor_defaults_to_six_rows():
    editor_js = (ROOT / "pwa" / "js" / "editor.js").read_text(encoding="utf-8")
    app_css = (ROOT / "pwa" / "css" / "app.css").read_text(encoding="utf-8")

    assert '<textarea class="bubble-editor" id="bubble-editor" rows="6">' in editor_js
    assert "min-height: calc(6 * 1.6em + 20px);" in app_css
