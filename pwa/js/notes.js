import { createAudioPlayer } from './audio-player.js';
import { showToast } from './ui.js';
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
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Order matters: headers before bold, etc.
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Line breaks
    html = html.replace(/\n\n/g, '<br><br>');
    return html;
}

export function renderNoteBubble(note, onDelete, onEdit) {
    const bubble = document.createElement('div');
    bubble.className = 'note-bubble';
    bubble.dataset.noteId = note.id;

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
            softDeleteNote(note.id).then(() => {
                showToast('已移至回收站', {
                    undoLabel: '撤销',
                    onUndo: () => {
                        import('./db.js').then(m => m.restoreNote(note.id)).then(() => {
                            bubble.remove();
                            import('./app.js').then(m => m.loadNotes());
                        });
                    },
                });
                bubble.remove();
                if (onDelete) onDelete(note.id);
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

function showBubbleMenu(bubble, note, onDelete, onEdit) {
    // Clean up all existing menus and context menus
    document.querySelectorAll('.bubble-menu, .context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'bubble-menu';
    menu.innerHTML = `
        <button class="bubble-menu-item" data-action="edit">编辑</button>
        <button class="bubble-menu-item" data-action="delete">删除</button>
        <button class="bubble-menu-item" data-action="copy">复制</button>
    `;
    const rect = bubble.getBoundingClientRect();
    menu.style.cssText = `
        position:fixed;top:${rect.bottom + 4}px;right:${window.innerWidth - rect.right}px;
        background:var(--surface);border:1px solid var(--border);border-radius:12px;
        padding:4px;z-index:200;min-width:120px;
    `;

    menu.querySelector('[data-action="edit"]').addEventListener('click', () => {
        menu.remove();
        if (onEdit) onEdit(bubble, note.id, note.text, note.tags);
    });
    menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
        menu.remove();
        softDeleteNote(note.id).then(() => {
            showToast('已移至回收站', {
                undoLabel: '撤销',
                onUndo: () => {
                    import('./db.js').then(m => m.restoreNote(note.id)).then(() => {
                        bubble.remove();
                        import('./app.js').then(m => m.loadNotes());
                    });
                },
            });
            bubble.remove();
            if (onDelete) onDelete(note.id);
        });
    });
    menu.querySelector('[data-action="copy"]').addEventListener('click', () => {
        navigator.clipboard.writeText(note.text);
        showToast('已复制');
        menu.remove();
    });

    document.body.appendChild(menu);
    // Close menu on next click anywhere
    const closeHandler = () => { menu.remove(); document.removeEventListener('click', closeHandler); };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}
