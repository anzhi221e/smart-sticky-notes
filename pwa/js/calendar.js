import { fetchNotesByDateRange } from './db.js';
import { renderNoteBubble } from './notes.js';

const content = () => document.getElementById('calendar-content');
const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];
let _calendarRenderVersion = 0;

function localDateKey(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('-');
}

function noteDateKey(note) {
    return localDateKey(new Date(note.created_at));
}

function groupNotesByDay(notes) {
    const notesByDay = {};
    notes.forEach(note => {
        const key = noteDateKey(note);
        if (!notesByDay[key]) notesByDay[key] = [];
        notesByDay[key].push(note);
    });
    return notesByDay;
}

function setActiveCalendarView(view) {
    document.querySelectorAll('.cal-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.view === view);
    });
}

function createPeriodNavigation(label, previousLabel, nextLabel, onPrevious, onNext) {
    const nav = document.createElement('div');
    nav.className = 'calendar-period-nav';

    const previous = document.createElement('button');
    previous.className = 'calendar-period-button';
    previous.type = 'button';
    previous.setAttribute('aria-label', previousLabel);
    previous.textContent = '‹';
    previous.addEventListener('click', onPrevious);

    const title = document.createElement('h3');
    title.className = 'calendar-period-title';
    title.textContent = label;

    const next = document.createElement('button');
    next.className = 'calendar-period-button';
    next.type = 'button';
    next.setAttribute('aria-label', nextLabel);
    next.textContent = '›';
    next.addEventListener('click', onNext);

    nav.append(previous, title, next);
    return nav;
}

function appendNoteCount(cell, count) {
    if (!count) return;
    cell.classList.add('has-notes');
    const badge = document.createElement('span');
    badge.className = 'calendar-note-count';
    badge.textContent = count;
    badge.setAttribute('aria-label', `${count} 条笔记`);
    cell.appendChild(badge);
}

function getDayTags(notes) {
    const tags = [];
    notes.forEach(note => {
        (note.tags || []).forEach(tag => {
            if (!tags.includes(tag)) tags.push(tag);
        });
    });
    return tags;
}

function filterNotesBySelectedTags(notes, selectedTags, allTagCount) {
    if (selectedTags.size === allTagCount) return notes;
    return notes.filter(note => {
        return (note.tags || []).some(tag => selectedTags.has(tag));
    });
}

function appendDayNotes(container, date, notes, showEmpty = true) {
    const section = document.createElement('section');
    section.className = 'calendar-day-detail';

    const header = document.createElement('h3');
    header.className = 'calendar-day-title';
    header.textContent = date.toLocaleDateString('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    });
    section.appendChild(header);

    const dayTags = getDayTags(notes);
    const selectedTags = new Set(dayTags);
    const noteList = document.createElement('div');
    noteList.className = 'calendar-day-notes';

    const renderFilteredNotes = () => {
        const visibleNotes = filterNotesBySelectedTags(notes, selectedTags, dayTags.length);
        noteList.replaceChildren();
        if (visibleNotes.length) {
            visibleNotes.forEach(note => noteList.appendChild(renderNoteBubble(note)));
            return;
        }
        if (!showEmpty) return;
        const empty = document.createElement('p');
        empty.className = 'calendar-day-empty';
        empty.textContent = notes.length ? '没有符合当前标签筛选的笔记' : '当天没有笔记';
        noteList.appendChild(empty);
    };

    if (dayTags.length) {
        const filters = document.createElement('div');
        filters.className = 'calendar-tag-filters';
        filters.setAttribute('aria-label', '按标签筛选当天笔记');

        dayTags.forEach(tag => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'calendar-tag-filter is-selected';
            button.textContent = `#${tag}`;
            button.setAttribute('aria-pressed', 'true');
            button.addEventListener('click', () => {
                if (selectedTags.has(tag)) selectedTags.delete(tag);
                else selectedTags.add(tag);
                const isSelected = selectedTags.has(tag);
                button.classList.toggle('is-selected', isSelected);
                button.setAttribute('aria-pressed', String(isSelected));
                renderFilteredNotes();
            });
            filters.appendChild(button);
        });
        section.appendChild(filters);
    }

    renderFilteredNotes();
    section.appendChild(noteList);
    container.appendChild(section);
}

function createDayCell(className, date, selectedKey, notes, onClick, weekday = null) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = className;
    const key = localDateKey(date);
    if (key === selectedKey) cell.classList.add('selected');

    if (weekday !== null) {
        const weekdayLabel = document.createElement('span');
        weekdayLabel.className = 'week-day-label';
        weekdayLabel.textContent = weekday;
        cell.appendChild(weekdayLabel);
    }

    const dayNumber = document.createElement('span');
    dayNumber.className = 'calendar-day-number';
    dayNumber.textContent = date.getDate();
    cell.appendChild(dayNumber);
    appendNoteCount(cell, notes.length);
    cell.addEventListener('click', onClick);
    return cell;
}

function shiftMonthClamped(date, offset) {
    const year = date.getFullYear();
    const month = date.getMonth() + offset;
    const lastDay = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(date.getDate(), lastDay));
}

function replaceCalendarContent(container, newContent) {
    container.replaceChildren(newContent);
    container.scrollTop = 0;
}

export async function renderCalendarDay(date) {
    setActiveCalendarView('day');
    const renderVersion = ++_calendarRenderVersion;
    const from = new Date(date); from.setHours(0, 0, 0, 0);
    const to = new Date(date); to.setHours(23, 59, 59, 999);

    let notes;
    try {
        notes = await fetchNotesByDateRange(from.toISOString(), to.toISOString());
    } catch { notes = []; }
    if (renderVersion !== _calendarRenderVersion) return;

    const c = content();
    const fragment = document.createDocumentFragment();
    appendDayNotes(fragment, date, notes);
    replaceCalendarContent(c, fragment);
}

export async function renderCalendarWeek(date) {
    setActiveCalendarView('week');
    const renderVersion = ++_calendarRenderVersion;
    const day = date.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const startOfWeek = new Date(date);
    startOfWeek.setDate(date.getDate() + mondayOffset);
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    let notes;
    try {
        notes = await fetchNotesByDateRange(startOfWeek.toISOString(), endOfWeek.toISOString());
    } catch { notes = []; }
    if (renderVersion !== _calendarRenderVersion) return;

    const selectedKey = localDateKey(date);
    const notesByDay = groupNotesByDay(notes);
    const c = content();
    const fragment = document.createDocumentFragment();

    const weekLabel = startOfWeek.getMonth() === endOfWeek.getMonth()
        ? `${startOfWeek.getFullYear()}年${startOfWeek.getMonth() + 1}月${startOfWeek.getDate()}日–${endOfWeek.getDate()}日`
        : `${startOfWeek.getMonth() + 1}月${startOfWeek.getDate()}日–${endOfWeek.getMonth() + 1}月${endOfWeek.getDate()}日`;
    fragment.appendChild(createPeriodNavigation(
        weekLabel,
        '上一周',
        '下一周',
        () => {
            const previousWeek = new Date(date);
            previousWeek.setDate(previousWeek.getDate() - 7);
            renderCalendarWeek(previousWeek);
        },
        () => {
            const nextWeek = new Date(date);
            nextWeek.setDate(nextWeek.getDate() + 7);
            renderCalendarWeek(nextWeek);
        },
    ));

    const grid = document.createElement('div');
    grid.className = 'week-grid';
    for (let i = 0; i < 7; i++) {
        const current = new Date(startOfWeek);
        current.setDate(startOfWeek.getDate() + i);
        const currentKey = localDateKey(current);
        const currentNotes = notesByDay[currentKey] || [];
        grid.appendChild(createDayCell(
            'week-day',
            current,
            selectedKey,
            currentNotes,
            () => renderCalendarWeek(current),
            WEEKDAY_NAMES[i],
        ));
    }
    fragment.appendChild(grid);
    appendDayNotes(fragment, date, notesByDay[selectedKey] || []);
    replaceCalendarContent(c, fragment);
}

export async function renderCalendarMonth(date) {
    setActiveCalendarView('month');
    const renderVersion = ++_calendarRenderVersion;
    const year = date.getFullYear();
    const month = date.getMonth();
    const from = new Date(year, month, 1);
    const to = new Date(year, month + 1, 0, 23, 59, 59, 999);

    let notes;
    try {
        notes = await fetchNotesByDateRange(from.toISOString(), to.toISOString());
    } catch { notes = []; }
    if (renderVersion !== _calendarRenderVersion) return;

    const notesByDay = groupNotesByDay(notes);
    const selectedKey = localDateKey(date);
    const todayKey = localDateKey(new Date());
    const c = content();
    const fragment = document.createDocumentFragment();

    fragment.appendChild(createPeriodNavigation(
        `${year}年${month + 1}月`,
        '上一个月',
        '下一个月',
        () => renderCalendarMonth(shiftMonthClamped(date, -1)),
        () => renderCalendarMonth(shiftMonthClamped(date, 1)),
    ));

    const grid = document.createElement('div');
    grid.className = 'month-grid';
    WEEKDAY_NAMES.forEach(dayName => {
        const dayHeader = document.createElement('div');
        dayHeader.className = 'day-header';
        dayHeader.textContent = dayName;
        grid.appendChild(dayHeader);
    });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;
    for (let i = 0; i < startOffset; i++) {
        const spacer = document.createElement('div');
        spacer.className = 'month-grid-spacer';
        grid.appendChild(spacer);
    }

    for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
        const current = new Date(year, month, dayNumber);
        const currentKey = localDateKey(current);
        const currentNotes = notesByDay[currentKey] || [];
        const cell = createDayCell(
            'day-cell',
            current,
            selectedKey,
            currentNotes,
            () => renderCalendarMonth(current),
        );
        if (currentKey === todayKey) cell.classList.add('today');
        grid.appendChild(cell);
    }
    fragment.appendChild(grid);
    appendDayNotes(fragment, date, notesByDay[selectedKey] || []);
    replaceCalendarContent(c, fragment);
}

export async function renderCalendarYear(date) {
    setActiveCalendarView('year');
    const renderVersion = ++_calendarRenderVersion;
    const year = date.getFullYear();
    const from = new Date(year, 0, 1).toISOString();
    const to = new Date(year, 11, 31, 23, 59, 59, 999).toISOString();

    let notes;
    try { notes = await fetchNotesByDateRange(from, to); } catch { notes = []; }
    if (renderVersion !== _calendarRenderVersion) return;

    const countByMonth = new Array(12).fill(0);
    notes.forEach(note => {
        countByMonth[new Date(note.created_at).getMonth()]++;
    });

    const c = content();
    const fragment = document.createDocumentFragment();
    const header = document.createElement('h3');
    header.style.cssText = 'text-align:center;margin-bottom:12px;font-size:16px;';
    header.textContent = `${year} 年`;
    fragment.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'year-grid';
    for (let month = 0; month < 12; month++) {
        const card = document.createElement('div');
        card.className = 'year-card';
        card.innerHTML = `
            <div class="month-name">${month + 1}月</div>
            <div class="note-count">${countByMonth[month]}</div>
        `;
        card.addEventListener('click', () => renderCalendarMonth(new Date(year, month, 1)));
        grid.appendChild(card);
    }
    fragment.appendChild(grid);
    replaceCalendarContent(c, fragment);
}
