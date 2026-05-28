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
            <div class="theme-grid" id="theme-grid-day">
                ${dayThemes.map(name => {
                    const meta = getThemeMeta(name);
                    const sel = (currentTheme === name) ? 'selected' : '';
                    const label = name === 'pink-light' ? '粉白' : name === 'green-light' ? '绿白' : name === 'blue-light' ? '蓝白' : '多彩';
                    return `<div class="theme-swatch ${sel}" data-theme="${name}" style="background:${meta.bg};border:2px solid ${meta.accent};">
                        <span class="theme-label" style="font-size:11px;font-weight:500;color:${meta.text};">${label}</span>
                    </div>`;
                }).join('')}
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin:12px 0 4px;">夜间</div>
            <div class="theme-grid" id="theme-grid-night">
                ${nightThemes.map(name => {
                    const meta = getThemeMeta(name);
                    const sel = (currentTheme === name) ? 'selected' : '';
                    const label = name === 'dark-blue' ? '暗蓝' : name === 'pure-black' ? '纯黑' : name === 'pink-dark' ? '灰粉' : '多彩';
                    return `<div class="theme-swatch ${sel}" data-theme="${name}" style="background:${meta.bg};border:2px solid ${meta.accent};">
                        <span class="theme-label" style="font-size:11px;font-weight:500;color:${meta.text};">${label}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>
        <div class="setting-group"><h3>置顶标签</h3>
            <div class="setting-row"><input type="text" id="cfg-pinned-tags" value="${cfg.pinned_tags || '[]'}">
                <span class="setting-hint">JSON 数组，如 ["产品", "设计"]</span></div>
        </div>
        <div class="setting-group"><h3>偏好</h3>
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

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await signOut();
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('screen-auth').classList.add('active');
    });
}
