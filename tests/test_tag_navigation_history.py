from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_tag_list_and_detail_have_separate_history_states():
    tags_js = (ROOT / "pwa" / "js" / "tags.js").read_text(encoding="utf-8")

    assert "function replaceTagHistoryState(tagsView, extra = {})" in tags_js
    assert "function pushTagHistoryState(tagsView, extra = {})" in tags_js
    assert "replaceTagHistoryState('list'" in tags_js
    assert "pushTagHistoryState('detail', { tag, ascending });" in tags_js


def test_tag_detail_back_button_uses_browser_history():
    tags_js = (ROOT / "pwa" / "js" / "tags.js").read_text(encoding="utf-8")

    assert "if (history.state?.tagsView === 'detail') history.back();" in tags_js
    assert "else showTagsView();" in tags_js


def test_browser_navigation_restores_tag_list_or_detail():
    ui_js = (ROOT / "pwa" / "js" / "ui.js").read_text(encoding="utf-8")
    tags_js = (ROOT / "pwa" / "js" / "tags.js").read_text(encoding="utf-8")

    assert "new CustomEvent('ssn:navigation-applied'" in ui_js
    assert "window.addEventListener('ssn:navigation-applied'" in tags_js
    assert "showTagNotes(state.tag, !!state.ascending, { historyMode: 'none' })" in tags_js
    assert "showTagsView({ historyMode: 'none' })" in tags_js
