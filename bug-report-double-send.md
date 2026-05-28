# Bug Report: Double Send on Enter / Click

**Project**: Smart Sticky Notes (vanilla JS PWA)  
**File**: `pwa/js/app.js`, function `sendTextNote()`  
**Date**: 2026-05-28  
**Severity**: High — every send creates duplicate note entries  

---

## Symptom

Pressing Enter or clicking the send button creates **two identical entries** in the Supabase database, resulting in two chat bubbles appearing in the UI.

The second entry appears approximately 12 seconds after the first:

```
[SSN] sendTextNote called #1 at +1779949966103ms since last
[SSN] sendTextNote called #2 at +12516ms since last
```

This happens with both Enter key and send button click.

---

## Attempted Fixes (all failed)

### 1. `e.preventDefault()` + `e.stopPropagation()` on keydown
Added to prevent browser default Enter behavior. **No effect.**

### 2. `e.stopImmediatePropagation()` on keydown
Blocked other handlers on the same element. **No effect.**

### 3. Switched from `keydown` to `keypress`
Used keypress event instead. **No effect.**

### 4. Timestamp-based debounce (800ms → 1000ms)
```javascript
let _lastSend = 0;
const now = Date.now();
if (now - _lastSend < 1000) return;
_lastSend = now;
```
Failed because the second call arrives ~12 seconds later, far exceeding the debounce window.

### 5. Reintroduced `_isSending` boolean lock
```javascript
let _isSending = false;
async function sendTextNote() {
    if (_isSending) return;
    _isSending = true;
    // ... async work ...
    _isSending = false; // success path
    _isSending = false; // catch path
}
```
**No effect.** The second call still passes through. This implies `_isSending` is `false` at the time of the second call, meaning either:
- The first call completed and set `_isSending = false` before the second call arrived, OR
- Two separate instances of the module/function exist

### 6. Guard against `setupMainUI` being called twice
```javascript
let _mainUISetup = false;
if (_mainUISetup) return;
_mainUISetup = true;
```
**No effect.** This confirms `setupMainUI` is only called once, so there are no duplicate event listeners from re-initialization.

### 7. Disabled Enter key entirely, test with send button only
User clicked send button only (no keyboard). **Still produces two entries 12 seconds apart.** This rules out Enter key logic entirely.

### 8. Cleared stale `_pendingVoiceBlob`
Moved voice blob cleanup to be atomic at function start. **No effect** — text-only sends don't use the voice path.

---

## Current State of `sendTextNote`

```javascript
let _isSending = false;

async function sendTextNote() {
    if (_isSending) return;     // Lock check
    _isSending = true;           // Lock acquired

    const textInput = document.getElementById('text-input');
    const sendBtn = document.getElementById('send-btn');
    const text = textInput.value.trim();
    sendBtn.disabled = true;     // Button disabled

    if (!text && !window._pendingVoiceBlob) {
        _isSending = false;
        sendBtn.disabled = false;
        return;
    }

    const tags = parseTags(text || '');
    const voiceBlob = window._pendingVoiceBlob;
    window._pendingVoiceBlob = null;   // Atomic cleanup
    window._pendingVoiceDuration = null;

    try {
        let note;
        if (voiceBlob) {
            note = await insertNote({ type: 'voice', ... });
            // upload audio...
        } else {
            note = await insertNote({ type: 'text', text, tags, ... });
        }

        textInput.value = '';
        toggleSendButton(false);

        const list = document.getElementById('notes-list');
        const bubble = renderNoteBubble(note, ...);
        list.appendChild(bubble);

        // Cache update...
        _isSending = false; sendBtn.disabled = false;   // Lock released (success)
    } catch (err) {
        _isSending = false; sendBtn.disabled = false;   // Lock released (error)
        if (!isOnline()) {
            await addToQueue(...);
            showToast('已保存到本地，联网后自动发送');
        } else {
            showToast('发送失败: ' + err.message);
        }
    }
}
```

### Event Registration (in `setupMainUI`)
```javascript
textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendTextNote(); }
});

document.getElementById('send-btn').addEventListener('click', sendTextNote);
```

`setupMainUI` is guarded with `_mainUISetup` — only runs once.

---

## Key Observations

1. **Only ONE `sendTextNote` call is logged** from the Enter/click event at t=0ms
2. **A SECOND call arrives at t=+12516ms** — approximately 12.5 seconds later
3. The second call is NOT from the original Enter/click event
4. The `_isSending` lock does NOT block it, meaning `_isSending` was `false`
5. The first call must have completed and released the lock before the second call arrived
6. The Supabase insert is successful — the first note is created and visible

## Hypothesis

The 12-second delayed call suggests one of:

1. **Browser network change event** — the `online` event fires, triggering `flushAndReload()` which calls `insertNote()` directly (not `sendTextNote`). But the debug log shows `sendTextNote` being called. Could there be a listener chain that calls `sendTextNote` from a network event?

2. **Stale module/code cache** — an old version of `sendTextNote` (without the lock) is also registered. But `[SSN] v2.3 loaded` confirms the new module loaded. ES modules are singletons — they don't execute twice.

3. **Supabase Realtime / subscription** — not configured in this project, ruled out.

4. **Browser tab duplicate** — user has two tabs open on the same PWA. Clicking in one triggers `sendTextNote`, and the second tab also picks up the event somehow. Highly unlikely.

5. **Event listener registered twice** — despite `_mainUISetup` guard, the listener could be registered in a different code path (e.g., a `DOMContentLoaded` handler that also registers listeners).

---

## Callers of `insertNote` (the only function that creates database rows)

| Location | Line | Called from |
|----------|------|------------|
| `sendTextNote()` text path | ~307 | User action (Enter/click) |
| `sendTextNote()` voice path | ~300 | User action (Enter/click) |
| `flushAndReload()` → `flushQueue()` | ~366 | Network reconnect |

## Callers of `sendTextNote`

| Location | Trigger |
|----------|---------|
| `textInput keydown` | User presses Enter |
| `send-btn click` | User clicks send button |

That's it. Only two triggers for `sendTextNote`.

---

## Files Involved

- `pwa/js/app.js` — main controller, `sendTextNote`, event setup
- `pwa/js/db.js` — `insertNote()` database call
- `pwa/js/offline.js` — `flushQueue()`, `addToQueue()`, online/offline detection
- `pwa/js/ui.js` — `toggleSendButton()`

---

## Reproducing

1. Open `http://localhost:3000`
2. Log in via magic link
3. Type any text in the input field
4. Press Enter or click send button
5. Two identical bubbles appear in the chat list
6. Supabase shows two rows with identical text but different UUIDs

---

## Environment

- Browser: Chrome on Windows 11
- Server: `python -m http.server 3000` (localhost)
- Network: Online, Supabase connected via Brevo SMTP
- Service Worker: Network-first caching strategy (v2)
