import { initSupabase, getSupabase, getConnection, saveConnection } from './supabase.js';
import { sendMagicLink, getSession, signOut, onAuthStateChange } from './auth.js';
import { fetchNotes, insertNote, uploadAudio, readConfig, fetchTags } from './db.js';
import { renderNoteBubble, parseTags } from './notes.js';
import { startRecording, stopRecording, cancelRecording, getIsRecording } from './voice.js';
import { navigateTo, toggleSidebar, setSyncStatus, setMicEnabled, toggleSendButton, showRecordingOverlay, hideRecordingOverlay, updateRecordingText, showToast, applyTheme } from './ui.js';
import { isOnline, onNetworkChange, cacheNotes, getCachedNotes, addToQueue, getQueueCount, flushQueue } from './offline.js';
import { renderCalendarDay, renderCalendarWeek, renderCalendarMonth, renderCalendarYear } from './calendar.js';
import { initToolbar, showToolbar, hideToolbar, setToolbarTarget, renderTagBar } from './toolbar.js';
import { startEditing } from './editor.js';
import { showTagsView } from './tags.js';
import { showRecycleBin } from './recycle-bin.js';
import { showSettings } from './settings.js';

// --- Module-level state ---
console.log('[SSN] v2.3 loaded — ' + new Date().toISOString());
let _loadingMore = false;
let _oldestCursor = null;

async function refreshTagColorCache() {
    try {
        const { readConfig } = await import('./db.js');
        const cfg = await readConfig().catch(() => ({}));
        window._tagColorCache = JSON.parse(cfg.tag_colors || '{}');
    } catch { window._tagColorCache = {}; }
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => doInit().catch(e => {
    document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px;font-family:sans-serif;"><p style="font-size:16px;color:#e05555;">加载失败</p><pre style="font-size:12px;color:#888;max-width:90%;overflow:auto;">${e.message}\n\n${e.stack}</pre></div>`;
    console.error(e);
}));

async function doInit() {
    refreshTagColorCache();
    const conn = getConnection();
    if (!conn.url || !conn.anonKey) {
        navigateTo('connect');
        setupConnectionForm();
        return;
    }
    initSupabase(conn.url, conn.anonKey);
    const session = await getSession();
    if (session) {
        applyTheme(localStorage.getItem('ssn-theme') || 'blue-light');
        navigateTo('main');
        await loadNotes();
        setupMainUI();
        const cfg = await readConfig().catch(() => ({}));
        if (!cfg.local_folder_path) {
            navigateTo('wizard');
            import('./wizard.js').then(m => m.renderWizard(1));
        }
    } else {
        navigateTo('auth');
        setupAuthUI();
    }
}

function setupConnectionForm() {
    document.getElementById('connect-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('connect-url').value.trim();
        const key = document.getElementById('connect-anon-key').value.trim();
        if (!url || !key) return;
        saveConnection(url, key);
        try {
            await doInit();
        } catch (err) {
            document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px;font-family:sans-serif;"><p style="font-size:16px;color:#e05555;">加载失败</p><pre style="font-size:12px;color:#888;max-width:90%;overflow:auto;">${err.message}\n\n${err.stack}</pre></div>`;
        }
    });
}

function setupAuthUI() {
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email-input').value.trim();
        if (!email) return;
        const msg = document.getElementById('login-msg');
        msg.classList.remove('hidden'); msg.textContent = '正在发送登录链接...'; msg.classList.remove('error');
        const { error } = await sendMagicLink(email);
        msg.textContent = error ? '发送失败: ' + error.message : '登录链接已发送，请检查邮箱并点击链接';
        if (error) msg.classList.add('error');
    });
    onAuthStateChange((event, session) => {
        if (session) {
            navigateTo('main'); loadNotes(); setupMainUI();
        }
    });
}

// --- Main UI ---
let _mainUISetup = false;
function setupMainUI() {
    if (_mainUISetup) return;
    _mainUISetup = true;
    document.getElementById('menu-toggle').addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-close').addEventListener('click', toggleSidebar);

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const screen = item.dataset.screen;
            if (screen === 'recycle-bin') showRecycleBin();
            else if (screen === 'tags') showTagsView();
            else if (screen === 'calendar-view') { navigateTo('calendar'); renderCalendarMonth(new Date()); }
            else if (screen === 'settings') showSettings();
            else navigateTo('main');
        });
    });

    document.getElementById('calendar-toggle').addEventListener('click', () => {
        navigateTo('calendar');
        renderCalendarMonth(new Date());
    });

    // Text input
    const textInput = document.getElementById('text-input');
    let toolbarBlurTimeout;

    textInput.addEventListener('focus', () => {
        clearTimeout(toolbarBlurTimeout);
        setToolbarTarget(textInput);
        showToolbar();
        loadTagBar();
        toggleSendButton(textInput.value.trim().length > 0);
    });
    textInput.addEventListener('blur', () => {
        toolbarBlurTimeout = setTimeout(() => hideToolbar(), 300);
    });
    textInput.addEventListener('input', () => {
        toggleSendButton(textInput.value.trim().length > 0);
    });
    textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); sendTextNote('keydown-Enter'); }
    });

    document.getElementById('send-btn').addEventListener('click', () => sendTextNote('send-btn-click'));

    // Mic
    const micBtn = document.getElementById('mic-btn');
    micBtn.addEventListener('pointerdown', onMicPress);

    // Toolbar buttons keep toolbar visible
    document.getElementById('toolbar')?.addEventListener('pointerdown', (e) => {
        clearTimeout(toolbarBlurTimeout);
        e.preventDefault();
    });

    initToolbar();

    updateMicState();
    onNetworkChange((online) => {
        updateMicState();
        if (online) flushAndReload();
    });

    setupPullToRefresh();

    document.getElementById('calendar-back').addEventListener('click', () => navigateTo('main'));
    document.getElementById('cal-today').addEventListener('click', () => renderCalendarMonth(new Date()));
    document.querySelectorAll('.cal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.cal-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const fn = { day: renderCalendarDay, week: renderCalendarWeek, month: renderCalendarMonth, year: renderCalendarYear };
            (fn[tab.dataset.view] || renderCalendarMonth)(new Date());
        });
    });

    document.getElementById('trash-back')?.addEventListener('click', () => { navigateTo('main'); loadNotes(); });
    document.getElementById('tags-back')?.addEventListener('click', () => navigateTo('main'));
    document.getElementById('settings-back')?.addEventListener('click', () => navigateTo('main'));

    // Search
    let searchTimeout;
    // Select mode
    let _selectMode = false;
    const _selectedIds = new Set();
    const selectToggle = document.getElementById('select-mode-toggle');
    selectToggle.style.display = '';

    selectToggle.addEventListener('click', () => {
        _selectMode = !_selectMode;
        _selectedIds.clear();
        document.querySelectorAll('.note-bubble').forEach(b => {
            const cb = b.querySelector('.select-checkbox');
            if (cb) cb.checked = false;
        });
        updateSelectModeUI();
    });

    function updateSelectModeUI() {
        const selectBar = document.getElementById('select-action-bar');
        if (_selectMode) {
            if (!selectBar) {
                const bar = document.createElement('div');
                bar.id = 'select-action-bar';
                bar.style.cssText = 'display:flex;gap:8px;padding:10px 16px;background:var(--surface);border-top:1px solid var(--border);align-items:center;';
                bar.innerHTML = `
                    <span id="select-count" style="font-size:13px;color:var(--text-secondary);flex:1;">已选 0 项</span>
                    <button id="select-delete-btn" style="padding:8px 16px;background:var(--danger);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;">删除所选</button>
                    <button id="select-cancel-btn" style="padding:8px 16px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:16px;cursor:pointer;font-size:13px;">取消</button>
                `;
                document.getElementById('screen-main').appendChild(bar);
                bar.querySelector('#select-delete-btn').addEventListener('click', async () => {
                    if (_selectedIds.size === 0) return;
                    if (!confirm(`确定删除 ${_selectedIds.size} 条笔记？`)) return;
                    const { softDeleteNote } = await import('./db.js');
                    for (const id of _selectedIds) await softDeleteNote(id);
                    showToast(`已删除 ${_selectedIds.size} 条`);
                    _selectMode = false; _selectedIds.clear();
                    document.getElementById('select-action-bar')?.remove();
                    updateSelectModeUI();
                    loadNotes();
                });
                bar.querySelector('#select-cancel-btn').addEventListener('click', () => {
                    _selectMode = false; _selectedIds.clear();
                    document.getElementById('select-action-bar')?.remove();
                    updateSelectModeUI();
                });
            }
        } else {
            if (selectBar) selectBar.remove();
        }
        // Show/hide checkboxes
        document.querySelectorAll('.note-bubble').forEach(b => {
            let cb = b.querySelector('.select-checkbox');
            if (_selectMode) {
                if (!cb) {
                    cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.className = 'select-checkbox';
                    cb.addEventListener('change', () => {
                        if (cb.checked) _selectedIds.add(b.dataset.noteId);
                        else _selectedIds.delete(b.dataset.noteId);
                        const count = document.getElementById('select-count');
                        if (count) count.textContent = `已选 ${_selectedIds.size} 项`;
                    });
                }
                cb.style.display = '';
                // Position at left edge of notes-list, aligned with bubble top
                const list = document.getElementById('notes-list');
                list.style.position = 'relative';
                list.appendChild(cb);
                cb.style.cssText = 'position:absolute;left:4px;width:20px;height:20px;accent-color:var(--accent);cursor:pointer;z-index:5;';
                cb.style.top = (b.offsetTop + 14) + 'px';
            } else {
                if (cb) cb.remove();
            }
        });
        updateSelectCount();
    }

    function updateSelectCount() {
        const count = document.getElementById('select-count');
        if (count) count.textContent = `已选 ${_selectedIds.size} 项`;
    }

    document.getElementById('search-input')?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => filterNotes(e.target.value), 300);
    });

    // Infinite scroll: load older notes when scrolling to the top.
    document.getElementById('notes-list')?.addEventListener('scroll', () => {
        const list = document.getElementById('notes-list');
        if (!list || _loadingMore) return;
        // Near bottom → load older
        if (list.scrollTop < 200) {
            _loadingMore = true;
            loadOlderNotes();
        }
    });

    setSyncStatus('已同步');
}

async function loadOlderNotes() {
    const sb = getSupabase();
    if (!_oldestCursor) { _loadingMore = false; return; }
    const query = sb
        .from('smartstickynotes_items')
        .select('*')
        .eq('status', 'active')
        .lt('created_at', _oldestCursor.created_at)
        .order('created_at', { ascending: false })
        .limit(50);
    try {
        const { data } = await query;
        if (data && data.length > 0) {
            const list = document.getElementById('notes-list');
            const previousScrollHeight = list.scrollHeight;
            data.forEach(n => {
                if (list.querySelector(`[data-note-id="${CSS.escape(n.id)}"]`)) return;
                const bubble = renderNoteBubble(n, null, (b, id, text, tags) => startEditing(b, id, text, () => loadNotes()));
                list.insertBefore(bubble, list.firstChild);
            });
            _oldestCursor = data[data.length - 1];
            list.scrollTop += list.scrollHeight - previousScrollHeight;
        }
    } catch (e) { /* ignore */ }
    _loadingMore = false;
}

async function loadTagBar() {
    try {
        const tags = await fetchTags();
        const cfg = await readConfig().catch(() => ({}));
        const pinned = JSON.parse(cfg.pinned_tags || '[]');
        renderTagBar(Object.keys(tags), pinned);
    } catch (e) { /* ignore */ }
}

// --- Mic ---
function updateMicState() { setMicEnabled(isOnline()); }

async function onMicPress(e) {
    if (!isOnline()) { showToast('当前离线，请使用文字输入'); return; }
    if (getIsRecording()) return;

    const startY = e.clientY;
    let cancelled = false;

    showRecordingOverlay('准备录音...');
    try {
        await startRecording({
            onText: (text, isFinal) => updateRecordingText(text),
            onState: (state) => { if (state === 'recording') updateRecordingText('说话中...'); },
        });
    } catch (err) {
        hideRecordingOverlay();
        showToast(err.message === 'offline' ? '当前离线，请使用文字输入' : '无法访问麦克风');
        return;
    }

    const onMove = (ev) => {
        const dy = startY - ev.clientY;
        if (dy > 60) { cancelled = true; updateRecordingText('松开取消'); }
    };
    const onUp = async () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        hideRecordingOverlay();
        if (cancelled) { cancelRecording(); return; }

        try {
            const result = await stopRecording();
            if (result && result.blob) {
                const recognitionText = document.getElementById('recording-text')?.textContent;
                const text = (recognitionText && recognitionText !== '说话中...' && recognitionText !== '松开取消') ? recognitionText : '';
                const textInputEl = document.getElementById('text-input');
                textInputEl.value = text;
                toggleSendButton(text.trim().length > 0);
                window._pendingVoiceBlob = result.blob;
                window._pendingVoiceDuration = result.duration;
                textInputEl.focus();
            }
        } catch (err) { showToast('录音失败: ' + err.message); }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
}

// --- Send ---
let _isSending = false;

async function sendTextNote(caller = 'unknown') {
    console.trace(`[SSN] sendTextNote called by: ${caller}`);
    if (_isSending) { console.log('[SSN] BLOCKED by _isSending'); return; }
    _isSending = true;

    const textInput = document.getElementById('text-input');
    const sendBtn = document.getElementById('send-btn');
    const text = textInput.value.trim();
    sendBtn.disabled = true;

    if (!text && !window._pendingVoiceBlob) {
        _isSending = false; sendBtn.disabled = false; return;
    }

    const tags = parseTags(text || '');
    const clientId = crypto.randomUUID();

    const voiceBlob = window._pendingVoiceBlob;
    const voiceDur = window._pendingVoiceDuration;
    window._pendingVoiceBlob = null;
    window._pendingVoiceDuration = null;

    // Phase 1: Database insert (only this can trigger offline queue)
    let note;
    try {
        if (voiceBlob) {
            note = await insertNote({ id: clientId, type: 'voice', text: text || '', tags, audio_path: '', audio_duration: voiceDur || 0 });
            try {
                const audioPath = await uploadAudio(note.id, voiceBlob);
                await getSupabase().from('smartstickynotes_items').update({ audio_path: audioPath }).eq('id', note.id);
                note.audio_path = audioPath;
            } catch (e) { /* audio upload failed, note still saved */ }
        } else {
            note = await insertNote({ id: clientId, type: 'text', text, tags, audio_path: null, audio_duration: null });
        }
    } catch (err) {
        _isSending = false; sendBtn.disabled = false;
        if (!isOnline()) {
            await addToQueue({ id: clientId, type: voiceBlob ? 'voice' : 'text', text: text || '', tags, audio_path: null, audio_duration: null });
            showToast('已保存到本地，联网后自动发送');
            textInput.value = ''; toggleSendButton(false);
        } else {
            showToast('发送失败: ' + err.message);
        }
        return;
    }

    // Phase 2: UI update (from here on, note is in DB — never addToQueue)
    try {
        textInput.value = '';
        toggleSendButton(false);

        const list = document.getElementById('notes-list');
        if (!list.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`)) {
            const bubble = renderNoteBubble(note, null, (bubble, noteId, noteText, noteTags) => {
                startEditing(bubble, noteId, noteText, () => loadNotes());
            });
            list.appendChild(bubble);
        }
        list.scrollTop = list.scrollHeight;

        const noteData = Array.from(list.querySelectorAll('.note-bubble')).map(b => ({
            id: b.dataset.noteId, type: note.type, text: note.text, tags: note.tags, created_at: note.created_at || new Date().toISOString(),
        }));
        await cacheNotes(noteData);
    } catch (err) {
        // Note is already saved in DB. UI render/cache failed — just reload.
        console.warn('Note saved but UI update failed:', err);
        await loadNotes();
    } finally {
        _isSending = false; sendBtn.disabled = false;
    }
}

// --- Notes list ---
export async function loadNotes() {
    const list = document.getElementById('notes-list');
    if (!list) return;
    list.innerHTML = '';

    try {
        let notes;
        if (!isOnline()) notes = await getCachedNotes();
        else {
            const sb = getSupabase();
            const { data } = await sb.from('smartstickynotes_items').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(50);
            notes = (data || []).reverse();
            await cacheNotes(notes);
        }
        notes.forEach(note => {
            if (list.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`)) return;
            const bubble = renderNoteBubble(note, null, (b, id, text, tags) => startEditing(b, id, text, () => loadNotes()));
            list.appendChild(bubble);
        });
        _oldestCursor = notes.length > 0 ? notes[0] : null;
        list.scrollTop = list.scrollHeight;
    } catch (err) {
        const cached = await getCachedNotes();
        cached.forEach(note => list.appendChild(renderNoteBubble(note)));
    }
    const queueCount = await getQueueCount();
    if (queueCount > 0) setSyncStatus(`${queueCount} 条待发送`);
}

async function flushAndReload() {
    const sent = await flushQueue(async (item) => { await insertNote(item); });
    if (sent > 0) { setSyncStatus('已同步'); await loadNotes(); }
}

async function filterNotes(query) {
    const list = document.getElementById('notes-list');
    if (!list) return;
    if (!query.trim()) { loadNotes(); return; }
    try {
        const sb = getSupabase();
        const { data } = await sb.from('smartstickynotes_items').select('*').eq('status', 'active').ilike('text', `%${query}%`).order('created_at', { ascending: false }).limit(50);
        list.innerHTML = '';
        (data || []).forEach(n => list.appendChild(renderNoteBubble(n)));
    } catch (e) { /* offline, ignore */ }
}

function setupPullToRefresh() {
    const list = document.getElementById('notes-list');
    let startY = 0;
    list.addEventListener('touchstart', (e) => { if (list.scrollTop === 0) startY = e.touches[0].clientY; }, { passive: true });
    list.addEventListener('touchend', async (e) => {
        if (list.scrollTop <= 0 && e.changedTouches[0].clientY - startY > 60) {
            setSyncStatus('同步中...');
            // Reload from newest
            _oldestCursor = null;
            await loadNotes();
            setSyncStatus('已同步');
        }
    });
}

// Tag navigation (called from notes.js tag pill clicks)
export async function navigateToTags(tag) {
    const { showTagNotes } = await import('./tags.js');
    navigateTo('tags');
    const content = document.getElementById('tags-content');
    const { fetchNotesByTag } = await import('./db.js');
    const notes = await fetchNotesByTag(tag);
    content.innerHTML = `
        <div style="padding:8px 16px;display:flex;align-items:center;gap:8px;">
            <button id="tag-filter-back" class="icon-btn">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <h2>#${tag}</h2>
        </div>
    `;
    const savedMulti = document.documentElement.dataset.multi;
    document.documentElement.dataset.multi = '0';
    notes.forEach(n => content.appendChild(renderNoteBubble(n)));
    document.documentElement.dataset.multi = savedMulti;
    document.getElementById('tag-filter-back').addEventListener('click', showTagsView);
}
