const MARKDOWN_ACTIONS = {
    bold:          { before: '**', after: '**', placeholder: '粗体文字' },
    italic:        { before: '*', after: '*', placeholder: '斜体文字' },
    underline:     { before: '<u>', after: '</u>', placeholder: '下划线文字' },
    strikethrough: { before: '~~', after: '~~', placeholder: '删除线文字' },
    bullet:        { before: '\n- ', after: '', placeholder: '列表项' },
    numbered:      { before: '\n1. ', after: '', placeholder: '列表项' },
    h1:            { before: '# ', after: '', placeholder: '' },
    h2:            { before: '## ', after: '', placeholder: '' },
    h3:            { before: '### ', after: '', placeholder: '' },
    smartconn:     { before: '::', after: '', placeholder: '' },
    quote:         { before: '> ', after: '', placeholder: '' },
};

let _targetInput = null;

export function setToolbarTarget(inputEl) {
    _targetInput = inputEl;
}

export function initToolbar() {
    document.querySelectorAll('.tb-btn[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const def = MARKDOWN_ACTIONS[action];
            if (!def || !_targetInput) return;
            insertMarkdown(def);
        });
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
    const sorted = [...pinnedTags, ...tags.filter(t => !pinnedTags.includes(t))];
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
