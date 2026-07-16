import { showToolbar, hideToolbar, setToolbarTarget, renderTagBar, renderQuickPhraseBar } from './toolbar.js';
import { fetchTagSummary, readConfig } from './db.js';
import { renderMarkdown } from './notes.js';
import { getCurrentWorkspace } from './workspaces.js';

let _editingBubble = null;
let _editingNoteId = null;
let _originalText = '';
let _isSaving = false;

export function startEditing(bubble, noteId, text) {
    _editingBubble = bubble;
    _editingNoteId = noteId;
    _originalText = text;
    _isSaving = false;
    bubble.classList.add('is-editing');

    const originalHTML = bubble.innerHTML;
    bubble._originalHTML = originalHTML;

    // Save meta and audio HTML for reconstruction after save
    const metaEl = bubble.querySelector('.note-meta');
    bubble._savedMetaHTML = metaEl ? metaEl.outerHTML : '';
    const audioEl = bubble.querySelector('.audio-player');
    bubble._savedAudioHTML = audioEl ? audioEl.outerHTML : '';

    const viewWidth = bubble.offsetWidth;
    bubble.style.minWidth = viewWidth + 'px';
    bubble.innerHTML = `
        <textarea class="bubble-editor" id="bubble-editor" rows="6">${escapeHtml(text)}</textarea>
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

    fetchTagSummary(getCurrentWorkspace()).then(({ recentTags }) => {
        readConfig().then(cfg => {
            const pinned = JSON.parse(cfg.pinned_tags || '[]');
            renderTagBar(recentTags, pinned);
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
    if (_isSaving) return;
    const bubble = _editingBubble;
    const noteId = _editingNoteId;
    const textarea = bubble?.querySelector('#bubble-editor');
    if (!textarea) return;
    const newText = textarea.value;
    if (newText === _originalText) { cancelEditing(); return; }

    const saveButton = bubble.querySelector('.edit-btn--save');
    _isSaving = true;
    saveButton.disabled = true;

    try {
        const { getSupabase } = await import('./supabase.js');
        const { parseTags } = await import('./notes.js');
        const newTags = parseTags(newText);
        await getSupabase().from('smartstickynotes_items').update({
            text: newText,
            tags: newTags,
            updated_at: new Date().toISOString(),
        }).eq('id', noteId);

        bubble._originalHTML = null;
        const html = renderMarkdown(newText);
        // Rebuild proper bubble structure with .note-text wrapper
        let newHTML = `<div class="note-text">${html}</div>`;
        newHTML += bubble._savedAudioHTML || '';

        // Rebuild meta with updated tags, preserving original timestamp
        const savedMeta = bubble._savedMetaHTML || '';
        const timeMatch = savedMeta.match(/<span>([^<]+)<\/span>/);
        const timeStr = timeMatch ? timeMatch[1] : '';
        const tagsHTML = newTags.map(t =>
            `<span class="note-tag">#${t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`
        ).join('');
        newHTML += `<div class="note-meta"><span>${timeStr}</span>${tagsHTML}</div>`;

        bubble.innerHTML = newHTML;
        bubble._savedInnerHTML = newHTML;
        bubble.dataset.noteText = newText;
        bubble.dataset.noteTags = JSON.stringify(newTags);

        // Re-attach tag pill click handlers
        bubble.querySelectorAll('.note-tag').forEach(tagEl => {
            tagEl.addEventListener('click', (e) => {
                e.stopPropagation();
                import('./app.js').then(m => m.navigateToTags(tagEl.textContent.slice(1)));
            });
        });
    } catch (e) {
        _isSaving = false;
        saveButton.disabled = false;
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
    if (_editingBubble) {
        _editingBubble.style.minWidth = '';
        _editingBubble.classList.remove('is-editing');
    }
    hideToolbar();
    setToolbarTarget(null);
    _editingBubble = null;
    _editingNoteId = null;
    _originalText = '';
    _isSaving = false;
}
