import { writeConfig } from './db.js';
import { navigateTo } from './ui.js';

const SQL_SNIPPET = `-- Copy and paste this into Supabase SQL Editor
-- https://app.supabase.com/project/_/sql

CREATE TABLE smartstickynotes_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    type text NOT NULL CHECK (type IN ('voice', 'text')),
    text text NOT NULL DEFAULT '',
    tags text[] NOT NULL DEFAULT '{}',
    workspace text NOT NULL DEFAULT 'Main',
    audio_path text,
    audio_duration integer,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    synced_at timestamptz
);

CREATE TABLE deletion_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    note_id uuid NOT NULL,
    audio_path text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE smartstickynotes_config (
    user_id uuid NOT NULL DEFAULT auth.uid(),
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);

ALTER TABLE smartstickynotes_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "items_select" ON smartstickynotes_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "items_insert" ON smartstickynotes_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "items_update" ON smartstickynotes_items FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "items_delete" ON smartstickynotes_items FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE deletion_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deletion_select" ON deletion_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "deletion_insert" ON deletion_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "deletion_delete" ON deletion_events FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE smartstickynotes_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "config_select" ON smartstickynotes_config FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "config_insert" ON smartstickynotes_config FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "config_update" ON smartstickynotes_config FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE smartstickynotes_items ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE deletion_events ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE smartstickynotes_config ALTER COLUMN user_id SET DEFAULT auth.uid();

CREATE INDEX idx_items_user_status ON smartstickynotes_items(user_id, status);
CREATE INDEX idx_items_user_synced ON smartstickynotes_items(user_id, synced_at);
CREATE INDEX idx_items_user_updated ON smartstickynotes_items(user_id, updated_at);
CREATE INDEX idx_items_user_workspace ON smartstickynotes_items(user_id, workspace, status);
CREATE INDEX idx_items_tags ON smartstickynotes_items USING gin(tags);
CREATE INDEX idx_deletion_user ON deletion_events(user_id);

-- ★ 已有数据库迁移（如果你已经创建过表，单独执行这两条）：
-- ALTER TABLE smartstickynotes_items ADD COLUMN IF NOT EXISTS workspace text NOT NULL DEFAULT 'Main';
-- CREATE INDEX IF NOT EXISTS idx_items_user_workspace ON smartstickynotes_items(user_id, workspace, status);
-- ★ 如果你已经迁移过（默认值是 '默认'），还需要执行：
-- UPDATE smartstickynotes_items SET workspace = 'Main' WHERE workspace = '默认';

-- Then create Storage bucket "smartstickynotes_audio"
-- via Supabase Dashboard -> Storage -> New Bucket
-- Set it as private, then add RLS policies for SELECT/INSERT/DELETE

-- ====== v2 Migration: sync_requests ======

CREATE TABLE sync_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    requested_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'timeout')),
    processing_started_at timestamptz,
    completed_at timestamptz,
    error_message text,
    client_id text
);

ALTER TABLE sync_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_requests_select" ON sync_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "sync_requests_insert" ON sync_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sync_requests_update" ON sync_requests FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sync_requests_delete" ON sync_requests FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE sync_requests ALTER COLUMN user_id SET DEFAULT auth.uid();

ALTER TABLE smartstickynotes_items DROP COLUMN IF EXISTS synced_at;

DROP TABLE IF EXISTS deletion_events;`.trim();

export function renderWizard(step = 1) {
    const container = document.getElementById('wizard-steps');
    if (!container) return;
    container.innerHTML = '';

    if (step === 1) {
        container.innerHTML = `
            <h2>设置笔记文件夹</h2>
            <p class="subtitle">笔记最终会以 Markdown 文件存到这个文件夹<br>PC 同步脚本需要访问此路径</p>
            <input type="text" id="wiz-folder" class="wizard-input" placeholder="例如: D:/OneDrive/Notes" value="D:/OneDrive/Notes">
            <button id="wiz-step1-next" class="wizard-btn" style="margin-top:16px;">下一步</button>
        `;
        document.getElementById('wiz-step1-next').addEventListener('click', async () => {
            const folder = document.getElementById('wiz-folder').value.trim();
            if (!folder) return;
            await writeConfig('local_folder_path', folder);
            await writeConfig('filename_template', '{date}_{time}_{type}_{id}');
            await writeConfig('default_calendar_view', 'month');
            renderWizard(2);
        });
    } else if (step === 2) {
        container.innerHTML = `
            <h2>初始化数据库</h2>
            <p class="subtitle">复制以下 SQL，在 Supabase SQL Editor 中粘贴执行</p>
            <textarea readonly style="width:100%;height:200px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:12px;font-family:monospace;font-size:12px;resize:none;">${SQL_SNIPPET}</textarea>
            <button id="copy-sql" class="wizard-btn" style="margin-top:8px;background:var(--surface);color:var(--text);border:1px solid var(--border);">复制 SQL</button>
            <p style="margin-top:12px;font-size:13px;color:var(--text-secondary);">
                前往 <a href="https://app.supabase.com" target="_blank" style="color:var(--accent);">Supabase Dashboard</a> → SQL Editor → 粘贴执行
            </p>
            <button id="wiz-step2-next" class="wizard-btn" style="margin-top:16px;">已完成，下一步</button>
        `;
        document.getElementById('copy-sql').addEventListener('click', () => {
            navigator.clipboard.writeText(SQL_SNIPPET);
            document.getElementById('copy-sql').textContent = '已复制';
        });
        document.getElementById('wiz-step2-next').addEventListener('click', () => renderWizard(3));
    } else if (step === 3) {
        container.innerHTML = `
            <h2>下载 PC 同步脚本</h2>
            <p class="subtitle">同步脚本在后台运行，自动将笔记同步到本地文件夹</p>
            <div style="text-align:left;margin-top:16px;font-size:14px;color:var(--text-secondary);line-height:1.8;">
                <p>1. 将项目 <code>sync/</code> 文件夹复制到你的电脑</p>
                <p>2. 安装 Python 依赖: <code>pip install -r requirements.txt</code></p>
                <p>3. 设置环境变量后运行:</p>
                <pre style="background:var(--bg);padding:8px;border-radius:6px;margin:4px 0;font-size:12px;">SUPABASE_URL=你的URL SUPABASE_SERVICE_ROLE_KEY=你的KEY python main.py</pre>
                <p>4. 脚本将打开浏览器完成登录，之后自动作为后台服务运行</p>
            </div>
            <button id="wiz-done" class="wizard-btn" style="margin-top:24px;">完成设置，开始使用</button>
        `;
        document.getElementById('wiz-done').addEventListener('click', () => {
            navigateTo('main');
            import('./app.js').then(m => m.loadNotes());
        });
    }
}
