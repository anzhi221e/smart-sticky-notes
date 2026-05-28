import { readConfig, writeConfig } from './db.js';
import { showToast, navigateTo, applyTheme, getThemeNames, getThemeMeta } from './ui.js';
import { signOut } from './auth.js';

export async function showSettings() {
    navigateTo('settings');
    const content = document.getElementById('settings-content');
    if (!content) return;

    let cfg; try { cfg = await readConfig(); } catch { cfg = {}; }
    const themeNames = getThemeNames();
    const currentTheme = cfg.theme || 'blue-light';
    const dayThemes = ['pink-light','green-light','blue-light','day-multi'];
    const nightThemes = ['dark-blue','pure-black','pink-dark','night-multi'];

    content.innerHTML = `
        <div class="setting-group"><h3>同步</h3>
            <div class="setting-row"><label>本地文件夹路径</label>
                <input type="text" id="cfg-folder" value="${cfg.local_folder_path || ''}"><span class="setting-hint" id="cfg-folder-hint"></span></div>
            <div class="setting-row"><label>同步间隔 (分钟)</label>
                <input type="number" id="cfg-sync-interval" value="${cfg.sync_interval || 30}" min="5" max="1440"></div>
            <button id="cfg-sync-now" style="padding:10px 20px;background:var(--accent);color:#fff;border:none;border-radius:20px;cursor:pointer;font-size:14px;margin-top:8px;">立即同步</button>
            <span class="setting-hint" id="sync-status-hint">上次同步: ${cfg.last_sync_at ? new Date(cfg.last_sync_at).toLocaleString('zh-CN') : '从未'}</span>
        </div>
        <div class="setting-group"><h3>主题</h3>
            <div style="font-size:11px;color:var(--text-secondary);margin:8px 0 4px;">日间</div>
            <div class="theme-grid--day">
                ${dayThemes.map(name => {
                    const meta = getThemeMeta(name);
                    const sel = (currentTheme === name) ? 'selected' : '';
                    const label = name === 'pink-light' ? '粉白' : name === 'green-light' ? '绿白' : name === 'blue-light' ? '蓝白' : '多彩';
                    const isMulti = name === 'day-multi';
                    const bg = isMulti ? 'linear-gradient(135deg,#667eea,#f093fb,#f5576c,#4facfe,#43e97b)' : meta.accent;
                    const border = name.includes('light') || isMulti ? '#ddd' : '#444';
                    return `<div class="theme-swatch ${sel}" data-theme="${name}" style="background:${bg};border:2px solid ${border};">
                        <span class="theme-label" style="font-size:11px;font-weight:500;color:#fff;">${label}</span>
                    </div>`;
                }).join('')}
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin:12px 0 4px;">夜间</div>
            <div class="theme-grid--night">
                ${nightThemes.map(name => {
                    const meta = getThemeMeta(name);
                    const sel = (currentTheme === name) ? 'selected' : '';
                    const label = name === 'dark-blue' ? '暗蓝' : name === 'pure-black' ? '纯黑' : name === 'pink-dark' ? '灰粉' : '多彩';
                    const isMulti = name === 'night-multi';
                    const bg = isMulti ? 'linear-gradient(135deg,#667eea,#f093fb,#f5576c,#4facfe,#43e97b)' : meta.accent;
                    return `<div class="theme-swatch ${sel}" data-theme="${name}" style="background:${bg};border:2px solid #444;">
                        <span class="theme-label" style="font-size:11px;font-weight:500;color:#fff;">${label}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>
        <div class="setting-group"><h3>快捷语法按钮</h3>
            <p style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">选中文字后点击按钮，会在文字前后插入标记。如 [[ + 文字 + ]] = [[文字]]</p>
            <div id="toolbar-editor" style="display:flex;flex-direction:column;gap:6px;"></div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
                <input type="text" id="new-btn-label" placeholder="按钮名" style="width:60px;padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;">
                <input type="text" id="new-btn-before" placeholder="插入在前" style="flex:1;min-width:80px;padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;">
                <input type="text" id="new-btn-after" placeholder="插入在后" style="flex:1;min-width:80px;padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;">
                <button id="add-toolbar-btn" style="padding:8px 14px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;white-space:nowrap;">添加</button>
            </div>
            <button id="reset-toolbar-btn" style="margin-top:8px;padding:8px 16px;background:var(--surface);color:var(--text-secondary);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12px;">恢复默认</button>
        </div>
        <div class="setting-group"><h3>置顶标签</h3>
            <div class="setting-row"><input type="text" id="cfg-pinned-tags" value="${cfg.pinned_tags || '[]'}">
                <span class="setting-hint">JSON 数组，如 ["产品", "设计"]</span></div>
        </div>
        <div class="setting-group"><h3>偏好</h3>
            <div class="setting-row" style="flex-direction:row;align-items:center;justify-content:space-between;">
                <label>显示录音按钮</label>
                <span class="toggle-switch ${cfg.show_mic_button !== 'false' ? 'on' : ''}" id="cfg-show-mic" data-value="${cfg.show_mic_button !== 'false' ? 'true' : 'false'}"></span>
            </div>
            <div class="setting-row"><label>默认日历视图</label>
                <select id="cfg-calendar-view">
                    <option value="day" ${cfg.default_calendar_view === 'day' ? 'selected' : ''}>日</option>
                    <option value="week" ${cfg.default_calendar_view === 'week' ? 'selected' : ''}>周</option>
                    <option value="month" ${cfg.default_calendar_view === 'month' ? 'selected' : ''}>月</option>
                </select></div>
        </div>
        <div class="setting-group"><h3>账户</h3>
            <button id="copy-token-btn" style="padding:10px 20px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:20px;cursor:pointer;font-size:14px;margin-bottom:8px;display:block;">复制同步令牌</button>
            <button id="logout-btn" style="padding:10px 20px;background:var(--danger);color:#fff;border:none;border-radius:20px;cursor:pointer;font-size:14px;">退出登录</button>
        </div>
    `;

    // Theme swatches
    document.querySelectorAll('.theme-swatch').forEach(el => {
        el.addEventListener('click', async () => {
            const name = el.dataset.theme;
            applyTheme(name); await writeConfig('theme', name);
            document.querySelectorAll('.theme-swatch').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
            // Reload notes to apply new theme colors
            const app = await import('./app.js');
            if (app.loadNotes) app.loadNotes();
        });
    });

    // Save on change
    document.getElementById('cfg-folder').addEventListener('change', e => writeConfig('local_folder_path', e.target.value));
    document.getElementById('cfg-sync-interval').addEventListener('change', e => writeConfig('sync_interval', e.target.value));
    document.getElementById('cfg-pinned-tags').addEventListener('change', e => writeConfig('pinned_tags', e.target.value));
    document.getElementById('cfg-calendar-view').addEventListener('change', e => writeConfig('default_calendar_view', e.target.value));
    document.getElementById('cfg-show-mic').addEventListener('click', function() {
        const cur = this.dataset.value === 'true';
        const next = !cur;
        this.dataset.value = next ? 'true' : 'false';
        this.classList.toggle('on', next);
        writeConfig('show_mic_button', next ? 'true' : 'false');
        document.getElementById('mic-btn').style.display = next ? '' : 'none';
    });

    // Manual sync
    document.getElementById('cfg-sync-now').addEventListener('click', async () => {
        const { getSupabase } = await import('./supabase.js');
        await getSupabase().from('sync_requests').insert({ status: 'pending' });
        document.getElementById('sync-status-hint').textContent = '已请求同步 · 等待 PC 响应';
        showToast('已发送同步请求');
    });

    // Copy token
    document.getElementById('copy-token-btn').addEventListener('click', async () => {
        const { getSupabase } = await import('./supabase.js');
        const { data, error } = await getSupabase().auth.refreshSession();
        if (data.session) {
            await navigator.clipboard.writeText(data.session.refresh_token);
            showToast('新令牌已复制');
        } else showToast('请重新登录');
    });

    // --- Toolbar editor ---
    const DEFAULT_BUTTONS = [
        {label:'#',before:'# ',after:''}, {label:'##',before:'## ',after:''},
        {label:'###',before:'### ',after:''}, {label:'::',before:'::',after:''},
        {label:'>',before:'> ',after:''}, {label:'!',before:'> [!note]\n> ',after:''},
    ];
    let toolbarButtons = JSON.parse(cfg.toolbar_buttons || 'null') || [...DEFAULT_BUTTONS];

    function renderToolbarEditor() {
        const editor = document.getElementById('toolbar-editor');
        if (!editor) return;
        editor.innerHTML = '';
        toolbarButtons.forEach((btn, i) => {
            row.style.cssText = 'display:flex;gap:4px;align-items:center;overflow-x:auto;';
            row.innerHTML = `
                <button class="tb-move-btn" data-dir="up" data-idx="${i}" ${i===0?'disabled':''} style="flex-shrink:0;background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:14px;padding:2px 4px;">▲</button>
                <button class="tb-move-btn" data-dir="down" data-idx="${i}" ${i===toolbarButtons.length-1?'disabled':''} style="flex-shrink:0;background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:14px;padding:2px 4px;">▼</button>
                <span style="flex-shrink:0;background:var(--surface);border:1px solid var(--border);padding:4px 8px;border-radius:6px;font-size:12px;min-width:28px;text-align:center;">${btn.label}</span>
                <code style="flex-shrink:0;font-size:10px;color:var(--text-secondary);">${btn.before}<i>…</i>${btn.after}</code>
                <button class="tb-del-btn" data-idx="${i}" style="flex-shrink:0;background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:14px;padding:2px 4px;">✕</button>
            `;
            editor.appendChild(row);
        });

        editor.querySelectorAll('.tb-move-btn').forEach(b => {
            b.addEventListener('click', () => {
                const idx = parseInt(b.dataset.idx);
                const dir = b.dataset.dir;
                if (dir === 'up' && idx > 0) {
                    [toolbarButtons[idx-1], toolbarButtons[idx]] = [toolbarButtons[idx], toolbarButtons[idx-1]];
                } else if (dir === 'down' && idx < toolbarButtons.length - 1) {
                    [toolbarButtons[idx], toolbarButtons[idx+1]] = [toolbarButtons[idx+1], toolbarButtons[idx]];
                }
                writeConfig('toolbar_buttons', JSON.stringify(toolbarButtons));
                renderToolbarEditor();
            });
        });
        editor.querySelectorAll('.tb-del-btn').forEach(b => {
            b.addEventListener('click', () => {
                toolbarButtons.splice(parseInt(b.dataset.idx), 1);
                writeConfig('toolbar_buttons', JSON.stringify(toolbarButtons));
                renderToolbarEditor();
            });
        });
    }

    renderToolbarEditor();

    document.getElementById('add-toolbar-btn').addEventListener('click', () => {
        const label = document.getElementById('new-btn-label').value.trim();
        const before = document.getElementById('new-btn-before').value;
        const after = document.getElementById('new-btn-after').value;
        if (!label) return;
        toolbarButtons.push({label, before, after});
        writeConfig('toolbar_buttons', JSON.stringify(toolbarButtons));
        renderToolbarEditor();
        document.getElementById('new-btn-label').value = '';
        document.getElementById('new-btn-before').value = '';
        document.getElementById('new-btn-after').value = '';
    });

    document.getElementById('reset-toolbar-btn').addEventListener('click', () => {
        toolbarButtons = [...DEFAULT_BUTTONS];
        writeConfig('toolbar_buttons', JSON.stringify(toolbarButtons));
        renderToolbarEditor();
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await signOut();
        const { navigateTo } = await import('./ui.js');
        navigateTo('auth');
    });
}
