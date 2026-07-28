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

function enableQuickPhraseWheelScroll() {
    const bar = document.getElementById('quick-phrase-bar');
    if (!bar || bar.dataset.wheelScrollEnabled === 'true') return;
    bar.dataset.wheelScrollEnabled = 'true';
    bar.addEventListener('wheel', e => {
        if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
        const maxScrollLeft = Math.max(0, bar.scrollWidth - bar.clientWidth);
        if (maxScrollLeft === 0) return;

        const multiplier = e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? bar.clientWidth : 1;
        const nextScrollLeft = Math.max(
            0,
            Math.min(maxScrollLeft, bar.scrollLeft + e.deltaY * multiplier),
        );
        if (Math.abs(nextScrollLeft - bar.scrollLeft) < 0.5) return;

        bar.scrollLeft = nextScrollLeft;
        e.preventDefault();
    }, { passive: false });
}

export function initToolbar() {
    enableQuickPhraseWheelScroll();
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
    sorted.forEach(tag => {
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

// --- Quick phrases (per-workspace, grouped) ---

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function makeQuickPhraseId(prefix = 'qp') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeQuickPhraseData(value) {
    if (Array.isArray(value)) {
        return {
            version: 2,
            groups: value.length ? [{ id: 'default', name: 'Default', phrases: [...value], recent: [] }] : [],
            ungrouped: [],
        };
    }
    if (!value || typeof value !== 'object') return { version: 2, groups: [], ungrouped: [] };
    const groups = Array.isArray(value.groups) ? value.groups.map((group, index) => ({
        id: group.id || makeQuickPhraseId('group'),
        name: String(group.name || `Group ${index + 1}`),
        phrases: Array.isArray(group.phrases) ? group.phrases.filter(Boolean).map(String) : [],
        recent: Array.isArray(group.recent) ? group.recent.filter(Boolean).map(String).slice(0, 3) : [],
    })).filter(group => group.phrases.length || group.name.trim()) : [];
    const ungrouped = Array.isArray(value.ungrouped) ? value.ungrouped.filter(Boolean).map(String) : [];
    return { version: 2, groups, ungrouped };
}

async function getQuickPhrases() {
    const { readConfig } = await import('./db.js');
    const { getCurrentWorkspace } = await import('./workspaces.js');
    const cfg = await readConfig().catch(() => ({}));
    const all = JSON.parse(cfg.quick_phrases || '{}');
    const ws = getCurrentWorkspace();
    const data = normalizeQuickPhraseData(all[ws]);
    return { all, ws, data };
}

async function saveQuickPhraseData(data) {
    const { writeConfig } = await import('./db.js');
    const { all, ws } = await getQuickPhrases();
    const cleaned = normalizeQuickPhraseData(data);
    if (!cleaned.groups.length && !cleaned.ungrouped.length) delete all[ws];
    else all[ws] = cleaned;
    await writeConfig('quick_phrases', JSON.stringify(all));
}

function insertPhrase(phrase) {
    if (!_targetInput || !phrase) return;
    const el = _targetInput;
    const pos = el.selectionStart || 0;
    el.value = el.value.substring(0, pos) + phrase + el.value.substring(pos);
    el.focus();
    const newPos = pos + phrase.length;
    el.setSelectionRange(newPos, newPos);
    el.dispatchEvent(new Event('input'));
}

async function rememberPhraseUse(groupId, phrase) {
    const { data } = await getQuickPhrases();
    const group = data.groups.find(g => g.id === groupId);
    if (!group) return;
    group.recent = [phrase, ...(group.recent || []).filter(p => p !== phrase)].slice(0, 3);
    await saveQuickPhraseData(data);
    renderQuickPhraseBar();
}

function getGroupDefaultPhrase(group) {
    const recent = (group.recent || []).find(p => group.phrases.includes(p));
    return recent || group.phrases[group.phrases.length - 1] || group.name;
}

let _quickPhraseRenderVersion = 0;

export async function renderQuickPhraseBar() {
    const bar = document.getElementById('quick-phrase-bar');
    if (!bar) return;
    const renderVersion = ++_quickPhraseRenderVersion;
    const previousScrollLeft = bar.scrollLeft;
    const { data } = await getQuickPhrases();
    if (renderVersion !== _quickPhraseRenderVersion) return;
    const content = document.createDocumentFragment();

    data.groups.filter(group => group.phrases.length).forEach(group => {
        const chip = document.createElement('span');
        chip.className = 'quick-phrase-group-chip';

        const main = document.createElement('button');
        main.className = 'quick-phrase-group-main';
        main.textContent = getGroupDefaultPhrase(group);
        main.title = `${group.name}: ${group.phrases.join(' / ')}`;
        main.addEventListener('click', async () => {
            const phrase = getGroupDefaultPhrase(group);
            insertPhrase(phrase);
            await rememberPhraseUse(group.id, phrase);
        });

        const arrow = document.createElement('button');
        arrow.className = 'quick-phrase-group-arrow';
        arrow.textContent = '▾';
        arrow.setAttribute('aria-label', `${group.name} options`);
        arrow.addEventListener('click', (e) => {
            e.stopPropagation();
            showQuickPhraseGroupSheet(group);
        });

        chip.append(main, arrow);
        content.appendChild(chip);
    });

    data.ungrouped.forEach(phrase => {
        const btn = document.createElement('button');
        btn.className = 'quick-phrase-btn';
        btn.textContent = phrase;
        btn.addEventListener('click', () => insertPhrase(phrase));
        content.appendChild(btn);
    });

    const editBtn = document.createElement('button');
    editBtn.className = 'quick-phrase-edit-btn';
    editBtn.textContent = data.groups.length || data.ungrouped.length ? '编辑' : '+ 添加快捷语';
    editBtn.addEventListener('click', () => showQuickPhraseEditor());
    content.appendChild(editBtn);

    bar.replaceChildren(content);
    bar.scrollLeft = previousScrollLeft;
}

function showQuickPhraseGroupSheet(group) {
    document.querySelectorAll('.quick-phrase-sheet').forEach(el => el.remove());
    const sheet = document.createElement('div');
    sheet.className = 'quick-phrase-sheet';
    const recent = (group.recent || []).filter(p => group.phrases.includes(p)).slice(0, 3);
    sheet.innerHTML = `
        <div class="quick-phrase-sheet-inner">
            <div class="quick-phrase-sheet-title">${esc(group.name)}</div>
            <div class="quick-phrase-sheet-list">
                ${group.phrases.map(phrase => `<button class="quick-phrase-sheet-item" data-phrase="${esc(phrase)}">${esc(phrase)}</button>`).join('')}
            </div>
            ${recent.length ? `<div class="quick-phrase-sheet-recent">
                ${recent.map(phrase => `<button class="quick-phrase-sheet-item quick-phrase-sheet-item--recent" data-phrase="${esc(phrase)}">${esc(phrase)}</button>`).join('')}
            </div>` : ''}
            <button class="quick-phrase-sheet-close" data-action="close">关闭</button>
        </div>
    `;
    sheet.querySelectorAll('[data-phrase]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const phrase = btn.dataset.phrase;
            insertPhrase(phrase);
            await rememberPhraseUse(group.id, phrase);
            sheet.remove();
        });
    });
    sheet.querySelector('[data-action="close"]').addEventListener('click', () => sheet.remove());
    document.body.appendChild(sheet);
}

function quickPhraseIcon(name) {
    const icons = {
        edit: '<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>',
        trash: '<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>',
        drag: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="7" x2="19" y2="7"></line><line x1="5" y1="12" x2="19" y2="12"></line><line x1="5" y1="17" x2="19" y2="17"></line></svg>',
        chevron: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>',
    };
    return icons[name] || '';
}

export function showQuickPhraseEditor() {
    const existing = document.querySelector('.quick-phrase-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'quick-phrase-modal';

    getQuickPhrases().then(({ data, ws }) => {
        overlay.innerHTML = `
            <div class="quick-phrase-modal-inner quick-phrase-modal-inner--wide">
                <div class="quick-phrase-modal-title">编辑快捷语</div>
                <div class="quick-phrase-modal-subtitle">工作区：${esc(ws)}。长按右侧三横线拖动快捷语到其他分组。</div>
                <div class="quick-phrase-list quick-phrase-list--groups" id="qp-list"></div>
                <div class="quick-phrase-add-row quick-phrase-add-row--group">
                    <input class="quick-phrase-add-input" id="qp-group-input" placeholder="新分组名..." maxlength="40" autocomplete="off">
                    <button class="quick-phrase-add-btn" id="qp-group-add-btn">添加分组</button>
                </div>
                <button class="quick-phrase-modal-close" id="qp-close-btn">完成</button>
            </div>
        `;
        document.body.appendChild(overlay);

        const list = overlay.querySelector('#qp-list');
        const collapsedGroups = new Set();
        let dragState = null;

        async function persist(nextData = data) {
            await saveQuickPhraseData(nextData);
            renderQuickPhraseBar();
        }

        function renderList() {
            list.innerHTML = '';
            if (!data.groups.length) {
                list.innerHTML = '<div class="quick-phrase-empty">还没有分组，先添加一个分组。</div>';
                return;
            }
            data.groups.forEach(group => {
                const card = document.createElement('div');
                card.className = `quick-phrase-group-card${collapsedGroups.has(group.id) ? ' is-collapsed' : ''}`;
                card.dataset.groupId = group.id;
                card.innerHTML = `
                    <div class="quick-phrase-group-header">
                        <button class="quick-phrase-group-toggle" data-action="toggle-group" aria-label="展开或折叠分组">${quickPhraseIcon('chevron')}</button>
                        <input class="quick-phrase-group-name" value="${esc(group.name)}" maxlength="40" aria-label="编辑分组名">
                        <span class="quick-phrase-group-count">${group.phrases.length}</span>
                        <span class="quick-phrase-group-name-edit" aria-hidden="true">${quickPhraseIcon('edit')}</span>
                        <button class="quick-phrase-icon-btn quick-phrase-icon-btn--delete" data-action="delete-group" aria-label="删除分组">${quickPhraseIcon('trash')}</button>
                    </div>
                    <div class="quick-phrase-group-phrases"></div>
                    <div class="quick-phrase-add-row">
                        <input class="quick-phrase-add-input" data-role="phrase-input" placeholder="添加到 ${esc(group.name)}..." maxlength="80" autocomplete="off">
                        <button class="quick-phrase-add-btn" data-action="add-phrase">添加</button>
                    </div>
                `;
                const phraseList = card.querySelector('.quick-phrase-group-phrases');
                group.phrases.forEach((phrase, index) => {
                    const item = document.createElement('div');
                    item.className = 'quick-phrase-item';
                    item.dataset.phrase = phrase;
                    item.innerHTML = `
                        <span class="quick-phrase-item-text">${esc(phrase)}</span>
                        <button class="quick-phrase-icon-btn" data-action="edit-phrase" aria-label="编辑快捷语">${quickPhraseIcon('edit')}</button>
                        <button class="quick-phrase-icon-btn quick-phrase-icon-btn--delete" data-action="delete-phrase" aria-label="删除快捷语">${quickPhraseIcon('trash')}</button>
                        <button class="quick-phrase-drag-handle" data-action="move-phrase" aria-label="拖动快捷语">${quickPhraseIcon('drag')}</button>
                    `;
                    addDragHandlers(item.querySelector('[data-action="move-phrase"]'), group.id, index);
                    item.querySelector('[data-action="edit-phrase"]').addEventListener('click', () => startInlinePhraseEdit(item, group, index));
                    item.querySelector('[data-action="delete-phrase"]').addEventListener('click', async () => {
                        const removed = group.phrases.splice(index, 1)[0];
                        group.recent = (group.recent || []).filter(p => p !== removed);
                        await persist();
                        renderList();
                    });
                    phraseList.appendChild(item);
                });

                card.querySelector('[data-action="toggle-group"]').addEventListener('click', () => {
                    if (collapsedGroups.has(group.id)) collapsedGroups.delete(group.id);
                    else collapsedGroups.add(group.id);
                    renderList();
                });
                card.querySelector('.quick-phrase-group-name').addEventListener('change', async e => {
                    group.name = e.target.value.trim() || group.name;
                    await persist();
                    renderList();
                });
                card.querySelector('[data-action="delete-group"]').addEventListener('click', async () => {
                    data.ungrouped.push(...group.phrases);
                    data.groups = data.groups.filter(g => g.id !== group.id);
                    collapsedGroups.delete(group.id);
                    await persist();
                    renderList();
                });
                card.querySelector('[data-action="add-phrase"]').addEventListener('click', async () => {
                    const input = card.querySelector('[data-role="phrase-input"]');
                    const val = input.value.trim();
                    if (!val || group.phrases.includes(val)) return;
                    group.phrases.push(val);
                    input.value = '';
                    await persist();
                    renderList();
                });
                card.querySelector('[data-role="phrase-input"]').addEventListener('keydown', e => {
                    if (e.key === 'Enter') card.querySelector('[data-action="add-phrase"]').click();
                });
                list.appendChild(card);
            });
        }

        function startInlinePhraseEdit(item, group, index) {
            const oldPhrase = group.phrases[index];
            item.innerHTML = `
                <input class="quick-phrase-inline-input" value="${esc(oldPhrase)}" maxlength="80">
                <button class="quick-phrase-inline-save">保存</button>
                <button class="quick-phrase-inline-cancel">取消</button>
            `;
            const input = item.querySelector('input');
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
            item.querySelector('.quick-phrase-inline-save').addEventListener('click', async () => {
                const val = input.value.trim();
                if (val && !group.phrases.includes(val)) {
                    group.phrases[index] = val;
                    group.recent = (group.recent || []).map(p => p === oldPhrase ? val : p);
                    await persist();
                }
                renderList();
            });
            item.querySelector('.quick-phrase-inline-cancel').addEventListener('click', renderList);
        }

        function addDragHandlers(handle, groupId, phraseIndex) {
            let timer = null;
            handle.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handle.setPointerCapture?.(e.pointerId);
                timer = setTimeout(() => startPhraseDrag(e, handle, groupId, phraseIndex), 420);
            });
            handle.addEventListener('pointermove', (e) => {
                if (dragState) updatePhraseDrag(e);
            });
            handle.addEventListener('pointerup', async (e) => {
                clearTimeout(timer);
                if (dragState) await finishPhraseDrag(e);
            });
            handle.addEventListener('pointercancel', () => {
                clearTimeout(timer);
                cancelPhraseDrag();
            });
            handle.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
            });
        }

        function startPhraseDrag(e, handle, groupId, phraseIndex) {
            const sourceGroup = data.groups.find(g => g.id === groupId);
            const phrase = sourceGroup?.phrases[phraseIndex];
            const item = handle.closest('.quick-phrase-item');
            if (!sourceGroup || !phrase || !item) return;

            const rect = item.getBoundingClientRect();
            const ghost = item.cloneNode(true);
            ghost.classList.add('quick-phrase-drag-ghost');
            ghost.style.width = `${rect.width}px`;
            document.body.appendChild(ghost);
            item.classList.add('is-dragging');
            dragState = { sourceGroup, groupId, phraseIndex, phrase, item, ghost, targetGroupId: null };
            updatePhraseDrag(e);
        }

        function updatePhraseDrag(e) {
            if (!dragState) return;
            dragState.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`;
            document.querySelectorAll('.quick-phrase-group-card.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
            const targetCard = document.elementFromPoint(e.clientX, e.clientY)?.closest('.quick-phrase-group-card');
            const targetGroupId = targetCard?.dataset.groupId || null;
            dragState.targetGroupId = targetGroupId && targetGroupId !== dragState.groupId ? targetGroupId : null;
            if (dragState.targetGroupId) targetCard.classList.add('is-drop-target');
        }

        async function finishPhraseDrag(e) {
            updatePhraseDrag(e);
            const targetGroup = data.groups.find(g => g.id === dragState?.targetGroupId);
            if (targetGroup && dragState?.phrase) {
                dragState.sourceGroup.phrases.splice(dragState.phraseIndex, 1);
                dragState.sourceGroup.recent = (dragState.sourceGroup.recent || []).filter(p => p !== dragState.phrase);
                if (!targetGroup.phrases.includes(dragState.phrase)) targetGroup.phrases.push(dragState.phrase);
                collapsedGroups.delete(targetGroup.id);
                await persist();
            }
            cancelPhraseDrag();
            renderList();
        }

        function cancelPhraseDrag() {
            if (!dragState) return;
            dragState.item.classList.remove('is-dragging');
            dragState.ghost.remove();
            document.querySelectorAll('.quick-phrase-group-card.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
            dragState = null;
        }

        overlay.querySelector('#qp-group-add-btn').addEventListener('click', async () => {
            const input = overlay.querySelector('#qp-group-input');
            const name = input.value.trim();
            if (!name) return;
            data.groups.push({ id: makeQuickPhraseId('group'), name, phrases: [], recent: [] });
            input.value = '';
            await persist();
            renderList();
        });
        overlay.querySelector('#qp-group-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') overlay.querySelector('#qp-group-add-btn').click();
        });
        overlay.querySelector('#qp-close-btn').addEventListener('click', () => overlay.remove());
        renderList();
    });

    document.body.appendChild(overlay);
}
