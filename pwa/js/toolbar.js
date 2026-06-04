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
