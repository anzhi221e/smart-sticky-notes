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
    if (sidebar) { sidebar.classList.remove('open'); sidebar.classList.add('hidden'); }
}

export function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const isOpen = sidebar.classList.contains('open');
    if (isOpen) {
        sidebar.classList.remove('open');
        sidebar.classList.add('hidden');
    } else {
        sidebar.classList.remove('hidden');
        sidebar.classList.add('open');
    }
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

// --- Theme System (8 themes) ---
const THEMES = {
    'pink-light':   { bg:'#fdf2f8', surface:'#fff', surfaceAlt:'#fce7f3', border:'#f0d0e0', text:'#333', textSec:'#777', accent:'#ec4899', accentDim:'rgba(236,72,153,0.15)', multi:false },
    'green-light':  { bg:'#f0fdf4', surface:'#fff', surfaceAlt:'#dcfce7', border:'#d0e8d8', text:'#333', textSec:'#777', accent:'#22c55e', accentDim:'rgba(34,197,94,0.15)', multi:false },
    'blue-light':   { bg:'#f5f8ff', surface:'#fff', surfaceAlt:'#e0e8ff', border:'#d0d8f0', text:'#333', textSec:'#888', accent:'#3b82f6', accentDim:'rgba(59,130,246,0.12)', multi:false },
    'dark-blue':    { bg:'#0f1119', surface:'#1a1d2e', surfaceAlt:'#252840', border:'#2a2d40', text:'#e8e8e8', textSec:'#888', accent:'#6c8cff', accentDim:'rgba(108,140,255,0.15)', multi:false },
    'pure-black':   { bg:'#000', surface:'#111', surfaceAlt:'#1a1a1a', border:'#222', text:'#e8e8e8', textSec:'#888', accent:'#4ade80', accentDim:'rgba(74,222,128,0.15)', multi:false },
    'pink-dark':    { bg:'#1a1518', surface:'#261f23', surfaceAlt:'#32282d', border:'#3a2d33', text:'#e8d8dc', textSec:'#988', accent:'#e05588', accentDim:'rgba(224,85,136,0.15)', multi:false },
    'day-multi':    { bg:'#f5f8ff', surface:'#fff', surfaceAlt:'#e0e8ff', border:'#d0d8f0', text:'#333', textSec:'#888', accent:'#3b82f6', accentDim:'rgba(59,130,246,0.12)', multi:true },
    'night-multi':  { bg:'#0f1119', surface:'#1a1d2e', surfaceAlt:'#252840', border:'#2a2d40', text:'#e8e8e8', textSec:'#888', accent:'#6c8cff', accentDim:'rgba(108,140,255,0.15)', multi:true },
};

const DEFAULT_THEME = 'blue-light';

// 24-color bubble palette for multi-color mode
const BUBBLE_PALETTE = [
    // Dark gradients — high contrast with white text
    'linear-gradient(135deg,#667eea,#764ba2)', 'linear-gradient(135deg,#f093fb,#f5576c)',
    'linear-gradient(135deg,#4facfe,#00f2fe)', 'linear-gradient(135deg,#43e97b,#38f9d7)',
    'linear-gradient(135deg,#fa709a,#ee5a24)', 'linear-gradient(135deg,#a18cd1,#6c5ce7)',
    'linear-gradient(135deg,#f5576c,#e91e63)', 'linear-gradient(135deg,#4facfe,#3b82f6)',
    'linear-gradient(135deg,#11998e,#38ef7d)', 'linear-gradient(135deg,#fc4a1a,#f7b733)',
    'linear-gradient(135deg,#834d9b,#d04ed6)', 'linear-gradient(135deg,#0f2027,#2c5364)',
    // Solid colors — youthful + modern + mature mix
    '#6366f1', '#ec4899', '#f59e0b', '#ef4444',  // vibrant indigo/pink/amber/red
    '#8b5cf6', '#06b6d4', '#84cc16', '#f97316',  // purple/cyan/lime/orange
    '#3b82f6', '#14b8a6', '#e11d48', '#a855f7',  // blue/teal/rose/violet
    '#22c55e', '#d946ef', '#0ea5e9', '#f43f5e',  // green/fuchsia/sky/rose
    '#64748b', '#78716c', '#475569', '#334155',  // mature slate/stone/grey
    '#f472b6', '#38bdf8', '#a3e635', '#fb923c',  // extra light: pink/sky/lime/orange
];
];

export function getTagColor(tag, userOverrides = {}) {
    if (userOverrides[tag] !== undefined) {
        const idx = userOverrides[tag];
        return BUBBLE_PALETTE[idx % BUBBLE_PALETTE.length];
    }
    let hash = 0;
    for (let i = 0; i < tag.length; i++) hash = ((hash << 5) - hash) + tag.charCodeAt(i);
    return BUBBLE_PALETTE[Math.abs(hash) % BUBBLE_PALETTE.length];
}

export function isMultiTheme(name) {
    return THEMES[name]?.multi || false;
}

export function getPalette() { return BUBBLE_PALETTE; }

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
    // Bubble background: accent color for uniform themes, transparent for multi
    root.style.setProperty('--bubble-bg', t.multi ? t.surface : t.accent);
    root.style.setProperty('--bubble-text', t.multi ? t.text : '#fff');
    root.dataset.theme = name;
    root.dataset.multi = t.multi ? '1' : '0';
    localStorage.setItem('ssn-theme', name);
}

export function getThemeNames() { return Object.keys(THEMES); }
export function getThemeMeta(name) { return THEMES[name] || THEMES[DEFAULT_THEME]; }
