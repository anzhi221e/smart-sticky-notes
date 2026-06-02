import { fetchTags, fetchNotesByTag, softDeleteNote, readConfig, writeConfig } from './db.js';
import { renderNoteBubble } from './notes.js';
import { showToast, navigateTo, getTagColor, getPalette } from './ui.js';

export async function showTagsView() {
    navigateTo('tags');
    const content = document.getElementById('tags-content');
    if (!content) return;

    let tags;
    try { tags = await fetchTags(); } catch { tags = {}; }
    let cfg;
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

    const isMulti = document.documentElement.dataset.multi === '1';
    const tagColors = JSON.parse((await readConfig().catch(() => ({}))).tag_colors || '{}');

    for (const [tag, count] of ordered) {
        const card = document.createElement('div');
        card.className = mode === 'card' ? 'tag-card' : 'tag-list-item';
        const isPinned = pinned.includes(tag);

        // Apply tag color in multi-color mode
        if (isMulti) {
            const color = getTagColor(tag, tagColors);
            if (mode === 'card') {
                if (color.startsWith('linear-gradient')) {
                    card.style.background = color.replace('135deg', '100deg');
                    card.style.color = '#fff';
                    card.style.border = 'none';
                } else {
                    card.style.background = color;
                    card.style.color = '#fff';
                    card.style.border = 'none';
                }
            } else {
                if (color.startsWith('linear-gradient')) {
                    card.style.background = color.replace('135deg', '90deg');
                } else {
                    card.style.background = color;
                }
                card.style.color = '#fff';
            }
        }

        card.innerHTML = `
            <div class="tag-card-header">
                <span class="tag-name">${isPinned ? '<svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;display:inline-block;"><path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/></svg> ' : ''}#${tag}</span>
                <span class="tag-count">${count} 条</span>
            </div>
            <div class="tag-card-preview" id="preview-${tag}">...</div>
        `;
        card.addEventListener('click', () => showTagNotes(tag));
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showTagContextMenu(e, tag, count, isPinned);
        });
        container.appendChild(card);
    }

    // Load previews lazily
    for (const [tag] of ordered) {
        const preview = container.querySelector(`#preview-${tag}`);
        if (!preview) continue;
        try {
            const notes = await fetchNotesByTag(tag);
            preview.textContent = notes.length > 0 ? (notes[0].text || '').substring(0, 80) : '暂无内容';
        } catch { preview.textContent = ''; }
    }
}

function showTagContextMenu(e, tag, count, isPinned) {
    document.querySelector('.context-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = Math.min(e.clientX, window.innerWidth - 190) + 'px';
    menu.style.top = e.clientY + 'px';
    menu.innerHTML = `
        <button class="context-item" data-action="pin">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px;margin-right:4px;"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
            ${isPinned ? '取消置顶' : '置顶'}
        </button>
        <button class="context-item" data-action="color">
            <span style="display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:6px;background:linear-gradient(135deg,#667eea,#f093fb,#f5576c);"></span>
            更改颜色
        </button>
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
    menu.querySelector('[data-action="color"]').addEventListener('click', async () => {
        menu.remove();
        showColorPicker(tag);
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

async function showColorPicker(tag) {
    const palette = getPalette();
    const cfg = await readConfig().catch(() => ({}));
    const tagColors = JSON.parse(cfg.tag_colors || '{}');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:var(--surface);border-radius:16px;padding:20px;max-width:360px;width:90%;">
            <h3 style="margin-bottom:12px;">为 #${tag} 选择颜色</h3>
            <div id="palette-grid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:12px;"></div>
            <button id="palette-cancel" style="width:100%;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);cursor:pointer;font-size:14px;">关闭</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const grid = overlay.querySelector('#palette-grid');
    palette.forEach((color, idx) => {
        const swatch = document.createElement('div');
        swatch.style.cssText = `width:100%;aspect-ratio:1;border-radius:8px;cursor:pointer;background:${color};border:2px solid transparent;`;
        if (tagColors[tag] === idx) swatch.style.borderColor = 'var(--accent)';
        swatch.addEventListener('click', async () => {
            tagColors[tag] = idx;
            await writeConfig('tag_colors', JSON.stringify(tagColors));
            overlay.remove();
            showTagsView();
        });
        grid.appendChild(swatch);
    });

    overlay.querySelector('#palette-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
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
    // Inside a single tag, use theme accent color, not multi-color
    const savedMulti = document.documentElement.dataset.multi;
    document.documentElement.dataset.multi = '0';
    if (notes.length === 0) {
        const empty = document.createElement('p');
        empty.style.cssText = 'padding:24px;color:var(--text-secondary);text-align:center;';
        empty.textContent = '没有该标签的笔记';
        content.appendChild(empty);
    } else {
        notes.forEach(n => content.appendChild(renderNoteBubble(n)));
    }
    document.documentElement.dataset.multi = savedMulti;
    document.getElementById('tag-notes-back').addEventListener('click', showTagsView);
}
