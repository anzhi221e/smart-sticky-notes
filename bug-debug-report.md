# Smart Sticky Notes v2 — Bug & Debug Report

**Project**: Smart Sticky Notes (PWA + Supabase + Python sync)  
**Date**: 2026-05-28  
**Session**: v2 implementation & debugging

---

## Bug #1: Black Screen on Load (P0 — CRITICAL)

### Symptom
Page loads as completely black. No UI elements visible. Occurs after Ctrl+Shift+R hard refresh.

### Root Cause
Multiple contributing factors, resolved in stages:

1. **CSS `!important` on `.hidden` class** (v1 legacy): `.hidden { display: none !important }` overrode any JS class manipulation. JS used `navigateTo()` which added `.active` class, but never removed `.hidden` — the `!important` won. Fix: removed `!important` from `.hidden`.

2. **4 places manually setting `.active` without removing `.hidden`**: `navigateTo()` correctly handles both `active` + `hidden`. But 4 locations in `app.js` directly called `classList.add('active')` without also calling `classList.remove('hidden')`. Fix: all screen transitions now exclusively use `navigateTo()`.

3. **Stale browser cache/SW**: `python -m http.server` serves files with default caching headers. Browser Disk Cache returns old JS despite Ctrl+Shift+R. Fix: server restarted, user instructed to use F12 → Network → Disable cache.

4. **Syntax error in `setupConnectionForm`**: A faulty edit left a stray `);` after a `console.log`, breaking the entire `app.js` module. `node --check` didn't catch it because the syntax was locally valid (the error was at module evaluation time, not parse time). Fix: removed stray `);`.

5. **All screens default to invisible**: CSS `.screen { display: none }` + no default `active` class = if JS fails, nothing is visible. Fix: `screen-connect` now has `class="screen active"` in HTML as fallback.

### Final Architecture
- `doInit()` extracted as standalone async function
- Connect form calls `doInit()` directly (no page reload)
- All screen transitions go through `navigateTo()`
- Connect screen is default-visible fallback

---

## Bug #2: Double Send — Two Notes Created Per Action (P0 — CRITICAL)

### Symptom
Pressing Enter or clicking send creates two identical bubbles in the chat list. Database has only one row. Refresh shows only one entry. Second entry appears ~12 seconds after the first.

### 8 Failed Attempts
1. `e.preventDefault()` + `e.stopPropagation()` — No effect
2. `e.stopImmediatePropagation()` — No effect
3. Switched `keydown` → `keypress` — No effect
4. Timestamp debounce (800ms → 1000ms) — Failed because second call arrives 12s later
5. `_isSending` boolean lock — Failed because first call completes and releases lock before second call
6. `setupMainUI` single-call guard — Not the issue
7. Disabled Enter, tested with send button only — Still produces two entries
8. Split `sendTextNote` try/catch + client UUID idempotent insert — Didn't fix it, problem was in DOM layer

### Root Cause (found by external reviewer)
The bug was NOT in event handling or database insertion. It was in **scroll-triggered DOM duplication**:

```
sendTextNote → insertNote (DB success) → appendChild(bubble) 
→ list.scrollTop = list.scrollHeight  ← THIS TRIGGERS SCROLL LISTENER
→ "near bottom" condition met → loadOlderNotes()
→ queries DB for notes with created_at > _oldestCursor.created_at
→ returns the just-sent note → appendChild again
→ DOM has two identical bubbles
```

The `scrollTop = scrollHeight` assignment is a side-effect bomb: it fires the scroll event listener, which calls `loadOlderNotes()`, which fetches the just-sent note from the database and appends it to the DOM a second time.

### Fix (external)
1. Infinite scroll loads OLDER notes only (using `< _oldestCursor` not `>`)
2. Notes prepended to top instead of appended to bottom
3. `data-note-id` dedup before append
4. Send no longer triggers scroll-to-bottom

---

## Bug #3: Voice Recording Fails — "录音保存失败" (P1)

### Root Cause
In `onMicPress` → `onUp` handler:
```javascript
textInput = document.getElementById('text-input');  // No const/let/var
textInput.value = text;
```

ES modules run in strict mode. Assigning to an undeclared variable throws `ReferenceError`. The catch block showed generic "录音保存失败".

### Fix
Changed to `const textInputEl = document.getElementById('text-input')`.

---

## Bug #4: Tags Invisible on Colored Bubbles (P2)

### Root Cause
Two CSS rules for `.note-bubble .note-tag`:
- Line 82: `background: rgba(0,0,0,0.15); color: inherit;`
- Line 84: `background: var(--accent-dim); color: var(--accent);`

The second rule (higher specificity by source order) overrode the first. On pink bubbles, `var(--accent-dim)` = pink-tinted background, `var(--accent)` = pink text → pink on pink = invisible.

### Fix
Merged into single rule: `background: rgba(0,0,0,0.18); color: inherit;` (works on all bubble colors).

---

## Bug #5: Connect Form "Clears Fields, Can't Login" (P0)

### Symptom
User fills Supabase URL + anon key → clicks Connect → fields clear → still on connect screen.

### Root Cause
`window.location.reload()` after `saveConnection()`. After reload, browser served cached HTML or localStorage timing issue prevented `getConnection()` from reading the just-saved values. The page fell back to connect screen (default visible).

### Fix
Removed `window.location.reload()`. Extracted init logic into `doInit()` function. Connect form submit calls `doInit()` directly without page reload.

---

## Bug #6: Sidebar Menu Unresponsive After Editing (P2)

### Root Cause
`toggleSidebar()` used `classList.toggle()` for both `open` and `hidden` classes. But `navigateTo()` always added `hidden` to sidebar. State desynchronized — sidebar had both `open` and `hidden` after certain navigation sequences.

### Fix
`toggleSidebar()` now uses explicit if/else: check current state → set correct classes.

---

## Bug #7: Theme Colors — Bubble/Background Inverted (P2)

### Root Cause
CSS variable `--surface` (white in light themes) was used for `.note-bubble` background. Bubbles were white on white background.

### Fix
Added `--bubble-bg` and `--bubble-text` CSS variables. Uniform themes: `--bubble-bg` = accent color. Multi-color: inline `style.background` overrides.

---

## Bug #8: CSS Rule Collision — `.note-meta` Date Invisible (P2)

### Root Cause
`.note-meta` had `color: var(--text-secondary)` which is grey. On colored bubbles, grey text is unreadable.

### Fix
Removed fixed `color` from `.note-meta`. Now inherits bubble text color (white on colored bubbles).

---

## Files Touched During Debugging

| File | Changes |
|------|---------|
| `pwa/js/app.js` | ~20 edits: doInit extraction, navigateTo fixes, voice fix, connect form fix, try/catch, select mode |
| `pwa/js/ui.js` | navigateTo fix, toggleSidebar fix, 8 themes, 36-color palette |
| `pwa/js/notes.js` | Markdown rendering, multi-color bubble bg, bubble menu sheet, delete guard |
| `pwa/js/toolbar.js` | Dynamic syntax buttons from config |
| `pwa/js/settings.js` | 8-theme swatches, toolbar editor, signOut import |
| `pwa/js/tags.js` | Card colors, color picker, tag slug |
| `pwa/css/app.css` | ~10 edits: bubble colors, tag pills, menu sheet, theme swatches, meta text |
| `pwa/index.html` | Toolbar DOM, search bar, select mode icon, default active screen |
| `pwa/sw.js` | Cache-first → network-first |
| `sync/markdown_writer.py` | Tag aggregation, snapshot export |

## Lessons Learned

1. **`scrollTop = scrollHeight` is a side-effect bomb** — any scroll listener will fire
2. **ES module strict mode** catches undeclared variable assignments silently to the catch block
3. **CSS rule order matters** — two selectors with same specificity, the later wins
4. **`!important` + JS class manipulation = silent failure** — CSS wins every time
5. **Browser cache during local dev** — always disable cache in DevTools
6. **`node --check` doesn't catch runtime errors** — stray `);` passes syntax check but kills module load
7. **Page reload for state changes is fragile** — call functions directly instead
