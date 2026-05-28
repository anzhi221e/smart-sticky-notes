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
document.addEventListener('DOMContentLoaded', async () => {
    refreshTagColorCache();
    const conn = getConnection();
    if (!conn.url || !conn.anonKey) {
        document.getElementById('screen-connect').classList.add('active');
        document.getElementById('screen-connect').classList.remove('hidden');
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
        document.getElementById('screen-auth').classList.add('active');
        document.getElementById('screen-auth').classList.remove('hidden');
        setupAuthUI();
    }
});

function setupConnectionForm() {
    document.getElementById('connect-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveConnection(
            document.getElementById('connect-url').value.trim(),
            document.getElementById('connect-anon-key').value.trim()
        );
        window.location.reload();
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
            document.getElementById('screen-auth').classList.remove('active');
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
        if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); sendTextNote(); }
    }, { once: false });

    document.getElementById('send-btn').addEventListener('click', sendTextNote);

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
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => filterNotes(e.target.value), 300);
    });

    // Infinite scroll: load older notes when scrolling down
    document.getElementById('notes-list')?.addEventListener('scroll', () => {
        const list = document.getElementById('notes-list');
        if (!list || _loadingMore) return;
        // Near bottom → load older
        if (list.scrollHeight - list.scrollTop - list.clientHeight < 200) {
            _loadingMore = true;
            loadOlderNotes();
        }
    });

    setSyncStatus('已同步');
}

async function loadOlderNotes() {
    const sb = getSupabase();
    let query = sb.from('smartstickynotes_items').select('*').eq('status', 'active').order('created_at', { ascending: true }).limit(50);
    if (_oldestCursor) query = query.gt('created_at', _oldestCursor.created_at);
    try {
        const { data } = await query;
        if (data && data.length > 0) {
            const list = document.getElementById('notes-list');
            data.forEach(n => {
                const bubble = renderNoteBubble(n, null, (b, id, text, tags) => startEditing(b, id, text, () => loadNotes()));
                list.appendChild(bubble);
            });
            _oldestCursor = data[data.length - 1];
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
                textInput = document.getElementById('text-input');
                textInput.value = text;
                toggleSendButton(text.trim().length > 0);
                window._pendingVoiceBlob = result.blob;
                window._pendingVoiceDuration = result.duration;
                textInput.focus();
            }
        } catch (err) { showToast('录音保存失败'); }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
}

// --- Send ---
let _lastSend = 0;
let _sendCount = 0;

async function sendTextNote() {
    const now = Date.now();
    _sendCount++;
    console.log(`[SSN] sendTextNote called #${_sendCount} at +${now - _lastSend}ms since last`);
    if (now - _lastSend < 1000) { console.log('[SSN] BLOCKED — too soon'); return; }
    _lastSend = now;

    const textInput = document.getElementById('text-input');
    const sendBtn = document.getElementById('send-btn');
    const text = textInput.value.trim();
    sendBtn.disabled = true;

    if (!text && !window._pendingVoiceBlob) {
        _isSending = false; sendBtn.disabled = false; return;
    }

    const tags = parseTags(text || '');
    const type = window._pendingVoiceBlob ? 'voice' : 'text';

    const voiceBlob = window._pendingVoiceBlob;
    const voiceDur = window._pendingVoiceDuration;
    window._pendingVoiceBlob = null;
    window._pendingVoiceDuration = null;

    try {
        let note;
        if (voiceBlob) {
            note = await insertNote({ type: 'voice', text: text || '', tags, audio_path: '', audio_duration: voiceDur || 0 });
            try {
                const audioPath = await uploadAudio(note.id, voiceBlob);
                await getSupabase().from('smartstickynotes_items').update({ audio_path: audioPath }).eq('id', note.id);
                note.audio_path = audioPath;
            } catch (e) { /* audio upload failed */ }
        } else {
            note = await insertNote({ type: 'text', text, tags, audio_path: null, audio_duration: null });
        }

        textInput.value = '';
        toggleSendButton(false);

        const list = document.getElementById('notes-list');
        const bubble = renderNoteBubble(note, null, (bubble, noteId, noteText, noteTags) => {
            startEditing(bubble, noteId, noteText, () => loadNotes());
        });
        list.appendChild(bubble);  // append at bottom (oldest first)
        list.scrollTop = list.scrollHeight;

        const noteData = Array.from(list.querySelectorAll('.note-bubble')).map(b => ({
            id: b.dataset.noteId, type, text, tags, created_at: new Date().toISOString(),
        }));
        await cacheNotes(noteData);
        sendBtn.disabled = false;
    } catch (err) {
        sendBtn.disabled = false;
        if (!isOnline()) {
            await addToQueue({ type, text: text || '', tags, audio_path: null, audio_duration: null });
            showToast('已保存到本地，联网后自动发送');
            textInput.value = ''; toggleSendButton(false);
        } else {
            showToast('发送失败: ' + err.message);
        }
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
            const { data } = await sb.from('smartstickynotes_items').select('*').eq('status', 'active').order('created_at', { ascending: true }).limit(50);
            notes = data || [];
            await cacheNotes(notes);
        }
        notes.forEach(note => {
            const bubble = renderNoteBubble(note, null, (b, id, text, tags) => startEditing(b, id, text, () => loadNotes()));
            list.appendChild(bubble);
        });
        if (notes.length > 0) _oldestCursor = notes[notes.length - 1];
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
