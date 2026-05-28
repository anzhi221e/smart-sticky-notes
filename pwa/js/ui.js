// Toast, screen navigation, and DOM helpers

export function showToast(message, { undoLabel, onUndo, duration = 3000 } = {}) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;

    if (undoLabel && onUndo) {
        const btn = document.createElement('button');
        btn.className = 'undo-btn';
        btn.textContent = undoLabel;
        btn.addEventListener('click', () => {
            onUndo();
            toast.remove();
        });
        toast.appendChild(btn);
    }

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

export function navigateTo(screenId) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.classList.add('hidden');
    });
    const screen = document.getElementById(`screen-${screenId}`);
    if (screen) {
        screen.classList.add('active');
        screen.classList.remove('hidden');
    }
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.add('hidden');
}

export function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');
    sidebar.classList.toggle('hidden');
}

export function setSyncStatus(text) {
    const el = document.getElementById('sync-status');
    if (el) el.textContent = text;
}

export function setMicEnabled(enabled) {
    const btn = document.getElementById('mic-btn');
    if (!btn) return;
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? '' : '0.3';
}

export function toggleSendButton(show) {
    const micBtn = document.getElementById('mic-btn');
    const sendBtn = document.getElementById('send-btn');
    if (!micBtn || !sendBtn) return;
    if (show) {
        micBtn.classList.add('hidden');
        sendBtn.classList.remove('hidden');
    } else {
        micBtn.classList.remove('hidden');
        sendBtn.classList.add('hidden');
    }
}

export function showRecordingOverlay(text) {
    let overlay = document.getElementById('recording-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'recording-overlay';
        overlay.className = 'recording-overlay';
        overlay.innerHTML = `
            <div class="recording-waveform" id="waveform"></div>
            <div class="recording-text" id="recording-text"></div>
            <div class="recording-hint">上滑取消</div>
        `;
        const waveform = overlay.querySelector('#waveform');
        for (let i = 0; i < 20; i++) {
            const bar = document.createElement('div');
            bar.className = 'bar';
            bar.style.animationDelay = `${i * 0.05}s`;
            waveform.appendChild(bar);
        }
        document.getElementById('app').appendChild(overlay);
    }
    overlay.classList.add('active');
    document.getElementById('recording-text').textContent = text || '准备录音...';
}

export function hideRecordingOverlay() {
    const overlay = document.getElementById('recording-overlay');
    if (overlay) overlay.classList.remove('active');
}

export function updateRecordingText(text) {
    const el = document.getElementById('recording-text');
    if (el) el.textContent = text || '说话中...';
}

// --- Theme System ---
const THEMES = {
    'pink-light':   { bg:'#fff5f7', surface:'#fff', surfaceAlt:'#ffe0e5', border:'#f0d0d8', text:'#333', textSec:'#888', accent:'#e91e63', accentDim:'rgba(233,30,99,0.12)' },
    'green-light':  { bg:'#f5fff8', surface:'#fff', surfaceAlt:'#e0ffe8', border:'#d0e8d8', text:'#333', textSec:'#888', accent:'#10b981', accentDim:'rgba(16,185,129,0.12)' },
    'blue-light':   { bg:'#f5f8ff', surface:'#fff', surfaceAlt:'#e0e8ff', border:'#d0d8f0', text:'#333', textSec:'#888', accent:'#3b82f6', accentDim:'rgba(59,130,246,0.12)' },
    'dark-blue':    { bg:'#0f1119', surface:'#1a1d2e', surfaceAlt:'#252840', border:'#2a2d40', text:'#e8e8e8', textSec:'#888', accent:'#6c8cff', accentDim:'rgba(108,140,255,0.15)' },
    'pure-black':   { bg:'#000', surface:'#111', surfaceAlt:'#1a1a1a', border:'#222', text:'#e8e8e8', textSec:'#888', accent:'#4ade80', accentDim:'rgba(74,222,128,0.15)' },
    'pink-dark':    { bg:'#1a1518', surface:'#261f23', surfaceAlt:'#32282d', border:'#3a2d33', text:'#e8d8dc', textSec:'#988', accent:'#e05588', accentDim:'rgba(224,85,136,0.15)' },
};

const DEFAULT_THEME = 'dark-blue';

export function applyTheme(name) {
    const t = THEMES[name] || THEMES[DEFAULT_THEME];
    const root = document.documentElement;
    root.style.setProperty('--bg', t.bg);
    root.style.setProperty('--surface', t.surface);
    root.style.setProperty('--surface-hover', t.surfaceAlt);
    root.style.setProperty('--border', t.border);
    root.style.setProperty('--text', t.text);
    root.style.setProperty('--text-secondary', t.textSec);
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent-dim', t.accentDim);
    localStorage.setItem('ssn-theme', name);
}

export function getThemeNames() { return Object.keys(THEMES); }
export function getThemeMeta(name) { return THEMES[name] || THEMES[DEFAULT_THEME]; }
