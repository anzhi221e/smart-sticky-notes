from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_day_week_and_month_share_the_day_tag_filter_ui():
    calendar_js = (ROOT / "pwa" / "js" / "calendar.js").read_text(encoding="utf-8")

    assert "function getDayTags(notes)" in calendar_js
    assert "function filterNotesBySelectedTags(notes, selectedTags, allTagCount)" in calendar_js
    assert "const selectedTags = new Set(dayTags);" in calendar_js
    assert "filters.className = 'calendar-tag-filters';" in calendar_js
    assert "button.className = 'calendar-tag-filter is-selected';" in calendar_js
    assert "button.setAttribute('aria-pressed', 'true');" in calendar_js
    assert calendar_js.count("appendDayNotes(") >= 4


def test_clicking_a_tag_toggles_selection_and_filters_notes():
    calendar_js = (ROOT / "pwa" / "js" / "calendar.js").read_text(encoding="utf-8")

    assert "if (selectedTags.has(tag)) selectedTags.delete(tag);" in calendar_js
    assert "else selectedTags.add(tag);" in calendar_js
    assert "button.classList.toggle('is-selected', isSelected);" in calendar_js
    assert "return (note.tags || []).some(tag => selectedTags.has(tag));" in calendar_js
    assert "if (selectedTags.size === allTagCount) return notes;" in calendar_js
    assert "没有符合当前标签筛选的笔记" in calendar_js


def test_calendar_tag_filters_have_selected_and_unselected_styles():
    app_css = (ROOT / "pwa" / "css" / "app.css").read_text(encoding="utf-8")

    assert ".calendar-tag-filters {" in app_css
    assert ".calendar-tag-filter {" in app_css
    assert ".calendar-tag-filter.is-selected {" in app_css
