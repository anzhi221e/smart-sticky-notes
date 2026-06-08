import { fetchDeletedNotes, restoreNote, permanentDeleteNote } from './db.js';
import { showToast, navigateTo } from './ui.js';

export async function showRecycleBin() {
    navigateTo('recycle-bin');
    const list = document.getElementById('trash-list');
    if (!list) return;

    let notes;
    try { notes = await fetchDeletedNotes(); } catch { notes = []; }
    list.innerHTML = '';

    if (notes.length === 0) {
        list.innerHTML = '<p style="padding:24px;color:var(--text-secondary);text-align:center;">回收站为空</p>';
        return;
    }

    const now = Date.now();
    const expired = notes.filter(n => {
        const d = new Date(n.deleted_at).getTime();
        return d + 30 * 24 * 60 * 60 * 1000 < now;
    });

    // Batch toolbar
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;gap:8px;padding:8px 0;position:sticky;top:0;background:var(--bg);z-index:5;';
    toolbar.innerHTML = `
        <button id="select-all-btn" style="padding:6px 14px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:16px;cursor:pointer;font-size:13px;">全选</button>
        <button id="batch-restore-btn" style="padding:6px 14px;background:var(--accent);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;display:none;">恢复所选</button>
        <button id="batch-purge-btn" style="padding:6px 14px;background:var(--danger);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;display:none;">删除所选</button>
    `;
    if (expired.length > 0) {
        const purgeExpired = document.createElement('button');
        purgeExpired.textContent = `清除过期 (${expired.length})`;
        purgeExpired.style.cssText = 'padding:6px 14px;background:var(--danger);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;';
        purgeExpired.addEventListener('click', async () => {
            for (const n of expired) await permanentDeleteNote(n.id, n.audio_path);
            showRecycleBin(); showToast('已清除过期笔记');
        });
        toolbar.appendChild(purgeExpired);
    }
    list.appendChild(toolbar);

    const selectedIds = new Set();
    function updateBatchButtons() {
        const hasSel = selectedIds.size > 0;
        toolbar.querySelector('#batch-restore-btn').style.display = hasSel ? '' : 'none';
        toolbar.querySelector('#batch-purge-btn').style.display = hasSel ? '' : 'none';
    }

    toolbar.querySelector('#select-all-btn').addEventListener('click', () => {
        const allSelected = selectedIds.size === notes.length;
        selectedIds.clear();
        if (!allSelected) notes.forEach(n => selectedIds.add(n.id));
        list.querySelectorAll('.trash-checkbox').forEach(cb => cb.checked = !allSelected);
        updateBatchButtons();
    });
    toolbar.querySelector('#batch-restore-btn').addEventListener('click', async () => {
        for (const id of selectedIds) await restoreNote(id);
        showRecycleBin(); showToast(`已恢复 ${selectedIds.size} 条`);
    });
    toolbar.querySelector('#batch-purge-btn').addEventListener('click', async () => {
        if (!confirm(`确定永久删除 ${selectedIds.size} 条笔记？不可恢复。`)) return;
        for (const id of selectedIds) {
            const n = notes.find(n => n.id === id);
            await permanentDeleteNote(id, n?.audio_path);
        }
        showRecycleBin(); showToast(`已删除 ${selectedIds.size} 条`);
    });

    notes.forEach(note => {
        const deletedAt = new Date(note.deleted_at).getTime();
        const purgeAt = deletedAt + 30 * 24 * 60 * 60 * 1000;
        const daysLeft = Math.max(0, Math.ceil((purgeAt - now) / (24 * 60 * 60 * 1000)));

        const div = document.createElement('div');
        div.className = 'note-bubble';
        div.style.cssText = 'display:flex;gap:8px;align-items:flex-start;';
        div.innerHTML = `
            <input type="checkbox" class="trash-checkbox" style="margin-top:3px;accent-color:var(--accent);">
            <div style="flex:1;">
                <div class="note-text">${note.text || '[无文字]'}</div>
                <div class="note-meta">
                    <span>${new Date(note.created_at).toLocaleString('zh-CN')}</span>
                    <span style="color:var(--danger);">${daysLeft} 天后自动清除</span>
                </div>
                <div style="display:flex;gap:8px;margin-top:8px;">
                    <button class="restore-btn">恢复</button>
                    <button class="purge-btn">立即清除</button>
                </div>
            </div>
        `;
        div.querySelector('.restore-btn').style.cssText = 'padding:6px 14px;background:var(--accent);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;';
        div.querySelector('.purge-btn').style.cssText = 'padding:6px 14px;background:var(--danger);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;';

        const cb = div.querySelector('.trash-checkbox');
        cb.addEventListener('change', () => {
            if (cb.checked) selectedIds.add(note.id);
            else selectedIds.delete(note.id);
            updateBatchButtons();
        });

        div.querySelector('.restore-btn').addEventListener('click', async () => {
            await restoreNote(note.id); div.remove(); showToast('已恢复');
        });
        div.querySelector('.purge-btn').addEventListener('click', async () => {
            await permanentDeleteNote(note.id, note.audio_path); div.remove(); showToast('已彻底删除');
        });
        list.appendChild(div);
    });
}
