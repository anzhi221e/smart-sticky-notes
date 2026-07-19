from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_week_and_month_keep_calendar_visible_when_selecting_a_day():
    calendar_js = (ROOT / "pwa" / "js" / "calendar.js").read_text(encoding="utf-8")

    assert "() => renderCalendarWeek(current)" in calendar_js
    assert "() => renderCalendarMonth(current)" in calendar_js
    assert "appendDayNotes(fragment, date, notesByDay[selectedKey] || []);" in calendar_js
    assert "container.scrollTop = 0;" in calendar_js


def test_week_and_month_have_previous_and_next_navigation():
    calendar_js = (ROOT / "pwa" / "js" / "calendar.js").read_text(encoding="utf-8")

    assert "'上一周'" in calendar_js
    assert "'下一周'" in calendar_js
    assert "previousWeek.getDate() - 7" in calendar_js
    assert "nextWeek.getDate() + 7" in calendar_js
    assert "'上一个月'" in calendar_js
    assert "'下一个月'" in calendar_js
    assert "shiftMonthClamped(date, -1)" in calendar_js
    assert "shiftMonthClamped(date, 1)" in calendar_js


def test_week_and_month_show_note_counts_in_badges():
    calendar_js = (ROOT / "pwa" / "js" / "calendar.js").read_text(encoding="utf-8")
    app_css = (ROOT / "pwa" / "css" / "app.css").read_text(encoding="utf-8")

    assert "badge.className = 'calendar-note-count';" in calendar_js
    assert "badge.textContent = count;" in calendar_js
    assert "appendNoteCount(cell, notes.length);" in calendar_js
    assert ".calendar-note-count {" in app_css
    assert "min-width: 22px; height: 22px;" in app_css
    assert ".day-cell.has-notes::after" not in app_css


def test_today_button_keeps_the_active_calendar_view():
    app_js = (ROOT / "pwa" / "js" / "app.js").read_text(encoding="utf-8")

    assert "document.querySelector('.cal-tab.active')?.dataset.view || 'month'" in app_js
    assert "(fn[activeView] || renderCalendarMonth)(new Date());" in app_js
