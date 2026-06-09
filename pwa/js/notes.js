import { createAudioPlayer } from './audio-player.js';
import { showToast, getTagColor } from './ui.js';
import { softDeleteNote } from './db.js';

const TAG_REGEX = /#([一-鿿\w]+)/g;

export function parseTags(text) {
    const tags = [];
    const matches = text.matchAll(TAG_REGEX);
    for (const m of matches) {
        const tag = m[1].toLowerCase();
        if (!tags.includes(tag)) tags.push(tag);
        if (tags.length >= 20) break;
    }
    return tags;
}

export function renderMarkdown(text) {
    if (!text) return '';
    if (typeof marked !== 'undefined') {
        const renderer = new marked.Renderer();
        const origLink = renderer.link.bind(renderer);
        const origImage = renderer.image.bind(renderer);
        renderer.link = function({ href, title, text: linkText }) {
            if (!/^(https?|mailto|ftp):\/\//i.test(href)) return linkText;
            return origLink.apply(this, arguments);
        };
        renderer.image = function({ href, title, text: altText }) {
            if (!/^(https?):\/\//i.test(href)) return altText;
            return origImage.apply(this, arguments);
        };
        const html = marked.parse(text, { renderer });
        return html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
            .replace(/>\s+</g, '><')
            .trim();
    }
    // Fallback: basic inline formatting only
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    return html;
}

export function renderNoteBubble(note, onDelete, onEdit) {
    const bubble = document.createElement('div');
    bubble.className = 'note-bubble';
    bubble.dataset.noteId = note.id;
    bubble.dataset.noteText = note.text;
    bubble.dataset.noteTags = JSON.stringify(note.tags || []);

    // Multi-color: apply tag's palette color, always white text for readability
    const isMulti = document.documentElement.dataset.multi === '1';
    if (isMulti && note.tags && note.tags.length > 0) {
        const tagColors = window._tagColorCache || {};
        const color = getTagColor(note.tags[0], tagColors);
        bubble.style.background = color;
        bubble.style.border = 'none';
        bubble.style.color = '#fff';
        bubble.classList.add('multi-color-bubble');
    }

    const textEl = document.createElement('div');
    textEl.className = 'note-text';
    textEl.innerHTML = renderMarkdown(note.text);
    bubble.appendChild(textEl);

    if (note.type === 'voice' && note.audio_path) {
        const player = createAudioPlayer(note.audio_path, note.audio_duration);
        bubble.appendChild(player);
    }

    const meta = document.createElement('div');
    meta.className = 'note-meta';
    const time = new Date(note.created_at);
    const timeStr = time.toLocaleString('zh-CN', {
        month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
    const timeSpan = document.createElement('span');
    timeSpan.textContent = timeStr;
    meta.appendChild(timeSpan);

    (note.tags || []).forEach(tag => {
        const tagEl = document.createElement('span');
        tagEl.className = 'note-tag';
        tagEl.textContent = '#' + tag;
        tagEl.addEventListener('click', (e) => {
            e.stopPropagation();
            import('./app.js').then(m => m.navigateToTags(tag));
        });
        meta.appendChild(tagEl);
    });
    bubble.appendChild(meta);

    // Swipe left to delete
    let startX = 0;
    bubble.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
    }, { passive: true });
    bubble.addEventListener('touchend', (e) => {
        const diff = startX - e.changedTouches[0].clientX;
        if (diff > 80) {
            if (_deletingBubble) return;
            _deletingBubble = true;
            softDeleteNote(note.id).then(() => {
                showToast('已移至回收站', {
                    undoLabel: '撤销',
                    onUndo: () => {
                        import('./db.js').then(m => m.restoreNote(note.id)).then(() => {
                            bubble.remove();
                            import('./app.js').then(m => m.loadNotes());
                            _deletingBubble = false;
                        });
                    },
                });
                bubble.remove();
                if (onDelete) onDelete(note.id);
                _deletingBubble = false;
            });
        }
    });

    // Long press → edit menu
    let longPressTimer;
    bubble.addEventListener('touchstart', () => {
        longPressTimer = setTimeout(() => {
            showBubbleMenu(bubble, note, onDelete, onEdit);
        }, 500);
    }, { passive: true });
    bubble.addEventListener('touchend', () => clearTimeout(longPressTimer));
    bubble.addEventListener('touchmove', () => clearTimeout(longPressTimer));
    bubble.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showBubbleMenu(bubble, note, onDelete, onEdit);
    });

    return bubble;
}

let _bubbleMenuOpen = false;

function showBubbleMenu(bubble, note, onDelete, onEdit) {
    if (_bubbleMenuOpen) return;
    _bubbleMenuOpen = true;
    document.querySelectorAll('.bubble-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'bubble-menu bubble-menu-sheet';
    menu.innerHTML = `
        <div class="bubble-menu-sheet-inner">
            <button class="bubble-menu-item" data-action="edit">编辑</button>
            <button class="bubble-menu-item" data-action="move">移动</button>
            <button class="bubble-menu-item" data-action="copy">复制</button>
            <button class="bubble-menu-item bubble-menu-item--danger" data-action="delete">删除</button>
            <button class="bubble-menu-item" data-action="cancel">取消</button>
        </div>
    `;

    const currentText = bubble.dataset.noteText || note.text;
    const currentTags = (() => { try { return JSON.parse(bubble.dataset.noteTags || '[]'); } catch { return note.tags || []; } })();

    menu.querySelector('[data-action="edit"]').addEventListener('click', () => { cleanup(); if (onEdit) onEdit(bubble, note.id, currentText, currentTags); });
    menu.querySelector('[data-action="move"]').addEventListener('click', () => { cleanup(); showMoveDialog(note, bubble, onDelete); });
    menu.querySelector('[data-action="delete"]').addEventListener('click', () => { cleanup(); deleteBubble(bubble, note, onDelete); });
    menu.querySelector('[data-action="copy"]').addEventListener('click', () => { cleanup(); navigator.clipboard.writeText(currentText); showToast('已复制'); });
    menu.querySelector('[data-action="cancel"]').addEventListener('click', cleanup);

    function cleanup() { menu.remove(); _bubbleMenuOpen = false; }
    menu.addEventListener('click', (e) => { if (e.target === menu) cleanup(); });

    document.body.appendChild(menu);
}

async function showMoveDialog(note, bubble, onDelete) {
    const workspaces = (await import('./workspaces.js')).getWorkspaces ? await (await import('./workspaces.js')).getWorkspaces() : ['Main'];
    const currentWs = (await import('./workspaces.js')).getCurrentWorkspace ? (await import('./workspaces.js')).getCurrentWorkspace() : 'Main';

    const sheet = document.createElement('div');
    sheet.className = 'bubble-menu bubble-menu-sheet';
    sheet.innerHTML = `
        <div class="bubble-menu-sheet-inner">
            <div style="padding:12px 16px;font-size:15px;font-weight:600;text-align:center;color:var(--text);">移动到</div>
            ${workspaces.filter(w => w !== currentWs).map(w => `
                <button class="bubble-menu-item" data-workspace="${w.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}">${w.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</button>
            `).join('')}
            ${workspaces.filter(w => w !== currentWs).length === 0 ? '<div style="padding:16px;text-align:center;color:var(--text-secondary);font-size:13px;">没有其他对话</div>' : ''}
            <button class="bubble-menu-item" data-action="cancel" style="margin-top:4px;">取消</button>
        </div>
    `;

    function cleanup() { sheet.remove(); }
    sheet.addEventListener('click', (e) => { if (e.target === sheet) cleanup(); });
    sheet.querySelector('[data-action="cancel"]')?.addEventListener('click', cleanup);

    sheet.querySelectorAll('[data-workspace]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const targetWs = btn.dataset.workspace;
            cleanup();
            try {
                const { moveNoteToWorkspace } = await import('./db.js');
                await moveNoteToWorkspace(note.id, targetWs);
                showToast('已移动到 ' + targetWs);
                bubble.remove();
                if (onDelete) onDelete(note.id);
            } catch (e) { showToast('移动失败: ' + e.message); }
        });
    });

    document.body.appendChild(sheet);
}

let _deletingBubble = false;
function deleteBubble(bubble, note, onDelete) {
    if (_deletingBubble) return;
    _deletingBubble = true;
    softDeleteNote(note.id).then(() => {
        showToast('已移至回收站', {
            undoLabel: '撤销',
            onUndo: () => {
                import('./db.js').then(m => m.restoreNote(note.id)).then(() => {
                    bubble.remove();
                    import('./app.js').then(m => m.loadNotes());
                    _deletingBubble = false;
                });
            },
        });
        bubble.remove();
        if (onDelete) onDelete(note.id);
        _deletingBubble = false;
    });
}
