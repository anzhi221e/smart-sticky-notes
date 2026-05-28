import { showToolbar, hideToolbar, setToolbarTarget, renderTagBar } from './toolbar.js';
import { fetchTags, readConfig } from './db.js';
import { renderMarkdown } from './notes.js';

let _editingBubble = null;
let _editingNoteId = null;
let _originalText = '';

export function startEditing(bubble, noteId, text, onSaved) {
    _editingBubble = bubble;
    _editingNoteId = noteId;
    _originalText = text;

    const originalHTML = bubble.innerHTML;
    bubble._originalHTML = originalHTML;
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

    bubble.querySelector('.edit-btn--cancel').addEventListener('click', () => cancelEditing(onSaved));
    bubble.querySelector('.edit-btn--save').addEventListener('click', () => saveEditing(onSaved));
    textarea.focus();
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function saveEditing(onSaved) {
    const textarea = _editingBubble?.querySelector('#bubble-editor');
    if (!textarea) return;
    const newText = textarea.value;
    if (newText === _originalText) { cancelEditing(onSaved); return; }

    try {
        const { getSupabase } = await import('./supabase.js');
        await getSupabase().from('smartstickynotes_items').update({
            text: newText,
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
    if (onSaved) onSaved();
}

function cancelEditing(onSaved) {
    if (_editingBubble && _editingBubble._originalHTML) {
        _editingBubble.innerHTML = _editingBubble._originalHTML;
    }
    finishEditing();
}

function finishEditing() {
    hideToolbar();
    setToolbarTarget(null);
    _editingBubble = null;
    _editingNoteId = null;
    _originalText = '';
}
