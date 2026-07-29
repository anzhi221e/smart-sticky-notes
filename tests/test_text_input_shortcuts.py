from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_text_input_uses_context_aware_enter_shortcuts():
    app_js = (ROOT / "pwa" / "js" / "app.js").read_text(encoding="utf-8")

    assert "if (e.key !== 'Enter' || e.isComposing) return;" in app_js
    assert "if (e.ctrlKey)" in app_js
    assert "keydown-Ctrl+Enter" in app_js
    assert "if (e.shiftKey || isTextInputMultiline(textInput)) return;" in app_js
    assert "keydown-Enter-single-line" in app_js


def test_newlines_are_preserved_for_multiline_editing():
    app_js = (ROOT / "pwa" / "js" / "app.js").read_text(encoding="utf-8")

    assert "function isTextInputMultiline(textInput)" in app_js
    assert r"if (/[\r\n]/.test(textInput.value)) return true;" in app_js
    assert "input-newline" not in app_js
    assert "textInput.value.replace(/[\\r\\n]/g, '')" not in app_js
