import { readConfig, writeConfig, batchUpdateWorkspace, batchSoftDeleteByWorkspace } from './db.js';
import { showToast } from './ui.js';

const DEFAULT_WORKSPACE = '默认';

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

export function getDefaultWorkspaceName() { return DEFAULT_WORKSPACE; }

export async function getWorkspaces() {
    try {
        const cfg = await readConfig().catch(() => ({}));
        const custom = JSON.parse(cfg.workspaces || '[]');
        return [DEFAULT_WORKSPACE, ...custom];
    } catch { return [DEFAULT_WORKSPACE]; }
}

export async function getCustomWorkspaces() {
    try {
        const cfg = await readConfig().catch(() => ({}));
        return JSON.parse(cfg.workspaces || '[]');
    } catch { return []; }
}

export async function getDefaultWorkspace() {
    try {
        const cfg = await readConfig().catch(() => ({}));
        return cfg.default_workspace || DEFAULT_WORKSPACE;
    } catch { return DEFAULT_WORKSPACE; }
}

export function getCurrentWorkspace() {
    return sessionStorage.getItem('ssn-workspace') || DEFAULT_WORKSPACE;
}

export function setCurrentWorkspace(name) {
    sessionStorage.setItem('ssn-workspace', name);
}

export async function createWorkspace(name) {
    if (!name || !name.trim()) throw new Error('名称不能为空');
    const trimmed = name.trim();
    if (trimmed === DEFAULT_WORKSPACE) throw new Error('不能使用保留名称');
    const workspaces = await getWorkspaces();
    if (workspaces.includes(trimmed)) throw new Error('工作区已存在');
    const custom = await getCustomWorkspaces();
    custom.push(trimmed);
    await writeConfig('workspaces', JSON.stringify(custom));
    return trimmed;
}

export async function renameWorkspace(oldName, newName) {
    if (oldName === DEFAULT_WORKSPACE) throw new Error('不能重命名默认工作区');
    if (!newName || !newName.trim()) throw new Error('名称不能为空');
    const trimmed = newName.trim();
    if (trimmed === DEFAULT_WORKSPACE) throw new Error('不能使用保留名称');
    const workspaces = await getWorkspaces();
    if (workspaces.includes(trimmed)) throw new Error('工作区已存在');
    await batchUpdateWorkspace(oldName, trimmed);
    const custom = await getCustomWorkspaces();
    const idx = custom.indexOf(oldName);
    if (idx !== -1) {
        custom[idx] = trimmed;
        await writeConfig('workspaces', JSON.stringify(custom));
    }
    const cfg = await readConfig().catch(() => ({}));
    if (cfg.default_workspace === oldName) {
        await writeConfig('default_workspace', trimmed);
    }
    const current = getCurrentWorkspace();
    if (current === oldName) setCurrentWorkspace(trimmed);
    return trimmed;
}

export async function deleteWorkspace(name) {
    if (name === DEFAULT_WORKSPACE) throw new Error('不能删除默认工作区');
    await batchSoftDeleteByWorkspace(name);
    const custom = await getCustomWorkspaces();
    const idx = custom.indexOf(name);
    if (idx !== -1) {
        custom.splice(idx, 1);
        await writeConfig('workspaces', JSON.stringify(custom));
    }
    const cfg = await readConfig().catch(() => ({}));
    if (cfg.default_workspace === name) {
        await writeConfig('default_workspace', DEFAULT_WORKSPACE);
    }
    const current = getCurrentWorkspace();
    if (current === name) setCurrentWorkspace(DEFAULT_WORKSPACE);
}

export async function setDefaultWorkspace(name) {
    if (!name || !name.trim()) return;
    await writeConfig('default_workspace', name.trim());
}

export function renderWorkspaceDropdown(workspaces, current, onSelect, onManage) {
    const dropdown = document.createElement('div');
    dropdown.className = 'workspace-dropdown';
    dropdown.innerHTML = workspaces.map(w => `
        <div class="workspace-dropdown-item ${w === current ? 'workspace-dropdown-item--active' : ''}" data-workspace="${esc(w)}">
            <span>${w === DEFAULT_WORKSPACE ? '📌 ' : ''}${esc(w)}</span>
            ${w === current ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
        </div>
    `).join('');
    dropdown.innerHTML += `
        <div class="workspace-dropdown-divider"></div>
        <div class="workspace-dropdown-item workspace-dropdown-item--manage" data-action="manage">
            <span>管理对话</span>
        </div>
    `;
    dropdown.querySelectorAll('[data-workspace]').forEach(item => {
        item.addEventListener('click', () => onSelect(item.dataset.workspace));
    });
    const manageBtn = dropdown.querySelector('[data-action="manage"]');
    if (manageBtn && onManage) manageBtn.addEventListener('click', onManage);
    return dropdown;
}

export function renderWorkspaceFilter(container, workspaces, currentFilter, onFilter) {
    container.innerHTML = '';
    const scroll = document.createElement('div');
    scroll.className = 'workspace-filter-scroll';

    const allBtn = document.createElement('button');
    allBtn.className = 'workspace-filter-btn' + (currentFilter === '__all__' ? ' workspace-filter-btn--active' : '');
    allBtn.textContent = '全部';
    allBtn.addEventListener('click', () => onFilter('__all__'));
    scroll.appendChild(allBtn);

    workspaces.forEach(w => {
        const btn = document.createElement('button');
        btn.className = 'workspace-filter-btn' + (currentFilter === w ? ' workspace-filter-btn--active' : '');
        btn.textContent = w;
        btn.addEventListener('click', () => onFilter(w));
        scroll.appendChild(btn);
    });

    container.appendChild(scroll);
}

export async function renderWorkspaceManager(container) {
    const workspaces = await getWorkspaces();
    const defaultWs = await getDefaultWorkspace();
    const current = getCurrentWorkspace();

    container.innerHTML = `
        <h2 style="margin-bottom:12px;">对话管理</h2>
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">创建和管理你的对话工作区</p>
        <div style="display:flex;gap:8px;margin-bottom:20px;">
            <input type="text" id="new-workspace-input" placeholder="输入对话名称..." style="flex:1;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px;font-family:var(--font);outline:none;">
            <button id="new-workspace-btn" style="padding:10px 20px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;white-space:nowrap;">新建</button>
        </div>
        <div id="workspace-list" class="workspace-list"></div>
    `;

    const list = container.querySelector('#workspace-list');
    renderWorkspaceList(list, workspaces, defaultWs, current);

    container.querySelector('#new-workspace-btn').addEventListener('click', async () => {
        const input = container.querySelector('#new-workspace-input');
        const name = input.value.trim();
        if (!name) { showToast('请输入名称'); return; }
        try {
            await createWorkspace(name);
            input.value = '';
            await renderWorkspaceManager(container);
            showToast('对话已创建');
        } catch (e) { showToast(e.message); }
    });

    container.querySelector('#new-workspace-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') container.querySelector('#new-workspace-btn').click();
    });
}

async function renderWorkspaceList(container, workspaces, defaultWs, current) {
    container.innerHTML = '';
    for (const w of workspaces) {
        const isDefault = w === DEFAULT_WORKSPACE;
        const isDefaultOpen = w === defaultWs;

        const item = document.createElement('div');
        item.className = 'workspace-item';
        const safeName = esc(w);
        item.innerHTML = `
            <div class="workspace-item-info">
                <span class="workspace-item-name">${isDefault ? '📌 ' : ''}${safeName}</span>
                <span class="workspace-item-meta">
                    ${isDefault ? '系统保留' : ''}
                    ${isDefaultOpen ? ' · 默认打开' : ''}
                    ${w === current ? ' · 当前' : ''}
                </span>
            </div>
            <div class="workspace-item-actions">
                ${!isDefault ? `<button class="workspace-action-btn" data-action="rename" data-workspace="${safeName}" title="重命名">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>` : ''}
                ${!isDefaultOpen ? `<button class="workspace-action-btn" data-action="setDefault" data-workspace="${safeName}" title="设为默认">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                </button>` : ''}
                ${!isDefault ? `<button class="workspace-action-btn workspace-action-btn--danger" data-action="delete" data-workspace="${safeName}" title="删除">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>` : ''}
            </div>
        `;
        container.appendChild(item);
    }

    container.querySelectorAll('[data-action="rename"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const oldName = btn.dataset.workspace;
            const newName = prompt('输入新名称:', oldName);
            if (newName && newName.trim() && newName.trim() !== oldName) {
                try {
                    await renameWorkspace(oldName, newName.trim());
                    const parent = container.closest('.settings-content');
                    if (parent) await renderWorkspaceManager(parent);
                    showToast('已重命名');
                } catch (e) { showToast(e.message); }
            }
        });
    });

    container.querySelectorAll('[data-action="setDefault"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            await setDefaultWorkspace(btn.dataset.workspace);
            const parent = container.closest('.settings-content');
            if (parent) await renderWorkspaceManager(parent);
            showToast('已设为默认工作区');
        });
    });

    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const wsName = btn.dataset.workspace;
            if (!confirm(`确定删除对话「${wsName}」？\n\n该工作区中的所有笔记将被移入回收站，30 天后自动清除。`)) return;
            await deleteWorkspace(wsName);
            const parent = container.closest('.settings-content');
            if (parent) await renderWorkspaceManager(parent);
            showToast('对话已删除，笔记已移入回收站');
        });
    });
}

export async function updateSidebarWorkspaces(sidebarNav) {
    const existingWs = sidebarNav.querySelectorAll('.nav-workspace-item');
    existingWs.forEach(el => el.remove());
    const existingSep = sidebarNav.querySelector('.nav-workspace-separator');
    if (existingSep) existingSep.remove();
    const existingManage = sidebarNav.querySelector('.nav-item-workspace-manager');
    if (existingManage) existingManage.remove();

    const workspaces = await getWorkspaces();
    const current = getCurrentWorkspace();

    if (workspaces.length <= 1) {
        const manageBtn = document.createElement('button');
        manageBtn.className = 'nav-item nav-item-workspace-manager';
        manageBtn.textContent = '对话管理';
        manageBtn.addEventListener('click', async () => {
            const { showWorkspaceManager } = await import('./workspaces.js');
            showWorkspaceManager();
        });
        sidebarNav.appendChild(manageBtn);
        return;
    }

    const sep = document.createElement('div');
    sep.className = 'nav-workspace-separator';
    sep.style.cssText = 'height:1px;background:var(--border);margin:8px 12px;';

    const label = document.createElement('div');
    label.className = 'nav-section-label';
    label.style.cssText = 'font-size:11px;color:var(--text-secondary);padding:4px 16px;text-transform:uppercase;letter-spacing:0.5px;';
    label.textContent = '对话';

    sidebarNav.appendChild(sep);
    sidebarNav.appendChild(label);

    workspaces.forEach(w => {
        const btn = document.createElement('button');
        btn.className = 'nav-item nav-workspace-item' + (w === current ? ' nav-item--active' : '');
        btn.textContent = (w === DEFAULT_WORKSPACE ? '📌 ' : '') + w;
        btn.dataset.workspace = w;
        btn.addEventListener('click', async () => {
            setCurrentWorkspace(w);
            const { switchWorkspace } = await import('./app.js');
            await switchWorkspace(w);
            document.getElementById('sidebar')?.classList.remove('open');
            document.getElementById('sidebar')?.classList.add('hidden');
        });
        sidebarNav.appendChild(btn);
    });

    const manageBtn = document.createElement('button');
    manageBtn.className = 'nav-item nav-item-workspace-manager';
    manageBtn.textContent = '对话管理';
    manageBtn.addEventListener('click', async () => {
        const { showWorkspaceManager } = await import('./workspaces.js');
        showWorkspaceManager();
    });
    sidebarNav.appendChild(manageBtn);
}

export async function showWorkspaceManager() {
    const { navigateTo } = await import('./ui.js');
    navigateTo('workspace-manager');
    const container = document.getElementById('workspace-manager-content');
    if (container) await renderWorkspaceManager(container);
}
