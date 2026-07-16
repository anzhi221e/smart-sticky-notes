from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_tag_summary_orders_tags_by_most_recent_note_update():
    db_js = (ROOT / "pwa" / "js" / "db.js").read_text(encoding="utf-8")

    assert "export async function fetchTagSummary(workspace = null)" in db_js
    assert ".select('tags, updated_at')" in db_js
    assert ".order('updated_at', { ascending: false })" in db_js
    assert "recentTags.push(tag)" in db_js
    assert "return { tagCounts, recentTags };" in db_js


def test_toolbar_shows_all_tags_in_recent_order_and_keeps_pinned_tags_first():
    app_js = (ROOT / "pwa" / "js" / "app.js").read_text(encoding="utf-8")
    editor_js = (ROOT / "pwa" / "js" / "editor.js").read_text(encoding="utf-8")
    toolbar_js = (ROOT / "pwa" / "js" / "toolbar.js").read_text(encoding="utf-8")

    assert "renderTagBar(recentTags, pinned);" in app_js
    assert "fetchTagSummary(getCurrentWorkspace())" in editor_js
    assert "const sorted = [...validPinned, ...tags.filter(t => !validPinned.includes(t))];" in toolbar_js
    assert "sorted.forEach(tag =>" in toolbar_js
    assert "sorted.slice(0, 12)" not in toolbar_js


def test_new_note_refreshes_tag_order_without_blocking_send():
    app_js = (ROOT / "pwa" / "js" / "app.js").read_text(encoding="utf-8")

    assert "void loadTagBar();" in app_js
