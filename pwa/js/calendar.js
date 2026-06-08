import { fetchNotesByDateRange, fetchNoteDates } from './db.js';
import { renderNoteBubble } from './notes.js';

const content = () => document.getElementById('calendar-content');

export async function renderCalendarDay(date) {
    const c = content();
    c.innerHTML = '';
    const from = new Date(date); from.setHours(0, 0, 0, 0);
    const to = new Date(date); to.setHours(23, 59, 59, 999);

    let notes;
    try {
        notes = await fetchNotesByDateRange(from.toISOString(), to.toISOString());
    } catch { notes = []; }

    const header = document.createElement('h3');
    header.style.cssText = 'font-size:16px;margin-bottom:12px;';
    header.textContent = date.toLocaleDateString('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    });
    c.appendChild(header);

    if (notes.length === 0) {
        const empty = document.createElement('p');
        empty.style.color = 'var(--text-secondary)';
        empty.textContent = '当天没有笔记';
        c.appendChild(empty);
    } else {
        notes.forEach(n => c.appendChild(renderNoteBubble(n)));
    }
}

export async function renderCalendarWeek(date) {
    const c = content();
    c.innerHTML = '';
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

    const notesByDay = {};
    notes.forEach(n => {
        const d = n.created_at.split('T')[0];
        if (!notesByDay[d]) notesByDay[d] = [];
        notesByDay[d].push(n);
    });

    const grid = document.createElement('div');
    grid.className = 'week-grid';
    for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        const ds = d.toISOString().split('T')[0];
        const cell = document.createElement('div');
        cell.className = 'week-day';
        cell.textContent = d.getDate();
        if (ds === date.toISOString().split('T')[0]) cell.classList.add('selected');
        if (notesByDay[ds]) cell.classList.add('has-notes');
        cell.addEventListener('click', () => renderCalendarDay(d));
        grid.appendChild(cell);
    }
    c.appendChild(grid);

    const selectedDay = date.toISOString().split('T')[0];
    const dayNotes = notesByDay[selectedDay] || [];
    const list = document.createElement('div');
    list.style.cssText = 'margin-top:16px;';
    if (dayNotes.length > 0) {
        dayNotes.forEach(n => list.appendChild(renderNoteBubble(n)));
    }
    c.appendChild(list);
}

export async function renderCalendarMonth(date) {
    const c = content();
    c.innerHTML = '';
    const year = date.getFullYear();
    const month = date.getMonth();

    let dates;
    try { dates = await fetchNoteDates(); } catch { dates = []; }
    const dateSet = new Set(dates.map(d => d.split('T')[0]));

    const header = document.createElement('h3');
    header.style.cssText = 'text-align:center;margin-bottom:12px;font-size:16px;';
    header.textContent = `${year} 年 ${month + 1} 月`;
    c.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'month-grid';
    ['一', '二', '三', '四', '五', '六', '日'].forEach(d => {
        const dh = document.createElement('div');
        dh.className = 'day-header';
        dh.textContent = d;
        grid.appendChild(dh);
    });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;

    for (let i = 0; i < startOffset; i++) {
        grid.appendChild(document.createElement('div'));
    }

    const today = new Date().toISOString().split('T')[0];
    for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const cell = document.createElement('div');
        cell.className = 'day-cell';
        cell.textContent = d;
        if (ds === today) cell.classList.add('today');
        if (dateSet.has(ds)) cell.classList.add('has-notes');
        cell.addEventListener('click', () => renderCalendarDay(new Date(year, month, d)));
        grid.appendChild(cell);
    }
    c.appendChild(grid);
}

export async function renderCalendarYear(date) {
    const c = content();
    c.innerHTML = '';
    const year = date.getFullYear();
    const from = new Date(year, 0, 1).toISOString();
    const to = new Date(year, 11, 31, 23, 59, 59, 999).toISOString();

    let notes;
    try { notes = await fetchNotesByDateRange(from, to); } catch { notes = []; }

    const countByMonth = new Array(12).fill(0);
    const summaryByMonth = new Array(12).fill(null).map(() => []);
    notes.forEach(n => {
        const m = new Date(n.created_at).getMonth();
        countByMonth[m]++;
        if (summaryByMonth[m].length < 2) {
            summaryByMonth[m].push((n.text || '').substring(0, 30));
        }
    });

    const header = document.createElement('h3');
    header.style.cssText = 'text-align:center;margin-bottom:12px;font-size:16px;';
    header.textContent = `${year} 年`;
    c.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'year-grid';
    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月',
        '7月', '8月', '9月', '10月', '11月', '12月'];
    for (let m = 0; m < 12; m++) {
        const card = document.createElement('div');
        card.className = 'year-card';
        card.innerHTML = `
            <div class="month-name">${monthNames[m]}</div>
            <div class="note-count">${countByMonth[m]}</div>
        `;
        card.addEventListener('click', () => renderCalendarMonth(new Date(year, m, 1)));
        grid.appendChild(card);
    }
    c.appendChild(grid);
}
