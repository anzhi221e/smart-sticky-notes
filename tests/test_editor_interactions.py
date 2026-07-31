from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_editor_save_is_guarded_against_double_submit():
    editor_js = (ROOT / "pwa" / "js" / "editor.js").read_text(encoding="utf-8")

    assert "let _isSaving = false;" in editor_js
    assert "if (_isSaving) return;" in editor_js
    assert "saveButton.disabled = true;" in editor_js
    assert "const bubble = _editingBubble;" in editor_js
    assert "saveStatus.update('保存失败：" in editor_js
    assert "alert('保存失败:" not in editor_js


def test_note_menu_ignores_active_editor_interactions():
    notes_js = (ROOT / "pwa" / "js" / "notes.js").read_text(encoding="utf-8")

    assert "function isEditingTarget(bubble, target)" in notes_js
    assert "if (isEditingTarget(bubble, e.target)) return;" in notes_js
    assert "if (isEditingTarget(bubble, e.target)) return;" in notes_js
