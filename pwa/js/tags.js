import { fetchTags, fetchNotesByTag, softDeleteNote, readConfig, writeConfig } from './db.js';
import { renderNoteBubble } from './notes.js';
import { showToast, navigateTo } from './ui.js';

export async function showTagsView() {
    navigateTo('tags');
    const content = document.getElementById('tags-content');
    if (!content) return;

    let tags, cfg;
    try { tags = await fetchTags(); } catch { tags = {}; }
    try { cfg = await readConfig(); } catch { cfg = {}; }
    const pinned = JSON.parse(cfg.pinned_tags || '[]');
    const sorted = Object.entries(tags).sort((a, b) => b[1] - a[1]);
    let mode = 'card';

    content.innerHTML = `
        <div style="display:flex;justify-content:flex-end;padding:8px 16px;">
            <button id="tags-mode-toggle" class="icon-btn" aria-label="切换视图">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                </svg>
            </button>
        </div>
        <div id="tags-grid" class="tag-cards-grid"></div>
    `;

    const grid = document.getElementById('tags-grid');
    renderTagItems(grid, sorted, pinned, mode);

    document.getElementById('tags-mode-toggle').addEventListener('click', () => {
        mode = mode === 'card' ? 'list' : 'card';
        grid.className = mode === 'card' ? 'tag-cards-grid' : 'tag-list';
        renderTagItems(grid, sorted, pinned, mode);
    });
}

async function renderTagItems(container, sorted, pinned, mode) {
    container.innerHTML = '';
    const ordered = [...sorted];
    ordered.sort((a, b) => {
        const aPin = pinned.includes(a[0]) ? -1 : 0;
        const bPin = pinned.includes(b[0]) ? -1 : 0;
        return aPin - bPin || b[1] - a[1];
    });

    for (const [tag, count] of ordered) {
        const card = document.createElement('div');
        card.className = mode === 'card' ? 'tag-card' : 'tag-list-item';
        const isPinned = pinned.includes(tag);
        card.innerHTML = `
            <div class="tag-card-header">
                <span class="tag-name">${isPinned ? '<svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;display:inline-block;"><path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/></svg> ' : ''}#${tag}</span>
                <span class="tag-count">${count} 条</span>
            </div>
        `;
        card.addEventListener('click', () => showTagNotes(tag));
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showTagContextMenu(e, tag, count, isPinned);
        });
        container.appendChild(card);
    }
}

function showTagContextMenu(e, tag, count, isPinned) {
    document.querySelector('.context-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = Math.min(e.clientX, window.innerWidth - 190) + 'px';
    menu.style.top = e.clientY + 'px';
    menu.innerHTML = `
        <button class="context-item" data-action="pin">${isPinned ? '取消置顶' : '📌 置顶'}</button>
        <button class="context-item context-item--danger" data-action="delete">删除标签笔记 (${count})</button>
    `;
    menu.querySelector('[data-action="pin"]').addEventListener('click', async () => {
        const cfg = await readConfig();
        let pinned = JSON.parse(cfg.pinned_tags || '[]');
        if (isPinned) pinned = pinned.filter(t => t !== tag);
        else pinned.push(tag);
        await writeConfig('pinned_tags', JSON.stringify(pinned));
        menu.remove();
        showTagsView();
    });
    menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
        if (confirm(`确定删除 #${tag} 下的 ${count} 条笔记？\n它们将移至回收站，30 天后自动清除。`)) {
            batchDeleteTag(tag);
        }
        menu.remove();
    });
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}

async function batchDeleteTag(tag) {
    const notes = await fetchNotesByTag(tag);
    for (const note of notes) await softDeleteNote(note.id);
    showToast(`已删除 ${notes.length} 条笔记`);
    showTagsView();
}

async function showTagNotes(tag) {
    navigateTo('tags');
    const content = document.getElementById('tags-content');
    const notes = await fetchNotesByTag(tag);
    content.innerHTML = `
        <div style="padding:8px 16px;display:flex;align-items:center;gap:8px;">
            <button id="tag-notes-back" class="icon-btn">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <h2>#${tag}</h2>
        </div>
    `;
    if (notes.length === 0) {
        const empty = document.createElement('p');
        empty.style.cssText = 'padding:24px;color:var(--text-secondary);text-align:center;';
        empty.textContent = '没有该标签的笔记';
        content.appendChild(empty);
    } else {
        notes.forEach(n => content.appendChild(renderNoteBubble(n)));
    }
    document.getElementById('tag-notes-back').addEventListener('click', showTagsView);
}
