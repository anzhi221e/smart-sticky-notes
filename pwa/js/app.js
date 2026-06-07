import { initSupabase, getSupabase, getConnection, saveConnection } from './supabase.js';
import { sendOtp, verifyOtp, getSession, signOut, onAuthStateChange } from './auth.js';
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
console.log('[SSN] v2.4 loaded — ' + new Date().toISOString());
let _loadingMore = false;
let _oldestCursor = null;
let _currentWorkspace = 'Main';

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
        const cfg = await readConfig().catch(() => ({}));
        const { getDefaultWorkspace, getCurrentWorkspace, setCurrentWorkspace } = await import('./workspaces.js');
        const defaultWs = await getDefaultWorkspace();
        const savedWs = getCurrentWorkspace();
        _currentWorkspace = savedWs !== 'Main' ? savedWs : defaultWs;
        setCurrentWorkspace(_currentWorkspace);
        navigateTo('main');
        await loadNotes();
        setupMainUI();
        // Auto-hide mic if speech recognition not supported
        if (cfg.show_mic_button === undefined) {
            const speechOk = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
            if (!speechOk) {
                document.getElementById('mic-btn') && (document.getElementById('mic-btn').style.display = 'none');
            }
        }
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
    const form = document.getElementById('login-form');
    const emailInput = document.getElementById('email-input');
    const codeInput = document.getElementById('code-input');
    const sendBtn = document.getElementById('send-code-btn');
    const verifyBtn = document.getElementById('verify-code-btn');
    const resendBtn = document.getElementById('resend-code-btn');
    const stepEmail = document.getElementById('login-step-email');
    const stepCode = document.getElementById('login-step-code');
    const emailDisplay = document.getElementById('otp-email-display');
    const msg = document.getElementById('login-msg');

    function showMsg(text, isError) {
        msg.classList.remove('hidden');
        msg.textContent = text;
        msg.classList.toggle('error', !!isError);
    }

    // Step 1: send OTP
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = emailInput.value.trim();
        if (!email) return;

        sendBtn.disabled = true;
        sendBtn.textContent = '正在发送...';
        showMsg('正在发送验证码...', false);

        const { error } = await sendOtp(email);

        if (error) {
            showMsg('发送失败: ' + error.message, true);
            sendBtn.disabled = false;
            sendBtn.textContent = '发送验证码';
            return;
        }

        showMsg('验证码已发送，请查收邮件', false);
        stepEmail.classList.add('hidden');
        stepCode.classList.remove('hidden');
        emailDisplay.textContent = email;
        codeInput.value = '';
        codeInput.focus();
    });

    // Step 2: verify OTP
    verifyBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        const token = codeInput.value.trim();
        if (!token || token.length !== 8) {
            showMsg('请输入 8 位验证码', true);
            return;
        }

        verifyBtn.disabled = true;
        verifyBtn.textContent = '正在验证...';
        showMsg('正在验证...', false);

        const { data, error } = await verifyOtp(email, token);

        if (error) {
            showMsg('验证失败: ' + error.message, true);
            verifyBtn.disabled = false;
            verifyBtn.textContent = '验证';
            return;
        }

        // Session is set — onAuthStateChange will fire and navigate to main
        showMsg('登录成功！', false);
    });

    // Step 3: resend OTP
    resendBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        resendBtn.disabled = true;
        resendBtn.textContent = '正在重新发送...';
        showMsg('正在重新发送...', false);

        const { error } = await sendOtp(email);

        resendBtn.disabled = false;
        resendBtn.textContent = '重新发送验证码';
        if (error) {
            showMsg('重新发送失败: ' + error.message, true);
        } else {
            showMsg('验证码已重新发送', false);
        }
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
        item.addEventListener('click', async () => {
            const screen = item.dataset.screen;
            if (screen === 'recycle-bin') showRecycleBin();
            else if (screen === 'tags') showTagsView();
            else if (screen === 'calendar-view') { navigateTo('calendar'); renderCalendarMonth(new Date()); }
            else if (screen === 'settings') showSettings();
            else if (screen === 'workspace-manager') {
                const { showWorkspaceManager } = await import('./workspaces.js');
                showWorkspaceManager();
            }
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

    // Apply mic visibility setting
    readConfig().then(cfg => {
        if (cfg.show_mic_button === 'false') document.getElementById('mic-btn').style.display = 'none';
    });
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
                    <button id="select-move-btn" style="padding:8px 16px;background:var(--accent);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;">移动</button>
                    <button id="select-delete-btn" style="padding:8px 16px;background:var(--danger);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;">删除所选</button>
                    <button id="select-cancel-btn" style="padding:8px 16px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:16px;cursor:pointer;font-size:13px;">取消</button>
                `;
                document.getElementById('screen-main').appendChild(bar);
                bar.querySelector('#select-move-btn').addEventListener('click', async () => {
                    if (_selectedIds.size === 0) return;
                    const { getWorkspaces, getCurrentWorkspace } = await import('./workspaces.js');
                    const workspaces = await getWorkspaces();
                    const currentWs = getCurrentWorkspace();
                    const targets = workspaces.filter(w => w !== currentWs);
                    if (targets.length === 0) { showToast('没有其他对话'); return; }
                    // Show a simple picker
                    const picker = document.createElement('div');
                    picker.className = 'bubble-menu bubble-menu-sheet';
                    picker.innerHTML = `
                        <div class="bubble-menu-sheet-inner">
                            <div style="padding:12px 16px;font-size:15px;font-weight:600;text-align:center;color:var(--text);">移动 ${_selectedIds.size} 条到</div>
                            ${targets.map(w => `<button class="bubble-menu-item" data-workspace="${w.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}">${w.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</button>`).join('')}
                            <button class="bubble-menu-item" data-action="cancel" style="margin-top:4px;">取消</button>
                        </div>
                    `;
                    function closePicker() { picker.remove(); }
                    picker.addEventListener('click', (e) => { if (e.target === picker) closePicker(); });
                    picker.querySelector('[data-action="cancel"]')?.addEventListener('click', closePicker);
                    picker.querySelectorAll('[data-workspace]').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            const targetWs = btn.dataset.workspace;
                            closePicker();
                            const { moveNoteToWorkspace } = await import('./db.js');
                            let moved = 0;
                            for (const id of _selectedIds) {
                                try { await moveNoteToWorkspace(id, targetWs); moved++; } catch (e) { /* skip */ }
                            }
                            showToast(`已移动 ${moved} 条到 ${targetWs}`);
                            _selectMode = false; _selectedIds.clear();
                            document.getElementById('select-action-bar')?.remove();
                            updateSelectModeUI();
                            loadNotes();
                        });
                    });
                    document.body.appendChild(picker);
                });
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
        const list = document.getElementById('notes-list');
        if (_selectMode) {
            // Remove any stale checkboxes first
            list.querySelectorAll('.select-checkbox').forEach(cb => cb.remove());
            list.style.position = 'relative';
            document.querySelectorAll('.note-bubble').forEach(b => {
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'select-checkbox';
                cb.dataset.noteId = b.dataset.noteId;
                cb.addEventListener('change', () => {
                    if (cb.checked) _selectedIds.add(cb.dataset.noteId);
                    else _selectedIds.delete(cb.dataset.noteId);
                    const count = document.getElementById('select-count');
                    if (count) count.textContent = `已选 ${_selectedIds.size} 项`;
                });
                list.appendChild(cb);
                cb.style.cssText = 'position:absolute;left:8px;width:20px;height:20px;accent-color:var(--accent);cursor:pointer;z-index:5;';
                cb.style.top = (b.offsetTop + 14) + 'px';
            });
        } else {
            list.querySelectorAll('.select-checkbox').forEach(cb => cb.remove());
        }
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

    // Periodic background refresh (reads sync_interval from config)
    setupPeriodicRefresh();

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

    // Workspace toggle
    setupWorkspaceToggle();
    // Workspace manager back button
    document.getElementById('workspace-manager-back')?.addEventListener('click', () => navigateTo('main'));

    // Render sidebar workspaces
    updateSidebarWs();

    setSyncStatus('已同步');
}

async function setupWorkspaceToggle() {
    const toggle = document.getElementById('workspace-toggle');
    if (!toggle) return;
    updateWorkspaceLabel(_currentWorkspace);

    toggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        const existing = document.querySelector('.workspace-dropdown');
        if (existing) { existing.remove(); return; }
        const { getWorkspaces, renderWorkspaceDropdown, showWorkspaceManager } = await import('./workspaces.js');
        const workspaces = await getWorkspaces();
        const dropdown = renderWorkspaceDropdown(workspaces, _currentWorkspace, async (name) => {
            dropdown.remove();
            await switchWorkspace(name);
        }, () => {
            dropdown.remove();
            showWorkspaceManager();
        });
        // Position dropdown below the toggle button (left-aligned)
        const rect = toggle.getBoundingClientRect();
        dropdown.style.top = (rect.bottom + 4) + 'px';
        dropdown.style.left = rect.left + 'px';
        document.body.appendChild(dropdown);
        setTimeout(() => {
            document.addEventListener('click', function closeDropdown() {
                dropdown.remove();
                document.removeEventListener('click', closeDropdown);
            }, { once: true });
        }, 10);
    });
}

async function updateSidebarWs() {
    const sidebarNav = document.querySelector('.sidebar-nav');
    if (!sidebarNav) return;
    const { updateSidebarWorkspaces } = await import('./workspaces.js');
    await updateSidebarWorkspaces(sidebarNav);
}

async function loadOlderNotes() {
    const sb = getSupabase();
    if (!_oldestCursor) { _loadingMore = false; return; }
    let query = sb
        .from('smartstickynotes_items')
        .select('*')
        .eq('status', 'active')
        .lt('created_at', _oldestCursor.created_at)
        .order('created_at', { ascending: false })
        .limit(50);
    if (_currentWorkspace) query = query.eq('workspace', _currentWorkspace);
    try {
        const { data } = await query;
        if (data && data.length > 0) {
            const list = document.getElementById('notes-list');
            const previousScrollHeight = list.scrollHeight;
            data.forEach(n => {
                if (list.querySelector(`[data-note-id="${CSS.escape(n.id)}"]`)) return;
                const bubble = renderNoteBubble(n, null, (b, id, text, tags) => startEditing(b, id, text));
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
        const tags = await fetchTags(_currentWorkspace);
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
            onState: (state, speechOk) => {
                if (state === 'recording') {
                    updateRecordingText(speechOk ? '说话中...' : '录音中（不支持实时转写）');
                    window._speechSupported = speechOk;
                }
            },
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
                if (!window._speechSupported) showToast('语音已保存。手动输入文字后发送');
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
            note = await insertNote({ id: clientId, type: 'voice', text: text || '', tags, workspace: _currentWorkspace, audio_path: '', audio_duration: voiceDur || 0 });
            try {
                const audioPath = await uploadAudio(note.id, voiceBlob);
                await getSupabase().from('smartstickynotes_items').update({ audio_path: audioPath }).eq('id', note.id);
                note.audio_path = audioPath;
            } catch (e) { /* audio upload failed, note still saved */ }
        } else {
            note = await insertNote({ id: clientId, type: 'text', text, tags, workspace: _currentWorkspace, audio_path: null, audio_duration: null });
        }
    } catch (err) {
        _isSending = false; sendBtn.disabled = false;
        if (!isOnline()) {
            await addToQueue({ id: clientId, type: voiceBlob ? 'voice' : 'text', text: text || '', tags, workspace: _currentWorkspace, audio_path: null, audio_duration: null });
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
        requestPcSync(); // auto-request PC sync after saving a note
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
            let query = sb.from('smartstickynotes_items').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(50);
            if (_currentWorkspace) query = query.eq('workspace', _currentWorkspace);
            const { data } = await query;
            notes = (data || []).reverse();
            await cacheNotes(notes);
        }
        notes.forEach(note => {
            if (list.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`)) return;
            const bubble = renderNoteBubble(note, null, (b, id, text, tags) => startEditing(b, id, text));
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
        let q = sb.from('smartstickynotes_items').select('*').eq('status', 'active').ilike('text', `%${query}%`).order('created_at', { ascending: false }).limit(50);
        if (_currentWorkspace) q = q.eq('workspace', _currentWorkspace);
        const { data } = await q;
        list.innerHTML = '';
        (data || []).forEach(n => list.appendChild(renderNoteBubble(n)));
    } catch (e) { /* offline, ignore */ }
}

export async function switchWorkspace(name) {
    _currentWorkspace = name;
    const { setCurrentWorkspace } = await import('./workspaces.js');
    setCurrentWorkspace(name);
    updateWorkspaceLabel(name);
    await updateSidebarWs();
    _oldestCursor = null;
    await loadNotes();
}

function updateWorkspaceLabel(name) {
    const label = document.getElementById('current-workspace-label');
    if (label) label.textContent = name;
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

function setupPeriodicRefresh() {
    let _refreshInterval = null;

    async function updateInterval() {
        if (_refreshInterval) clearInterval(_refreshInterval);
        try {
            const cfg = await readConfig().catch(() => ({}));
            const minutes = parseInt(cfg.sync_interval) || 30;
            const ms = Math.max(minutes * 60 * 1000, 30000); // min 30 seconds
            _refreshInterval = setInterval(async () => {
                if (!document.getElementById('screen-main')?.classList.contains('active')) return;
                try {
                    await loadNotes();
                    setSyncStatus('已同步');
                } catch (e) { /* silent */ }
            }, ms);
        } catch (e) { /* use default */ }
    }

    updateInterval();

    // Re-check interval when returning to main screen (in case config changed)
    const observer = new MutationObserver(() => {
        if (document.getElementById('screen-main')?.classList.contains('active')) {
            updateInterval();
        }
    });
    observer.observe(document.getElementById('app'), { attributes: true, subtree: true, attributeFilter: ['class'] });
}

async function requestPcSync() {
    try {
        const sb = getSupabase();
        await sb.from('sync_requests').insert({ status: 'pending' });
    } catch (e) { /* ignore — PC will pick up on its next poll anyway */ }
}
