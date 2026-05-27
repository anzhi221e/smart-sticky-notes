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
