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

export function renderNoteBubble(note, onDelete) {
    const bubble = document.createElement('div');
    bubble.className = 'note-bubble';
    bubble.dataset.noteId = note.id;

    const textEl = document.createElement('div');
    textEl.className = 'note-text';
    textEl.textContent = note.text || '';
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

    // Long press context menu
    bubble.addEventListener('contextmenu', (e) => {
        e.preventDefault();
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
        });
    });

    return bubble;
}
