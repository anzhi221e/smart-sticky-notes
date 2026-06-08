import { showToolbar, hideToolbar, setToolbarTarget, renderTagBar, renderQuickPhraseBar } from './toolbar.js';
import { fetchTags, readConfig } from './db.js';
import { renderMarkdown } from './notes.js';

let _editingBubble = null;
let _editingNoteId = null;
let _originalText = '';

export function startEditing(bubble, noteId, text) {
    _editingBubble = bubble;
    _editingNoteId = noteId;
    _originalText = text;

    const originalHTML = bubble.innerHTML;
    bubble._originalHTML = originalHTML;
    const viewWidth = bubble.offsetWidth;
    bubble.style.minWidth = viewWidth + 'px';
    bubble.innerHTML = `
        <textarea class="bubble-editor" id="bubble-editor">${escapeHtml(text)}</textarea>
        <div class="edit-actions">
            <button class="edit-btn edit-btn--cancel">取消</button>
            <button class="edit-btn edit-btn--save">保存</button>
        </div>
    `;
    document.querySelectorAll('.bubble-editor').forEach(el => {
        if (el.id !== 'bubble-editor') el.remove();
    });

    const textarea = bubble.querySelector('#bubble-editor');
    setToolbarTarget(textarea);
    showToolbar();

    fetchTags().then(tagCounts => {
        readConfig().then(cfg => {
            const pinned = JSON.parse(cfg.pinned_tags || '[]');
            renderTagBar(Object.keys(tagCounts), pinned);
        });
    });
    renderQuickPhraseBar();

    bubble.querySelector('.edit-btn--cancel').addEventListener('click', () => cancelEditing());
    bubble.querySelector('.edit-btn--save').addEventListener('click', () => saveEditing());
    textarea.focus();
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function saveEditing() {
    const textarea = _editingBubble?.querySelector('#bubble-editor');
    if (!textarea) return;
    const newText = textarea.value;
    if (newText === _originalText) { cancelEditing(); return; }

    try {
        const { getSupabase } = await import('./supabase.js');
        const { parseTags } = await import('./notes.js');
        const newTags = parseTags(newText);
        await getSupabase().from('smartstickynotes_items').update({
            text: newText,
            tags: newTags,
            updated_at: new Date().toISOString(),
        }).eq('id', _editingNoteId);

        _editingBubble._originalHTML = null;
        const html = renderMarkdown(newText);
        _editingBubble.innerHTML = _editingBubble._savedInnerHTML = html;
    } catch (e) {
        alert('保存失败: ' + e.message);
        return;
    }

    finishEditing();
}

function cancelEditing() {
    if (_editingBubble && _editingBubble._originalHTML) {
        _editingBubble.innerHTML = _editingBubble._originalHTML;
    }
    finishEditing();
}

function finishEditing() {
    if (_editingBubble) _editingBubble.style.minWidth = '';
    hideToolbar();
    setToolbarTarget(null);
    _editingBubble = null;
    _editingNoteId = null;
    _originalText = '';
}
