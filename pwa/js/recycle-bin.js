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

    if (expired.length > 0) {
        const purgeAll = document.createElement('button');
        purgeAll.style.cssText = 'margin:12px 0;padding:10px;width:100%;background:var(--danger);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;';
        purgeAll.textContent = `清除全部已过期笔记 (${expired.length} 条)`;
        purgeAll.addEventListener('click', async () => {
            for (const n of expired) await permanentDeleteNote(n.id, n.audio_path);
            showRecycleBin();
            showToast('已清除过期笔记');
        });
        list.appendChild(purgeAll);
    }

    notes.forEach(note => {
        const deletedAt = new Date(note.deleted_at).getTime();
        const purgeAt = deletedAt + 30 * 24 * 60 * 60 * 1000;
        const daysLeft = Math.max(0, Math.ceil((purgeAt - now) / (24 * 60 * 60 * 1000)));

        const div = document.createElement('div');
        div.className = 'note-bubble';
        div.innerHTML = `
            <div class="note-text">${note.text || '[无文字]'}</div>
            <div class="note-meta">
                <span>${new Date(note.created_at).toLocaleString('zh-CN')}</span>
                <span style="color:var(--danger);">${daysLeft} 天后自动清除</span>
            </div>
            <div style="display:flex;gap:8px;margin-top:8px;">
                <button class="restore-btn">恢复</button>
                <button class="purge-btn">立即清除</button>
            </div>
        `;
        div.querySelector('.restore-btn').style.cssText = 'padding:6px 14px;background:var(--accent);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;';
        div.querySelector('.purge-btn').style.cssText = 'padding:6px 14px;background:var(--danger);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;';

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
