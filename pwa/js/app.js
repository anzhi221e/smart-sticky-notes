import { initSupabase, getSupabase, getConnection, saveConnection } from './supabase.js';
import { sendMagicLink, getSession, signOut, onAuthStateChange } from './auth.js';
import {
    fetchNotes, insertNote, uploadAudio, readConfig, writeConfig,
    fetchTags, fetchNotesByTag, fetchDeletedNotes, restoreNote,
    permanentDeleteNote, softDeleteNote,
} from './db.js';
import { renderNoteBubble, parseTags } from './notes.js';
import { startRecording, stopRecording, cancelRecording, getIsRecording } from './voice.js';
import {
    navigateTo, toggleSidebar, setSyncStatus, setMicEnabled,
    toggleSendButton, showRecordingOverlay, hideRecordingOverlay,
    updateRecordingText, showToast,
} from './ui.js';
import { isOnline, onNetworkChange, cacheNotes, getCachedNotes,
    addToQueue, getQueueCount, flushQueue } from './offline.js';
import { renderCalendarDay, renderCalendarWeek, renderCalendarMonth, renderCalendarYear } from './calendar.js';

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
    const conn = getConnection();
    if (!conn.url || !conn.anonKey) {
        document.getElementById('screen-connect').classList.add('active');
        setupConnectionForm();
        return;
    }

    initSupabase(conn.url, conn.anonKey);

    const session = await getSession();
    if (session) {
        navigateTo('main');
        await loadNotes();
        setupMainUI();
        // Check if wizard needed
        const cfg = await readConfig();
        if (!cfg.local_folder_path) {
            navigateTo('wizard');
            import('./wizard.js').then(m => m.renderWizard(1));
        }
    } else {
        document.getElementById('screen-auth').classList.add('active');
        setupAuthUI();
    }
});

// --- Connection form ---
function setupConnectionForm() {
    const form = document.getElementById('connect-form');
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const url = document.getElementById('connect-url').value.trim();
        const anonKey = document.getElementById('connect-anon-key').value.trim();
        if (!url || !anonKey) return;
        saveConnection(url, anonKey);
        window.location.reload();
    });
}

// --- Auth UI ---
function setupAuthUI() {
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email-input').value.trim();
        if (!email) return;
        const msg = document.getElementById('login-msg');
        msg.classList.remove('hidden');
        msg.textContent = '正在发送登录链接...';
        msg.classList.remove('error');
        const { error } = await sendMagicLink(email);
        if (error) {
            msg.textContent = '发送失败: ' + error.message;
            msg.classList.add('error');
        } else {
            msg.textContent = '登录链接已发送，请检查邮箱并点击链接';
        }
    });

    onAuthStateChange((event, session) => {
        if (session) {
            document.getElementById('screen-auth').classList.remove('active');
            navigateTo('main');
            loadNotes();
            setupMainUI();
        }
    });
}

// --- Main UI ---
function setupMainUI() {
    document.getElementById('menu-toggle').addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-close').addEventListener('click', toggleSidebar);

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const screen = item.dataset.screen;
            if (screen === 'recycle-bin') showRecycleBin();
            else if (screen === 'tags') showTags();
            else if (screen === 'settings') showSettings();
            else navigateTo('main');
        });
    });

    document.getElementById('calendar-toggle').addEventListener('click', () => {
        navigateTo('calendar');
        renderCalendarMonth(new Date());
    });

    const textInput = document.getElementById('text-input');
    textInput.addEventListener('input', () => {
        toggleSendButton(textInput.value.trim().length > 0);
    });
    textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendTextNote();
    });

    document.getElementById('send-btn').addEventListener('click', sendTextNote);

    const micBtn = document.getElementById('mic-btn');
    micBtn.addEventListener('pointerdown', onMicPress);

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
            const view = tab.dataset.view;
            const now = new Date();
            if (view === 'day') renderCalendarDay(now);
            else if (view === 'week') renderCalendarWeek(now);
            else if (view === 'month') renderCalendarMonth(now);
            else if (view === 'year') renderCalendarYear(now);
        });
    });

    document.getElementById('trash-back')?.addEventListener('click', () => { navigateTo('main'); loadNotes(); });
    document.getElementById('tags-back')?.addEventListener('click', () => navigateTo('main'));
    document.getElementById('settings-back')?.addEventListener('click', () => navigateTo('main'));

    setSyncStatus('已同步');
}

function updateMicState() {
    if (isOnline()) {
        setMicEnabled(true);
    } else {
        setMicEnabled(false);
    }
}

async function onMicPress(e) {
    if (!isOnline()) {
        showToast('当前离线，请使用文字输入');
        return;
    }
    if (getIsRecording()) return;

    const startY = e.clientY;
    let cancelled = false;
    let touchMoved = false;

    showRecordingOverlay('准备录音...');

    try {
        await startRecording({
            onText: (text, isFinal) => updateRecordingText(text),
            onState: (state) => {
                if (state === 'recording') updateRecordingText('说话中...');
            },
        });
    } catch (err) {
        hideRecordingOverlay();
        if (err.message === 'offline') showToast('当前离线，请使用文字输入');
        else showToast('无法访问麦克风');
        return;
    }

    const onMove = (ev) => {
        touchMoved = true;
        const dy = startY - ev.clientY;
        if (dy > 60) {
            cancelled = true;
            updateRecordingText('松开取消');
        }
    };

    const onUp = async () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);

        hideRecordingOverlay();

        if (cancelled) {
            cancelRecording();
            return;
        }

        let transcriptionText = '';
        try {
            const result = await stopRecording();
            if (result && result.blob) {
                const currentText = document.getElementById('recording-text')?.textContent;
                transcriptionText = (currentText && currentText !== '说话中...' && currentText !== '松开取消')
                    ? currentText : '';

                document.getElementById('text-input').value = transcriptionText;
                toggleSendButton(transcriptionText.trim().length > 0);
                window._pendingVoiceBlob = result.blob;
                window._pendingVoiceDuration = result.duration;
            }
        } catch (err) {
            showToast('录音保存失败');
        }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
}

let _isSending = false;

async function sendTextNote() {
    if (_isSending) return;
    _isSending = true;

    const textInput = document.getElementById('text-input');
    const sendBtn = document.getElementById('send-btn');
    const text = textInput.value.trim();

    sendBtn.disabled = true;

    if (!text && !window._pendingVoiceBlob) {
        _isSending = false;
        sendBtn.disabled = false;
        return;
    }

    const tags = parseTags(text || '');
    const type = window._pendingVoiceBlob ? 'voice' : 'text';

    try {
        let note;
        if (window._pendingVoiceBlob) {
            // Insert note first to get ID
            note = await insertNote({
                type: 'voice', text: text || '', tags,
                audio_path: '', audio_duration: window._pendingVoiceDuration || 0,
            });
            // Upload audio
            try {
                const audioPath = await uploadAudio(note.id, window._pendingVoiceBlob);
                await getSupabase()
                    .from('smartstickynotes_items')
                    .update({ audio_path: audioPath })
                    .eq('id', note.id);
                note.audio_path = audioPath;
            } catch (e) {
                console.error('Audio upload failed:', e);
            }
            window._pendingVoiceBlob = null;
            window._pendingVoiceDuration = null;
        } else {
            note = await insertNote({ type: 'text', text, tags, audio_path: null, audio_duration: null });
        }

        textInput.value = '';
        toggleSendButton(false);

        const list = document.getElementById('notes-list');
        const bubble = renderNoteBubble(note);
        list.insertBefore(bubble, list.firstChild);

        // Update cache
        const allBubbles = list.querySelectorAll('.note-bubble');
        const noteData = Array.from(allBubbles).map(b => ({
            id: b.dataset.noteId, type, text, tags,
            created_at: new Date().toISOString(),
        }));
        await cacheNotes(noteData);
        _isSending = false;
        sendBtn.disabled = false;
    } catch (err) {
        _isSending = false;
        sendBtn.disabled = false;
        if (!isOnline()) {
            await addToQueue({ type, text: text || '', tags, audio_path: null, audio_duration: null });
            showToast('已保存到本地，联网后自动发送');
            textInput.value = '';
            toggleSendButton(false);
        } else {
            showToast('发送失败: ' + err.message);
        }
    }
}

export async function loadNotes() {
    const list = document.getElementById('notes-list');
    if (!list) return;
    list.innerHTML = '';

    try {
        let notes;
        if (!isOnline()) {
            notes = await getCachedNotes();
        } else {
            notes = await fetchNotes(100);
            await cacheNotes(notes);
        }
        notes.forEach(note => {
            const bubble = renderNoteBubble(note);
            list.appendChild(bubble);
        });
    } catch (err) {
        const cached = await getCachedNotes();
        cached.forEach(note => {
            const bubble = renderNoteBubble(note);
            list.appendChild(bubble);
        });
    }

    const queueCount = await getQueueCount();
    if (queueCount > 0) setSyncStatus(`${queueCount} 条待发送`);
}

async function flushAndReload() {
    const sent = await flushQueue(async (item) => {
        await insertNote(item);
    });
    if (sent > 0) {
        setSyncStatus('已同步');
        await loadNotes();
    }
}

function setupPullToRefresh() {
    const list = document.getElementById('notes-list');
    let startY = 0;
    list.addEventListener('touchstart', (e) => {
        if (list.scrollTop === 0) startY = e.touches[0].clientY;
    }, { passive: true });
    list.addEventListener('touchend', async (e) => {
        if (list.scrollTop <= 0) {
            const diff = e.changedTouches[0].clientY - startY;
            if (diff > 60) {
                setSyncStatus('同步中...');
                await loadNotes();
                setSyncStatus('已同步');
            }
        }
    });
}

// --- Recycle Bin ---
async function showRecycleBin() {
    navigateTo('recycle-bin');
    const list = document.getElementById('trash-list');
    if (!list) return;
    list.innerHTML = '';
    let notes;
    try { notes = await fetchDeletedNotes(); } catch { notes = []; }
    notes.forEach(note => {
        const div = document.createElement('div');
        div.className = 'note-bubble';
        div.innerHTML = `
            <div class="note-text">${note.text || '[无文字]'}</div>
            <div class="note-meta">${new Date(note.created_at).toLocaleString('zh-CN')}</div>
            <div style="display:flex;gap:8px;margin-top:8px;">
                <button class="restore-btn" style="padding:6px 14px;background:var(--accent);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;">恢复</button>
                <button class="purge-btn" style="padding:6px 14px;background:var(--danger);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;">彻底删除</button>
            </div>
        `;
        div.querySelector('.restore-btn').addEventListener('click', async () => {
            await restoreNote(note.id);
            div.remove();
            showToast('已恢复');
        });
        div.querySelector('.purge-btn').addEventListener('click', async () => {
            await permanentDeleteNote(note.id, note.audio_path);
            div.remove();
            showToast('已彻底删除');
        });
        list.appendChild(div);
    });
}

// --- Tags ---
async function showTags() {
    navigateTo('tags');
    const content = document.getElementById('tags-content');
    if (!content) return;
    let tags;
    try { tags = await fetchTags(); } catch { tags = {}; }
    content.innerHTML = '';
    const sorted = Object.entries(tags).sort((a, b) => b[1] - a[1]);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:16px;';
    sorted.forEach(([tag, count]) => {
        const pill = document.createElement('button');
        pill.style.cssText = 'background:var(--accent-dim);color:var(--accent);border:none;padding:8px 16px;border-radius:20px;font-size:14px;cursor:pointer;';
        pill.textContent = `#${tag} (${count})`;
        pill.addEventListener('click', () => navigateToTags(tag));
        grid.appendChild(pill);
    });
    content.appendChild(grid);
}

export async function navigateToTags(tag) {
    navigateTo('tags');
    const content = document.getElementById('tags-content');
    if (!content) return;
    let notes;
    try { notes = await fetchNotesByTag(tag); } catch { notes = []; }
    content.innerHTML = `<h3 style="padding:16px;font-size:16px;">#${tag}</h3>`;
    if (notes.length === 0) {
        const empty = document.createElement('p');
        empty.style.cssText = 'padding:16px;color:var(--text-secondary);';
        empty.textContent = '没有该标签的笔记';
        content.appendChild(empty);
    } else {
        notes.forEach(note => content.appendChild(renderNoteBubble(note)));
    }
}

// --- Settings ---
async function showSettings() {
    navigateTo('settings');
    const content = document.getElementById('settings-content');
    if (!content) return;
    let cfg;
    try { cfg = await readConfig(); } catch { cfg = {}; }

    content.innerHTML = `
        <div class="setting-group">
            <h3>同步</h3>
            <div class="setting-row">
                <label>本地文件夹路径</label>
                <input type="text" id="cfg-folder" value="${cfg.local_folder_path || ''}" placeholder="例如: D:/OneDrive/Notes">
                <span class="setting-hint" id="cfg-folder-hint"></span>
            </div>
            <div class="setting-row">
                <label>文件名格式</label>
                <input type="text" id="cfg-template" value="${cfg.filename_template || '{date}_{time}_{type}_{id}'}">
                <span class="setting-hint">可用: {date} {time} {type} {id} {tag}</span>
                <span class="setting-preview" id="template-preview"></span>
            </div>
            <button id="cfg-sync-now" style="padding:10px 20px;background:var(--accent);color:#fff;border:none;border-radius:20px;cursor:pointer;font-size:14px;margin-top:8px;">立即同步配置到 PC</button>
        </div>
        <div class="setting-group">
            <h3>偏好</h3>
            <div class="setting-row">
                <label>默认日历视图</label>
                <select id="cfg-calendar-view">
                    <option value="day" ${cfg.default_calendar_view === 'day' ? 'selected' : ''}>日</option>
                    <option value="week" ${cfg.default_calendar_view === 'week' ? 'selected' : ''}>周</option>
                    <option value="month" ${cfg.default_calendar_view === 'month' ? 'selected' : ''}>月</option>
                </select>
            </div>
        </div>
        <div class="setting-group">
            <h3>账户</h3>
            <button id="logout-btn" style="padding:10px 20px;background:var(--danger);color:#fff;border:none;border-radius:20px;cursor:pointer;font-size:14px;">退出登录</button>
        </div>
    `;

    const templateInput = document.getElementById('cfg-template');
    const preview = document.getElementById('template-preview');
    const updatePreview = () => {
        const now = new Date();
        const previewText = templateInput.value
            .replace('{date}', now.toISOString().split('T')[0])
            .replace('{time}', now.toTimeString().split(' ')[0].replace(/:/g, ''))
            .replace('{type}', 'voice')
            .replace('{id}', 'a1b2c3d4')
            .replace('{tag}', '产品');
        preview.textContent = '预览: ' + previewText + '.md';
    };
    templateInput.addEventListener('input', updatePreview);
    updatePreview();

    const saveField = async (key, value) => {
        await writeConfig(key, value);
        const hint = document.getElementById('cfg-folder-hint');
        if (hint) hint.textContent = '已保存 · PC 端将在 5 分钟内生效';
    };
    document.getElementById('cfg-folder').addEventListener('change', (e) => saveField('local_folder_path', e.target.value));
    document.getElementById('cfg-template').addEventListener('change', (e) => saveField('filename_template', e.target.value));
    document.getElementById('cfg-calendar-view').addEventListener('change', (e) => saveField('default_calendar_view', e.target.value));

    document.getElementById('cfg-sync-now').addEventListener('click', async () => {
        await writeConfig('config_sync_requested_at', new Date().toISOString());
        const hint = document.getElementById('cfg-folder-hint');
        if (hint) hint.textContent = '已发送同步请求 · PC 将在 30 秒内响应';
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await signOut();
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('screen-auth').classList.add('active');
    });
}
