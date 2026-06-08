const RICH_ACTIONS = {
    bold:          { before: '**', after: '**', placeholder: '粗体文字' },
    italic:        { before: '*', after: '*', placeholder: '斜体文字' },
    underline:     { before: '<u>', after: '</u>', placeholder: '下划线文字' },
    strikethrough: { before: '~~', after: '~~', placeholder: '删除线文字' },
    bullet:        { before: '\n- ', after: '', placeholder: '列表项' },
    numbered:      { before: '\n1. ', after: '', placeholder: '列表项' },
};

const DEFAULT_SYNTAX = [
    {label:'#',before:'# ',after:''}, {label:'##',before:'## ',after:''},
    {label:'###',before:'### ',after:''}, {label:'::',before:'::',after:''},
    {label:'>',before:'> ',after:''}, {label:'!',before:'> [!note]\n> ',after:''},
];

let _targetInput = null;

export function setToolbarTarget(inputEl) {
    _targetInput = inputEl;
}

export function initToolbar() {
    // Rich text buttons (fixed)
    document.querySelectorAll('.tb-btn[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const def = RICH_ACTIONS[action];
            if (!def || !_targetInput) return;
            insertMarkdown(def);
        });
    });
    // Syntax buttons are rendered dynamically
    renderSyntaxButtons();
}

export async function renderSyntaxButtons() {
    const container = document.getElementById('syntax-buttons');
    if (!container) return;
    let buttons = DEFAULT_SYNTAX;
    try {
        const { readConfig } = await import('./db.js');
        const cfg = await readConfig().catch(() => ({}));
        if (cfg.toolbar_buttons) buttons = JSON.parse(cfg.toolbar_buttons);
    } catch (e) { /* use defaults */ }

    container.innerHTML = '';
    buttons.forEach(btn => {
        const el = document.createElement('button');
        el.className = 'tb-btn';
        el.textContent = btn.label;
        el.title = btn.before + '…' + btn.after;
        el.addEventListener('click', () => {
            if (!_targetInput) return;
            insertMarkdown({ before: btn.before, after: btn.after, placeholder: '' });
        });
        container.appendChild(el);
    });
}

function insertMarkdown(def) {
    const el = _targetInput;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const selected = el.value.substring(start, end) || def.placeholder;
    const text = def.before + selected + def.after;
    el.value = el.value.substring(0, start) + text + el.value.substring(end);
    el.focus();
    const newPos = start + text.length;
    el.setSelectionRange(newPos, newPos);
    el.dispatchEvent(new Event('input'));
}

export function showToolbar() {
    document.getElementById('toolbar')?.classList.remove('hidden');
}

export function hideToolbar() {
    document.getElementById('toolbar')?.classList.add('hidden');
}

export function renderTagBar(tags, pinnedTags = []) {
    const bar = document.getElementById('tag-quick-bar');
    if (!bar) return;
    bar.innerHTML = '';
    const validPinned = pinnedTags.filter(t => tags.includes(t));
    const sorted = [...validPinned, ...tags.filter(t => !validPinned.includes(t))];
    sorted.slice(0, 12).forEach(tag => {
        const pill = document.createElement('button');
        pill.className = 'tag-pill';
        pill.textContent = '#' + tag;
        pill.addEventListener('click', () => {
            if (!_targetInput) return;
            const el = _targetInput;
            const pos = el.selectionStart || 0;
            const insert = '#' + tag + ' ';
            el.value = el.value.substring(0, pos) + insert + el.value.substring(pos);
            el.focus();
            el.setSelectionRange(pos + insert.length, pos + insert.length);
        });
        bar.appendChild(pill);
    });
}

// --- Quick phrases (per-workspace) ---

async function getQuickPhrases() {
    const { readConfig } = await import('./db.js');
    const { getCurrentWorkspace } = await import('./workspaces.js');
    const cfg = await readConfig().catch(() => ({}));
    const all = JSON.parse(cfg.quick_phrases || '{}');
    const ws = getCurrentWorkspace();
    return { all, ws, phrases: all[ws] || [] };
}

async function saveQuickPhrases(phrases) {
    const { writeConfig } = await import('./db.js');
    const { all, ws } = await getQuickPhrases();
    if (phrases.length === 0) {
        delete all[ws];
    } else {
        all[ws] = phrases;
    }
    await writeConfig('quick_phrases', JSON.stringify(all));
}

export async function renderQuickPhraseBar() {
    const bar = document.getElementById('quick-phrase-bar');
    if (!bar) return;
    bar.innerHTML = '';
    const { phrases } = await getQuickPhrases();
    phrases.forEach(phrase => {
        const btn = document.createElement('button');
        btn.className = 'quick-phrase-btn';
        btn.textContent = phrase;
        btn.addEventListener('click', () => {
            if (!_targetInput) return;
            const el = _targetInput;
            const pos = el.selectionStart || 0;
            el.value = el.value.substring(0, pos) + phrase + el.value.substring(pos);
            el.focus();
            const newPos = pos + phrase.length;
            el.setSelectionRange(newPos, newPos);
        });
        bar.appendChild(btn);
    });
    const editBtn = document.createElement('button');
    editBtn.className = 'quick-phrase-edit-btn';
    editBtn.textContent = phrases.length ? '编辑' : '+ 添加快捷语';
    editBtn.addEventListener('click', () => showQuickPhraseEditor());
    bar.appendChild(editBtn);
}

export function showQuickPhraseEditor() {
    const existing = document.querySelector('.quick-phrase-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'quick-phrase-modal';

    getQuickPhrases().then(({ phrases, ws }) => {
        overlay.innerHTML = `
            <div class="quick-phrase-modal-inner">
                <div class="quick-phrase-modal-title">编辑快捷语</div>
                <div class="quick-phrase-modal-subtitle">工作区：${ws.replace(/</g,'&lt;').replace(/>/g,'&gt;')}（最多 20 条）</div>
                <div class="quick-phrase-list" id="qp-list"></div>
                <div class="quick-phrase-add-row">
                    <input class="quick-phrase-add-input" id="qp-add-input" placeholder="输入新的快捷语..." maxlength="60" autocomplete="off">
                    <button class="quick-phrase-add-btn" id="qp-add-btn">添加</button>
                </div>
                <button class="quick-phrase-modal-close" id="qp-close-btn">完成</button>
            </div>
        `;
        document.body.appendChild(overlay);

        const list = overlay.querySelector('#qp-list');

        function renderList(items) {
            list.innerHTML = '';
            if (items.length === 0) {
                list.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:13px;padding:16px;">还没有快捷语，用下方输入框添加</div>';
                return;
            }
            items.forEach((phrase, i) => {
                const item = document.createElement('div');
                item.className = 'quick-phrase-item';
                item.innerHTML = `
                    <span class="quick-phrase-item-text">${phrase.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>
                    <button class="quick-phrase-item-edit" data-index="${i}">编辑</button>
                    <button class="quick-phrase-item-del" data-index="${i}">删除</button>
                `;
                item.querySelector('.quick-phrase-item-del').addEventListener('click', async () => {
                    const { phrases: current } = await getQuickPhrases();
                    current.splice(i, 1);
                    await saveQuickPhrases(current);
                    renderList(current);
                    renderQuickPhraseBar();
                });
                item.querySelector('.quick-phrase-item-edit').addEventListener('click', () => {
                    startInlineEdit(item, phrase, i);
                });
                list.appendChild(item);
            });
        }

        function startInlineEdit(item, oldPhrase, index) {
            const textSpan = item.querySelector('.quick-phrase-item-text');
            const editBtn = item.querySelector('.quick-phrase-item-edit');
            const delBtn = item.querySelector('.quick-phrase-item-del');

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'quick-phrase-inline-input';
            input.value = oldPhrase;
            input.maxLength = 60;

            const saveBtn = document.createElement('button');
            saveBtn.className = 'quick-phrase-inline-save';
            saveBtn.textContent = '保存';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'quick-phrase-inline-cancel';
            cancelBtn.textContent = '取消';

            textSpan.replaceWith(input);
            editBtn.replaceWith(saveBtn);
            delBtn.replaceWith(cancelBtn);
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);

            async function doSave() {
                const val = input.value.trim();
                if (!val || val === oldPhrase) { doCancel(); return; }
                const { phrases: current } = await getQuickPhrases();
                if (current.includes(val) && val !== oldPhrase) {
                    const { showToast } = await import('./ui.js');
                    showToast('快捷语已存在');
                    return;
                }
                current[index] = val;
                await saveQuickPhrases(current);
                renderList(current);
                renderQuickPhraseBar();
            }

            function doCancel() {
                renderList(/* will be refetched */ undefined);
                // Re-render from saved state
                getQuickPhrases().then(({ phrases: current }) => {
                    renderList(current);
                });
            }

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') doSave();
                else if (e.key === 'Escape') doCancel();
            });
            saveBtn.addEventListener('click', doSave);
            cancelBtn.addEventListener('click', doCancel);
        }

        renderList(phrases);

        overlay.querySelector('#qp-add-btn').addEventListener('click', async () => {
            const input = overlay.querySelector('#qp-add-input');
            const val = input.value.trim();
            if (!val) return;
            const { phrases: current } = await getQuickPhrases();
            if (current.length >= 20) {
                const { showToast } = await import('./ui.js');
                showToast('最多 20 条快捷语');
                return;
            }
            if (current.includes(val)) {
                const { showToast } = await import('./ui.js');
                showToast('快捷语已存在');
                return;
            }
            current.push(val);
            await saveQuickPhrases(current);
            input.value = '';
            renderList(current);
            renderQuickPhraseBar();
        });

        overlay.querySelector('#qp-add-input').addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') overlay.querySelector('#qp-add-btn').click();
        });

        overlay.querySelector('#qp-close-btn').addEventListener('click', () => overlay.remove());
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
}
