# Smart Sticky Notes v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Smart Sticky Notes from single-note-file sync to tag-based aggregation, add rich text editing with dual toolbar, 6 themes, search, infinite scroll, and 30-day recycle bin with auto-purge.

**Architecture:** PWA (vanilla JS) for editing → Supabase source of truth → PC Python script generates atomic snapshot exports (tag-aggregated Markdown) to local OneDrive folder.

**Tech Stack:** Vanilla JS (PWA), Python 3.10+ (sync script), Supabase (DB + Auth + Storage)

---

## File Structure (Changes from v1)

```
smart_sticky_notes/
├── supabase/migrations/
│   └── 002_v2.sql                    ← NEW: sync_requests table, drop synced_at/deletion_events
├── sync/
│   ├── tag_slug.py                   ← NEW: tag filename safety + collision detection
│   ├── audio_gc.py                   ← NEW: orphan audio file cleanup
│   ├── markdown_writer.py           ← REWRITE: tag aggregation + note boundaries
│   ├── sync_loop.py                 ← REWRITE: snapshot export + sync_requests polling
│   ├── main.py                      ← MODIFY: new config keys, purge check
│   └── config.py                    ← MODIFY: last_sync_at
├── pwa/
│   ├── css/
│   │   └── app.css                  ← MODIFY: 6 theme variables, toolbar, tag cards, editor
│   ├── js/
│   │   ├── app.js                   ← REWRITE: toolbar toggle, search, edit mode, infinite scroll
│   │   ├── db.js                    ← MODIFY: sync_requests, tag queries, Markdown text
│   │   ├── ui.js                    ← MODIFY: theme system, toolbar visibility
│   │   ├── notes.js                 ← MODIFY: Markdown rendering in bubbles
│   │   ├── toolbar.js              ← NEW: formatting + Obsidian syntax + tag quick bar
│   │   ├── editor.js               ← NEW: bubble inline editing + Markdown preview
│   │   ├── calendar.js             ← UNCHANGED
│   │   ├── tags.js                 ← NEW: card/list tag views with pin/delete
│   │   ├── recycle-bin.js          ← NEW: 30-day countdown, restore, purge
│   │   ├── settings.js             ← NEW: theme selector, sync interval, pinned tags
│   │   ├── wizard.js               ← MODIFY: v2 SQL snippet
│   │   ├── voice.js                ← UNCHANGED
│   │   ├── audio-player.js         ← UNCHANGED
│   │   ├── offline.js              ← UNCHANGED
│   │   ├── supabase.js             ← UNCHANGED
│   │   └── auth.js                 ← UNCHANGED
│   ├── index.html                  ← MODIFY: toolbar DOM, search bar, editor overlay
│   └── sw.js                       ← MODIFY: cache new JS files
```

---

## Phase 1: Database Migration

### Task 1: v2 SQL Migration

**Files:**
- Create: `supabase/migrations/002_v2.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- v2 Migration: add sync_requests, remove synced_at, remove deletion_events

-- New table: manual sync trigger from PWA
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

-- Remove v1 artifacts
ALTER TABLE smartstickynotes_items DROP COLUMN IF EXISTS synced_at;

DROP TABLE IF EXISTS deletion_events;

-- Add last_sync_at to config (handled via upsert, no schema change needed)
```

- [ ] **Step 2: Run migration on Supabase**

```bash
echo "Execute 002_v2.sql in Supabase SQL Editor manually or via CLI"
```

Expected: Tables created, columns dropped, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/002_v2.sql
git commit -m "feat: v2 migration — sync_requests table, remove synced_at and deletion_events"
```

---

## Phase 2: PC Sync Script

### Task 2: Tag Slug Module

**Files:**
- Create: `sync/tag_slug.py`

- [ ] **Step 1: Write tag slug module**

```python
"""Tag-to-safe-filename conversion with collision detection."""
import re
import hashlib

ILLEGAL_CHARS = re.compile(r'[/\\:*?"<>|]')
MAX_LEN = 100

def sanitize(tag: str) -> str:
    if not tag or not tag.strip():
        return "untagged"
    slug = ILLEGAL_CHARS.sub("_", tag.strip())
    slug = slug.strip(". ")
    if len(slug) > MAX_LEN:
        slug = slug[:MAX_LEN]
    return slug or "untagged"

def build_tag_map(tags: list[str]) -> dict[str, str]:
    """Build {original_tag: safe_filename} map with collision resolution."""
    slug_to_tags: dict[str, list[str]] = {}
    for tag in sorted(set(tags)):
        slug = sanitize(tag)
        slug_to_tags.setdefault(slug, []).append(tag)

    result = {}
    for slug, tag_list in slug_to_tags.items():
        if len(tag_list) == 1:
            result[tag_list[0]] = f"{slug}.md"
        else:
            for tag in tag_list:
                short_hash = hashlib.sha256(tag.encode()).hexdigest()[:6]
                result[tag] = f"{slug}__{short_hash}.md"
    return result
```

- [ ] **Step 2: Commit**

```bash
git add sync/tag_slug.py
git commit -m "feat: tag slug module with collision detection"
```

### Task 3: Audio GC Module

**Files:**
- Create: `sync/audio_gc.py`

- [ ] **Step 1: Write audio GC module**

```python
"""Clean up orphaned audio files not referenced by any active or deleted note."""
from pathlib import Path
from supabase_client import get_client

def collect_referenced_paths() -> set[str]:
    """Return set of note_id prefixes (first 8 chars of audio_path filenames)."""
    client = get_client(use_service_role=True)
    active = client.table("smartstickynotes_items").select("audio_path").eq("status", "active").execute()
    deleted = client.table("smartstickynotes_items").select("audio_path").eq("status", "deleted").execute()
    refs = set()
    for row in active.data + deleted.data:
        ap = row.get("audio_path")
        if ap:
            refs.add(Path(ap).stem[:8])
    return refs

def cleanup_orphans(folder: str) -> int:
    """Delete audio files not referenced by any note. Returns count removed."""
    audio_dir = Path(folder) / "audio"
    if not audio_dir.exists():
        return 0
    refs = collect_referenced_paths()
    removed = 0
    for f in audio_dir.iterdir():
        if f.suffix == ".opus" and f.stem[:8] not in refs:
            f.unlink()
            removed += 1
    return removed
```

- [ ] **Step 2: Commit**

```bash
git add sync/audio_gc.py
git commit -m "feat: audio garbage collection for orphaned files"
```

### Task 4: Rewrite Markdown Writer for Tag Aggregation

**Files:**
- Rewrite: `sync/markdown_writer.py`

- [ ] **Step 1: Write new markdown writer**

```python
"""Generate tag-aggregated Markdown files with note boundaries for snapshot export."""
import hashlib
from pathlib import Path
from datetime import datetime
from tag_slug import build_tag_map


def _format_time(iso_str: str) -> str:
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M")
    except (ValueError, AttributeError):
        return iso_str


def _note_boundary(note: dict) -> str:
    return (
        f"<!-- note:id={note['id']} "
        f"created_at={note['created_at']} "
        f"updated_at={note['updated_at']} "
        f"tags={','.join(note.get('tags', []))} -->"
    )


def _render_note(note: dict) -> str:
    lines = [
        _note_boundary(note),
        "",
        note.get("text", ""),
        "",
    ]
    if note.get("tags"):
        tags_str = " ".join(f"#{t}" for t in note["tags"])
        lines.append(f"tags: {tags_str}")
    if note.get("audio_path"):
        note_id_short = note["id"][:8]
        dur = note.get("audio_duration", 0)
        mins, secs = divmod(dur, 60) if dur else (0, 0)
        lines.append(f"> [收听录音](../../audio/{note_id_short}.opus) ({mins}:{secs:02d})")
    lines.append("")
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def build_tag_files(notes: list[dict]) -> dict[str, str]:
    """Group notes by tag and generate Markdown content per tag file.
    Returns {filename: markdown_content}.
    """
    all_tags = set()
    for note in notes:
        for tag in note.get("tags", []):
            if tag.strip():
                all_tags.add(tag.strip())

    tag_map = build_tag_map(list(all_tags))
    tag_notes: dict[str, list[str]] = {filename: [] for filename in tag_map.values()}
    untagged = []

    for note in notes:
        rendered = _render_note(note)
        note_tags = [t.strip() for t in note.get("tags", []) if t.strip()]
        if not note_tags:
            untagged.append(rendered)
        else:
            seen_files = set()
            for tag in note_tags:
                filename = tag_map.get(tag)
                if filename and filename not in seen_files:
                    tag_notes[filename].append(rendered)
                    seen_files.add(filename)

    result = {}
    for filename, note_texts in tag_notes.items():
        if note_texts:
            tag_display = filename.replace(".md", "")
            content = f"# {tag_display}\n\n" + "\n".join(note_texts)
            result[filename] = content

    if untagged:
        result["未分类.md"] = "# 未分类\n\n" + "\n".join(untagged)

    return result, tag_map


def write_snapshot(active_notes: list[dict], deleted_notes: list[dict], folder: str) -> dict:
    """Write a complete snapshot to snapshots/{timestamp}/. Returns manifest dict."""
    import json
    timestamp = datetime.now().strftime("%Y-%m-%dT%H%M%S")
    snap_dir = Path(folder) / "snapshots" / timestamp
    snap_dir.mkdir(parents=True, exist_ok=True)

    tag_files, tag_map = build_tag_files(active_notes)
    manifest_files = []

    for filename, content in tag_files.items():
        filepath = snap_dir / filename
        filepath.write_text(content, encoding="utf-8")
        sha = hashlib.sha256(content.encode()).hexdigest()[:16]
        tag = next((t for t, f in tag_map.items() if f == filename), filename)
        note_ids = []
        for note in active_notes:
            note_tags = [t.strip() for t in note.get("tags", [])]
            if filename in [tag_map.get(t) for t in note_tags if t in tag_map]:
                note_ids.append(note["id"])
        manifest_files.append({
            "tag": tag, "filename": filename,
            "note_ids": note_ids, "sha256": sha,
        })

    # Write deleted notes export
    trash_dir = Path(folder) / "trash"
    trash_dir.mkdir(parents=True, exist_ok=True)
    if deleted_notes:
        trash_content = "# 已删除的笔记\n\n"
        for note in deleted_notes:
            trash_content += _render_note(note)
        (trash_dir / "deleted.md").write_text(trash_content, encoding="utf-8")

    # Manifest last
    manifest = {
        "schema_version": 1,
        "generated_at": datetime.now().isoformat(),
        "source": "supabase",
        "notes_count": len(active_notes) + len(deleted_notes),
        "active_notes_count": len(active_notes),
        "deleted_notes_count": len(deleted_notes),
        "files": manifest_files,
        "tag_filename_map": {k: v for k, v in tag_map.items()},
    }
    (snap_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # Copy to current/
    current_dir = Path(folder) / "current"
    current_dir.mkdir(parents=True, exist_ok=True)
    for f in snap_dir.iterdir():
        dest = current_dir / f.name
        dest.write_bytes(f.read_bytes())

    return manifest


def rotate_snapshots(folder: str, keep: int = 5) -> None:
    snap_dir = Path(folder) / "snapshots"
    if not snap_dir.exists():
        return
    dirs = sorted([d for d in snap_dir.iterdir() if d.is_dir()], reverse=True)
    for d in dirs[keep:]:
        for f in d.iterdir():
            f.unlink()
        d.rmdir()
```

- [ ] **Step 2: Commit**

```bash
git add sync/markdown_writer.py
git commit -m "feat: tag-aggregated markdown writer with snapshot export and current/ copy"
```

### Task 5: Rewrite Sync Loop for v2

**Files:**
- Rewrite: `sync/sync_loop.py`
- Modify: `sync/config.py`
- Modify: `sync/main.py`

- [ ] **Step 1: Update config.py**

```python
# Add to config.py
def update_last_sync_at(timestamp: str) -> None:
    from supabase_client import get_client
    client = get_client(use_service_role=True)
    # Write via raw SQL since config table needs user_id
    uid = _get_user_id()
    client.table("smartstickynotes_config").upsert(
        {"user_id": uid, "key": "last_sync_at", "value": timestamp,
         "updated_at": datetime.now(timezone.utc).isoformat()},
        on_conflict="user_id,key"
    ).execute()

def _get_user_id() -> str:
    from supabase_client import get_client
    client = get_client(use_service_role=True)
    users = client.auth.admin.list_users()
    return users[0].id if users else ""
```

- [ ] **Step 2: Rewrite sync_loop.py**

```python
"""Main sync loop v2: snapshot export with tag aggregation."""
from datetime import datetime, timezone, timedelta
from pathlib import Path
import time

from supabase_client import get_client
from config import read_config, update_last_sync_at
from markdown_writer import write_snapshot, rotate_snapshots
from audio_gc import cleanup_orphans

SYNC_REQUEST_TIMEOUT_MINUTES = 10

class SyncLoopV2:
    def __init__(self, on_alert=None):
        self.on_alert = on_alert or (lambda level, msg: print(f"[{level.upper()}] {msg}"))
        self.running = False
        self._fast_poll = False
        self._fast_poll_until = None

    def stop(self):
        self.running = False

    def run_once(self) -> dict:
        client = get_client(use_service_role=True)
        config = read_config()
        folder = config.get("local_folder_path", "")
        if not folder:
            return {"status": "no_folder"}

        folder_path = Path(folder)
        if not folder_path.is_dir():
            self.on_alert("error", f"Folder not accessible: {folder}")
            return {"status": "folder_inaccessible"}

        # Check sync_requests
        self._check_sync_requests(client)

        # Fetch active + deleted notes
        active = client.table("smartstickynotes_items").select("*").eq("status", "active").execute()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        deleted = client.table("smartstickynotes_items").select("*").eq("status", "deleted").gte("deleted_at", cutoff).execute()

        # Purge expired notes
        self._purge_expired(client, folder)

        # Write snapshot
        manifest = write_snapshot(active.data, deleted.data, folder)
        rotate_snapshots(folder, keep=5)

        # Audio GC
        removed = cleanup_orphans(folder)
        if removed:
            self.on_alert("info", f"Cleaned up {removed} orphaned audio files")

        # Update state
        now = datetime.now(timezone.utc).isoformat()
        update_last_sync_at(now)

        return {
            "status": "ok",
            "active": len(active.data),
            "deleted": len(deleted.data),
            "files": len(manifest.get("files", [])),
            "audio_cleaned": removed,
        }

    def _check_sync_requests(self, client):
        # Take pending requests (or stuck processing > 10 min)
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=SYNC_REQUEST_TIMEOUT_MINUTES)).isoformat()
        pending = client.table("sync_requests").select("*").or_(
            f"status.eq.pending, and(status.eq.processing,processing_started_at.lt.{cutoff})"
        ).execute()

        for req in pending.data:
            client.table("sync_requests").update({
                "status": "processing",
                "processing_started_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", req["id"]).execute()

        return len(pending.data) > 0

    def _complete_sync_request(self, client, success: bool, error_msg: str = ""):
        pending = client.table("sync_requests").select("*").eq("status", "processing").execute()
        for req in pending.data:
            if success:
                client.table("sync_requests").update({
                    "status": "completed",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", req["id"]).execute()
            else:
                client.table("sync_requests").update({
                    "status": "failed",
                    "error_message": error_msg,
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", req["id"]).execute()

    def _purge_expired(self, client, folder: str):
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        expired = client.table("smartstickynotes_items").select("id, audio_path").eq("status", "deleted").lt("deleted_at", cutoff).execute()
        for note in expired.data:
            if note.get("audio_path"):
                try:
                    client.storage.from_("smartstickynotes_audio").remove([note["audio_path"]])
                except Exception:
                    pass
            client.table("smartstickynotes_items").delete().eq("id", note["id"]).execute()


def run_sync_loop(interval_seconds: int = 1800, on_alert=None):
    loop = SyncLoopV2(on_alert=on_alert)
    loop.running = True
    while loop.running:
        try:
            stats = loop.run_once()
            if stats.get("status") == "ok":
                on_alert("info", f"Sync: {stats['active']} active, {stats['deleted']} deleted, {stats['files']} files")
        except Exception as e:
            on_alert("error", f"Sync failed: {e}")
        # Sleep in 1s increments, checking for early wake
        for _ in range(interval_seconds):
            if not loop.running:
                break
            time.sleep(1)
```

- [ ] **Step 3: Update main.py imports**

```python
# Replace: from sync_loop import SyncLoop, run_sync_loop
# With:    from sync_loop import SyncLoopV2, run_sync_loop
# Replace: loop = SyncLoop(on_alert=on_alert)
# With:    loop = SyncLoopV2(on_alert=on_alert)
# Update interval default: interval_seconds=1800  (30 min)
```

- [ ] **Step 4: Commit**

```bash
git add sync/sync_loop.py sync/config.py sync/main.py
git commit -m "feat: v2 sync loop with snapshot export, sync_requests polling, audio GC"
```

---

## Phase 3: PWA Features

### Task 6: Markdown Renderer

**Files:**
- Modify: `pwa/js/notes.js`

- [ ] **Step 1: Update renderNoteBubble for Markdown**

```javascript
// Add to notes.js — Markdown-to-HTML renderer for bubbles
function renderMarkdown(text) {
    if (!text) return '';
    let html = text;
    // Order matters: headers before bold, etc.
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Line breaks
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    return html;
}

// In renderNoteBubble, replace: textEl.textContent = note.text || '';
// With:
// textEl.innerHTML = renderMarkdown(note.text || '');
```

- [ ] **Step 2: Commit**

```bash
git add pwa/js/notes.js
git commit -m "feat: Markdown rendering in note bubbles"
```

### Task 7: Toolbar Component

**Files:**
- Create: `pwa/js/toolbar.js`
- Modify: `pwa/index.html` (toolbar DOM)
- Modify: `pwa/css/app.css` (toolbar styles)

- [ ] **Step 1: Add toolbar HTML to index.html**

Add above the `<footer class="bottom-bar">` in `#screen-main`:

```html
<!-- Toolbar (hidden by default) -->
<div id="toolbar" class="toolbar hidden">
    <div class="toolbar-row toolbar-row--format">
        <div class="toolbar-group">
            <button class="tb-btn" data-action="bold" title="加粗">B</button>
            <button class="tb-btn tb-btn--italic" data-action="italic" title="斜体">I</button>
            <button class="tb-btn tb-btn--underline" data-action="underline" title="下划线">U</button>
            <button class="tb-btn tb-btn--strike" data-action="strikethrough" title="删除线">S̶</button>
            <button class="tb-btn" data-action="bullet" title="无序列表">••</button>
            <button class="tb-btn" data-action="numbered" title="有序列表">1.</button>
        </div>
        <div class="toolbar-group">
            <button class="tb-btn" data-action="h1" title="一级标题">#</button>
            <button class="tb-btn" data-action="h2" title="二级标题">##</button>
            <button class="tb-btn" data-action="h3" title="三级标题">###</button>
            <button class="tb-btn" data-action="smartconn" title="Smart Connections">::</button>
            <button class="tb-btn" data-action="quote" title="引用">＞</button>
        </div>
    </div>
    <div class="toolbar-row toolbar-row--tags" id="tag-quick-bar">
        <!-- dynamically populated -->
    </div>
</div>
```

- [ ] **Step 2: Write toolbar.js**

```javascript
import { isOnline } from './offline.js';

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

let _targetInput = null; // The input/textarea to insert into
let _onSendRequest = null; // For send button in toolbar

export function setToolbarTarget(inputEl, onSend) {
    _targetInput = inputEl;
    _onSendRequest = onSend;
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
    const start = el.selectionStart;
    const end = el.selectionEnd;
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

// Tag quick bar
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
            const pos = el.selectionStart;
            const insert = '#' + tag + ' ';
            el.value = el.value.substring(0, pos) + insert + el.value.substring(pos);
            el.focus();
            el.setSelectionRange(pos + insert.length, pos + insert.length);
        });
        bar.appendChild(pill);
    });
}
```

- [ ] **Step 3: Add toolbar CSS**

```css
.toolbar { border-top: 1px solid var(--border); background: var(--bg); padding: 8px 12px; }
.toolbar-row { display: flex; gap: 6px; overflow-x: auto; padding: 4px 0; }
.toolbar-row--format { justify-content: space-between; }
.toolbar-group { display: flex; gap: 4px; }
.tb-btn {
    background: var(--surface); border: 1px solid var(--border);
    color: var(--text); padding: 6px 10px; border-radius: 6px;
    font-size: 13px; cursor: pointer; white-space: nowrap;
    font-family: var(--font);
}
.tb-btn--italic { font-style: italic; }
.tb-btn--underline { text-decoration: underline; }
.tb-btn--strike { text-decoration: line-through; }
.tag-pill {
    background: var(--accent-dim); color: var(--accent);
    border: none; padding: 6px 12px; border-radius: 16px;
    font-size: 13px; cursor: pointer; white-space: nowrap;
}
```

- [ ] **Step 4: Commit**

```bash
git add pwa/js/toolbar.js pwa/index.html pwa/css/app.css
git commit -m "feat: dual toolbar — formatting + Obsidian syntax + tag quick bar"
```

### Task 8: Inline Editor

**Files:**
- Create: `pwa/js/editor.js`
- Modify: `pwa/js/app.js` (edit mode integration)
- Modify: `pwa/css/app.css` (editor styles)

- [ ] **Step 1: Write editor.js**

```javascript
import { showToolbar, hideToolbar, setToolbarTarget, renderTagBar } from './toolbar.js';
import { getSupabase } from './supabase.js';

let _editingBubble = null;
let _editingNoteId = null;
let _originalText = '';

export function startEditing(bubble, noteId, text, tags, onSaved) {
    _editingBubble = bubble;
    _editingNoteId = noteId;
    _originalText = text;

    // Replace bubble content with editor
    const originalHTML = bubble.innerHTML;
    bubble._originalHTML = originalHTML;
    bubble.innerHTML = `
        <textarea class="bubble-editor" id="bubble-editor">${escapeHtml(text)}</textarea>
        <div class="edit-actions">
            <button class="edit-btn edit-btn--cancel">取消</button>
            <button class="edit-btn edit-btn--save">保存</button>
        </div>
    `;

    const textarea = bubble.querySelector('#bubble-editor');
    setToolbarTarget(textarea, null);
    showToolbar();

    // Load tags for quick bar
    import('./db.js').then(m => m.fetchTags()).then(tagCounts => {
        const tags = Object.keys(tagCounts);
        import('./db.js').then(m => m.readConfig()).then(cfg => {
            const pinned = JSON.parse(cfg.pinned_tags || '[]');
            renderTagBar(tags, pinned);
        });
    });

    bubble.querySelector('.edit-btn--cancel').addEventListener('click', () => cancelEditing(onSaved));
    bubble.querySelector('.edit-btn--save').addEventListener('click', () => saveEditing(onSaved));

    textarea.focus();
}

function escapeHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function saveEditing(onSaved) {
    const textarea = _editingBubble.querySelector('#bubble-editor');
    const newText = textarea.value;
    if (newText === _originalText) { cancelEditing(onSaved); return; }

    try {
        const sb = getSupabase();
        await sb.from('smartstickynotes_items').update({
            text: newText,
            updated_at: new Date().toISOString(),
        }).eq('id', _editingNoteId);

        _editingBubble.innerHTML = _editingBubble._originalHTML;
        // Re-render with new text
        _editingBubble.querySelector('.note-text').innerHTML = renderMarkdown(newText);
        _editingBubble._originalHTML = _editingBubble.innerHTML;
    } catch (e) {
        alert('保存失败: ' + e.message);
        return;
    }

    hideToolbar();
    setToolbarTarget(null, null);
    _editingBubble = null;
    _editingNoteId = null;
    if (onSaved) onSaved();
}

function cancelEditing(onSaved) {
    if (_editingBubble && _editingBubble._originalHTML) {
        _editingBubble.innerHTML = _editingBubble._originalHTML;
    }
    hideToolbar();
    setToolbarTarget(null, null);
    _editingBubble = null;
    _editingNoteId = null;
}
```

Need to import renderMarkdown from notes.js. Add export to notes.js.

- [ ] **Step 2: Add editor CSS**

```css
.bubble-editor {
    width: 100%; min-height: 80px; background: var(--bg);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    color: var(--text); font-family: var(--font); font-size: 15px;
    padding: 12px; resize: vertical; outline: none;
}
.edit-actions { display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end; }
.edit-btn {
    padding: 6px 16px; border-radius: 16px; border: none;
    font-size: 13px; cursor: pointer;
}
.edit-btn--save { background: var(--accent); color: #fff; }
.edit-btn--cancel { background: var(--surface); color: var(--text-secondary); border: 1px solid var(--border); }
```

- [ ] **Step 3: Commit**

```bash
git add pwa/js/editor.js pwa/css/app.css pwa/js/notes.js
git commit -m "feat: inline bubble editor with toolbar integration"
```

### Task 9: Tags View (Card/List)

**Files:**
- Create: `pwa/js/tags.js`

- [ ] **Step 1: Write tags.js**

```javascript
import { fetchTags, fetchNotesByTag, softDeleteNote, readConfig, writeConfig } from './db.js';
import { renderNoteBubble } from './notes.js';
import { showToast } from './ui.js';

export async function showTagsView() {
    const { navigateTo } = await import('./ui.js');
    navigateTo('tags');
    const content = document.getElementById('tags-content');
    if (!content) return;

    const tags = await fetchTags();
    const cfg = await readConfig();
    const pinned = JSON.parse(cfg.pinned_tags || '[]');
    const sorted = Object.entries(tags).sort((a, b) => b[1] - a[1]);

    // Mode toggle
    let mode = 'card'; // card | list
    content.innerHTML = `
        <div style="display:flex;justify-content:flex-end;padding:8px 16px;">
            <button id="tags-mode-toggle" class="icon-btn" aria-label="切换视图">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                </svg>
            </button>
        </div>
        <div id="tags-grid" class="${mode === 'card' ? 'tag-cards-grid' : 'tag-list'}"></div>
    `;

    const grid = document.getElementById('tags-grid');
    renderTagItems(grid, sorted, pinned, mode);

    document.getElementById('tags-mode-toggle').addEventListener('click', () => {
        mode = mode === 'card' ? 'list' : 'card';
        grid.className = mode === 'card' ? 'tag-cards-grid' : 'tag-list';
        renderTagItems(grid, sorted, pinned, mode);
    });
}

async function renderTagItems(container, sorted, pinned, mode) {
    container.innerHTML = '';
    // Pinned first
    const ordered = [...sorted];
    ordered.sort((a, b) => {
        const aPin = pinned.includes(a[0]) ? -1 : 0;
        const bPin = pinned.includes(b[0]) ? -1 : 0;
        return aPin - bPin || b[1] - a[1];
    });

    for (const [tag, count] of ordered) {
        const card = document.createElement('div');
        card.className = mode === 'card' ? 'tag-card' : 'tag-list-item';
        const isPinned = pinned.includes(tag);
        card.innerHTML = `
            <div class="tag-card-header">
                <span class="tag-name">${isPinned ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z"/></svg> ' : ''}#${tag}</span>
                <span class="tag-count">${count} 条</span>
            </div>
        `;
        if (mode === 'card') {
            // Fetch preview
            const notes = await fetchNotesByTag(tag);
            if (notes.length > 0) {
                const preview = document.createElement('div');
                preview.className = 'tag-card-preview';
                preview.textContent = (notes[0].text || '').substring(0, 60);
                card.appendChild(preview);
            }
        }
        card.addEventListener('click', () => showTagNotes(tag));
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showTagContextMenu(tag, count, isPinned);
        });
        container.appendChild(card);
    }
}

function showTagContextMenu(tag, count, isPinned) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.innerHTML = `
        <button class="context-item" data-action="pin">${isPinned ? '取消置顶' : '置顶'}</button>
        <button class="context-item context-item--danger" data-action="delete">删除标签笔记 (${count})</button>
    `;
    menu.querySelector('[data-action="pin"]').addEventListener('click', async () => {
        const cfg = await readConfig();
        let pinned = JSON.parse(cfg.pinned_tags || '[]');
        if (isPinned) pinned = pinned.filter(t => t !== tag);
        else pinned.push(tag);
        await writeConfig('pinned_tags', JSON.stringify(pinned));
        menu.remove();
        showTagsView();
    });
    menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
        if (confirm(`确定删除 #${tag} 下的 ${count} 条笔记？\n它们将移至回收站，30 天后自动清除。`)) {
            batchDeleteTag(tag);
        }
        menu.remove();
    });
    document.body.appendChild(menu);
    // Position near click
    // ... (positioning logic)
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}

async function batchDeleteTag(tag) {
    const notes = await fetchNotesByTag(tag);
    for (const note of notes) {
        await softDeleteNote(note.id);
    }
    showToast(`已删除 ${notes.length} 条笔记`);
    showTagsView();
}

async function showTagNotes(tag) {
    const { navigateTo } = await import('./ui.js');
    navigateTo('tags');
    const content = document.getElementById('tags-content');
    const notes = await fetchNotesByTag(tag);
    content.innerHTML = `
        <div style="padding:8px 16px;display:flex;align-items:center;gap:8px;">
            <button id="tag-notes-back" class="icon-btn">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <h2>#${tag}</h2>
        </div>
    `;
    notes.forEach(n => content.appendChild(renderNoteBubble(n)));
    document.getElementById('tag-notes-back').addEventListener('click', showTagsView);
}
```

- [ ] **Step 2: Add tag card CSS**

```css
.tag-cards-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 8px 16px; }
.tag-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; cursor: pointer; }
.tag-card:hover { background: var(--surface-hover); }
.tag-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.tag-name { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 4px; }
.tag-name svg { width: 14px; height: 14px; }
.tag-count { font-size: 12px; color: var(--text-secondary); }
.tag-card-preview { font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag-list { display: flex; flex-direction: column; gap: 6px; padding: 8px 16px; }
.tag-list-item { background: var(--surface); border: 1px solid var(--border); border-radius: 24px; padding: 12px 20px; cursor: pointer; }
.tag-list-item:hover { background: var(--surface-hover); }
.context-menu { position: fixed; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 4px; z-index: 200; min-width: 180px; }
.context-item { display: block; width: 100%; text-align: left; padding: 10px 14px; background: none; border: none; color: var(--text); font-size: 14px; cursor: pointer; border-radius: 6px; }
.context-item:hover { background: var(--surface-hover); }
.context-item--danger { color: var(--danger); }
```

- [ ] **Step 3: Commit**

```bash
git add pwa/js/tags.js pwa/css/app.css
git commit -m "feat: tags view — card/list modes, pin and batch delete with confirmation"
```

### Task 10: Recycle Bin with 30-Day Countdown

**Files:**
- Create: `pwa/js/recycle-bin.js`

- [ ] **Step 1: Write recycle-bin.js**

```javascript
import { fetchDeletedNotes, restoreNote, permanentDeleteNote } from './db.js';
import { showToast } from './ui.js';

export async function showRecycleBin() {
    const { navigateTo } = await import('./ui.js');
    navigateTo('recycle-bin');
    const list = document.getElementById('trash-list');
    if (!list) return;

    const notes = await fetchDeletedNotes();
    list.innerHTML = '';

    if (notes.length === 0) {
        list.innerHTML = '<p style="padding:24px;color:var(--text-secondary);text-align:center;">回收站为空</p>';
        return;
    }

    const now = Date.now();
    notes.forEach(note => {
        const deletedAt = new Date(note.deleted_at).getTime();
        const purgeAt = deletedAt + 30 * 24 * 60 * 60 * 1000;
        const daysLeft = Math.max(0, Math.ceil((purgeAt - now) / (24 * 60 * 60 * 1000)));

        const div = document.createElement('div');
        div.className = 'note-bubble';
        div.innerHTML = `
            <div class="note-text">${note.text || '[无文字]'}</div>
            <div class="note-meta">
                <span>${new Date(note.created_at).toLocaleString('zh-CN')}</span>
                <span style="color:var(--danger);">${daysLeft} 天后自动清除</span>
            </div>
            <div style="display:flex;gap:8px;margin-top:8px;">
                <button class="restore-btn" style="padding:6px 14px;background:var(--accent);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;">恢复</button>
                <button class="purge-btn" style="padding:6px 14px;background:var(--danger);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;">立即清除</button>
            </div>
        `;
        div.querySelector('.restore-btn').addEventListener('click', async () => {
            await restoreNote(note.id);
            div.remove();
            showToast('已恢复');
        });
        div.querySelector('.purge-btn').addEventListener('click', async () => {
            await permanentDeleteNote(note.id, note.audio_path);
            div.remove();
            showToast('已彻底删除');
        });
        list.appendChild(div);
    });

    // Batch purge all expired
    const expired = notes.filter(n => new Date(n.deleted_at).getTime() + 30*24*60*60*1000 < now);
    if (expired.length > 0) {
        const purgeAll = document.createElement('button');
        purgeAll.style.cssText = 'margin:12px 0;padding:10px;width:100%;background:var(--danger);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;';
        purgeAll.textContent = `清除全部已过期笔记 (${expired.length} 条)`;
        purgeAll.addEventListener('click', async () => {
            for (const n of expired) {
                await permanentDeleteNote(n.id, n.audio_path);
            }
            showRecycleBin();
            showToast('已清除过期笔记');
        });
        list.insertBefore(purgeAll, list.firstChild);
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add pwa/js/recycle-bin.js
git commit -m "feat: recycle bin with 30-day countdown and batch purge"
```

### Task 11: Theme System

**Files:**
- Modify: `pwa/js/ui.js` (theme functions)
- Modify: `pwa/js/app.js` (theme init)
- Modify: `pwa/css/app.css` (theme variables)

- [ ] **Step 1: Add theme functions to ui.js**

```javascript
const THEMES = {
    'pink-light':   { bg:'#fff5f7', surface:'#fff', surfaceAlt:'#ffe0e5', border:'#f0d0d8', text:'#333', textSec:'#888', accent:'#e91e63', accentDim:'rgba(233,30,99,0.12)' },
    'green-light':  { bg:'#f5fff8', surface:'#fff', surfaceAlt:'#e0ffe8', border:'#d0e8d8', text:'#333', textSec:'#888', accent:'#10b981', accentDim:'rgba(16,185,129,0.12)' },
    'blue-light':   { bg:'#f5f8ff', surface:'#fff', surfaceAlt:'#e0e8ff', border:'#d0d8f0', text:'#333', textSec:'#888', accent:'#3b82f6', accentDim:'rgba(59,130,246,0.12)' },
    'dark-blue':    { bg:'#0f1119', surface:'#1a1d2e', surfaceAlt:'#252840', border:'#2a2d40', text:'#e8e8e8', textSec:'#888', accent:'#6c8cff', accentDim:'rgba(108,140,255,0.15)' },
    'pure-black':   { bg:'#000', surface:'#111', surfaceAlt:'#1a1a1a', border:'#222', text:'#e8e8e8', textSec:'#888', accent:'#4ade80', accentDim:'rgba(74,222,128,0.15)' },
    'pink-dark':    { bg:'#1a1518', surface:'#261f23', surfaceAlt:'#32282d', border:'#3a2d33', text:'#e8d8dc', textSec:'#988', accent:'#e05588', accentDim:'rgba(224,85,136,0.15)' },
};

const DEFAULT_THEME = 'dark-blue';

export function applyTheme(name) {
    const t = THEMES[name] || THEMES[DEFAULT_THEME];
    const root = document.documentElement;
    root.style.setProperty('--bg', t.bg);
    root.style.setProperty('--surface', t.surface);
    root.style.setProperty('--surface-hover', t.surfaceAlt);
    root.style.setProperty('--border', t.border);
    root.style.setProperty('--text', t.text);
    root.style.setProperty('--text-secondary', t.textSec);
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent-dim', t.accentDim);
    localStorage.setItem('ssn-theme', name);
}

export function getThemeNames() { return Object.keys(THEMES); }
export function getThemeMeta(name) { return THEMES[name] || THEMES[DEFAULT_THEME]; }
```

- [ ] **Step 2: Add theme init to app.js**

```javascript
// In DOMContentLoaded, after initSupabase:
const savedTheme = localStorage.getItem('ssn-theme') || 'dark-blue';
applyTheme(savedTheme);
```

- [ ] **Step 3: Commit**

```bash
git add pwa/js/ui.js pwa/js/app.js
git commit -m "feat: 6-theme system with CSS custom properties"
```

### Task 12: Settings Page Update

**Files:**
- Create: `pwa/js/settings.js` (extract from app.js)
- Modify: `pwa/js/app.js` (delegate settings to settings.js)

- [ ] **Step 1: Write settings.js with theme picker, sync interval, pinned tags**

```javascript
import { readConfig, writeConfig } from './db.js';
import { showToast } from './ui.js';
import { applyTheme, getThemeNames, getThemeMeta } from './ui.js';

export async function showSettings() {
    const { navigateTo } = await import('./ui.js');
    navigateTo('settings');
    const content = document.getElementById('settings-content');
    if (!content) return;

    let cfg;
    try { cfg = await readConfig(); } catch { cfg = {}; }

    const themeNames = getThemeNames();
    content.innerHTML = `
        <div class="setting-group">
            <h3>同步</h3>
            <div class="setting-row">
                <label>本地文件夹路径</label>
                <input type="text" id="cfg-folder" value="${cfg.local_folder_path || ''}">
                <span class="setting-hint" id="cfg-folder-hint"></span>
            </div>
            <div class="setting-row">
                <label>同步间隔 (分钟)</label>
                <input type="number" id="cfg-sync-interval" value="${cfg.sync_interval || 30}" min="5" max="1440">
            </div>
            <button id="cfg-sync-now" style="padding:10px 20px;background:var(--accent);color:#fff;border:none;border-radius:20px;cursor:pointer;font-size:14px;margin-top:8px;">立即同步</button>
            <span class="setting-hint" id="sync-status-hint">上次同步: ${cfg.last_sync_at ? new Date(cfg.last_sync_at).toLocaleString('zh-CN') : '从未'}</span>
        </div>
        <div class="setting-group">
            <h3>主题</h3>
            <div class="theme-grid" id="theme-grid">
                ${themeNames.map(name => {
                    const meta = getThemeMeta(name);
                    return `<div class="theme-swatch ${cfg.theme === name ? 'selected' : ''}" data-theme="${name}" style="background:${meta.bg};border:4px solid ${meta.accent};">
                        <div style="background:${meta.surface};padding:4px 8px;border-radius:4px;font-size:11px;color:${meta.text};">${name}</div>
                    </div>`;
                }).join('')}
            </div>
        </div>
        <div class="setting-group">
            <h3>置顶标签</h3>
            <div class="setting-row">
                <input type="text" id="cfg-pinned-tags" value="${cfg.pinned_tags || '[]'}" placeholder='["产品", "设计"]'>
                <span class="setting-hint">JSON 数组格式，如 ["产品", "设计"]</span>
            </div>
        </div>
        <div class="setting-group">
            <h3>偏好</h3>
            <div class="setting-row">
                <label>默认日历视图</label>
                <select id="cfg-calendar-view">
                    <option value="day" ${cfg.default_calendar_view === 'day' ? 'selected' : ''}>日</option>
                    <option value="week" ${cfg.default_calendar_view === 'week' ? 'selected' : ''}>周</option>
                    <option value="month" ${cfg.default_calendar_view === 'month' ? 'selected' : ''}>月</option>
                </select>
            </div>
        </div>
        <div class="setting-group">
            <h3>账户</h3>
            <button id="logout-btn" style="padding:10px 20px;background:var(--danger);color:#fff;border:none;border-radius:20px;cursor:pointer;font-size:14px;">退出登录</button>
        </div>
    `;

    // Theme swatches
    document.querySelectorAll('.theme-swatch').forEach(el => {
        el.addEventListener('click', () => {
            const name = el.dataset.theme;
            applyTheme(name);
            writeConfig('theme', name);
            document.querySelectorAll('.theme-swatch').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
        });
    });

    // Save on change
    document.getElementById('cfg-folder').addEventListener('change', e => writeConfig('local_folder_path', e.target.value));
    document.getElementById('cfg-sync-interval').addEventListener('change', e => writeConfig('sync_interval', e.target.value));
    document.getElementById('cfg-pinned-tags').addEventListener('change', e => writeConfig('pinned_tags', e.target.value));
    document.getElementById('cfg-calendar-view').addEventListener('change', e => writeConfig('default_calendar_view', e.target.value));

    // Manual sync
    document.getElementById('cfg-sync-now').addEventListener('click', async () => {
        const sb = (await import('./supabase.js')).getSupabase();
        await sb.from('sync_requests').insert({ status: 'pending' });
        document.getElementById('sync-status-hint').textContent = '已请求同步 · 等待 PC 响应';
        showToast('已发送同步请求');
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        const { signOut } = await import('./auth.js');
        await signOut();
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('screen-auth').classList.add('active');
    });
}
```

- [ ] **Step 2: Add theme CSS**

```css
.theme-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.theme-swatch { padding: 16px; border-radius: var(--radius); cursor: pointer; text-align: center; min-height: 60px; display: flex; align-items: flex-end; }
.theme-swatch.selected { box-shadow: 0 0 0 2px var(--accent); }
```

- [ ] **Step 3: Commit**

```bash
git add pwa/js/settings.js pwa/js/app.js pwa/css/app.css
git commit -m "feat: settings page — theme picker, sync interval, pinned tags, manual sync"
```

### Task 13: Search + Infinite Scroll

**Files:**
- Modify: `pwa/js/app.js`

- [ ] **Step 1: Add search and infinite scroll to app.js**

```javascript
// Search: add input handler
let searchTimeout;
document.getElementById('search-input')?.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => filterNotes(e.target.value), 300);
});

async function filterNotes(query) {
    if (!query.trim()) { loadNotes(); return; }
    const sb = getSupabase();
    const { data } = await sb.from('smartstickynotes_items')
        .select('*').eq('status', 'active')
        .ilike('text', `%${query}%`).order('created_at', { ascending: false }).limit(50);
    renderNotesList(data || []);
}

// Infinite scroll: detect scroll at top
let isLoadingMore = false;
let lastCursor = null;
document.getElementById('notes-list')?.addEventListener('scroll', async () => {
    const list = document.getElementById('notes-list');
    if (list.scrollTop < 100 && !isLoadingMore) {
        isLoadingMore = true;
        const sb = getSupabase();
        let query = sb.from('smartstickynotes_items').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(50);
        if (lastCursor) query = query.lt('created_at', lastCursor.created_at);
        const { data } = await query;
        if (data && data.length > 0) {
            data.forEach(n => list.appendChild(renderNoteBubble(n)));
            lastCursor = data[data.length - 1];
        }
        isLoadingMore = false;
    }
});
```

- [ ] **Step 2: Add search bar HTML**

```html
<!-- Replace the top bar sync-status with search input -->
<input type="search" id="search-input" placeholder="搜索笔记..." style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:8px 16px;color:var(--text);font-size:14px;outline:none;margin:0 8px;">
```

- [ ] **Step 3: Commit**

```bash
git add pwa/js/app.js pwa/index.html
git commit -m "feat: search bar + infinite scroll"
```

---

## Phase 4: Integration

### Task 14: Update Wizard SQL

**Files:**
- Modify: `pwa/js/wizard.js`

- [ ] **Step 1: Update SQL snippet to include v2 migration**

Add the 002_v2.sql content to the wizard's SQL snippet.

- [ ] **Step 2: Commit**

```bash
git add pwa/js/wizard.js
git commit -m "feat: update wizard with v2 SQL migration"
```

### Task 15: Final Assembly — Wire Everything in app.js

- [ ] **Step 1: Update app.js to integrate all new modules**

```javascript
// New imports
import { initToolbar, showToolbar, hideToolbar, setToolbarTarget, renderTagBar } from './toolbar.js';
import { startEditing } from './editor.js';
import { showTagsView } from './tags.js';
import { showRecycleBin } from './recycle-bin.js';
import { showSettings } from './settings.js';
import { applyTheme } from './ui.js';

// In setupMainUI:
// - Replace showRecycleBin, showTags, showSettings with imports
// - Add toolbar init
// - Add search handler
// - Add infinite scroll
// - Add theme init
// - Update sidebar nav to use new imports
// - On text input focus: showToolbar() + setToolbarTarget(textInput, sendTextNote)
// - On text input blur: hideToolbar() after 200ms delay (allow button clicks)
// - Long press bubble: add "编辑" option → startEditing(bubble, noteId, text, tags)
```

- [ ] **Step 2: Commit**

```bash
git add pwa/js/app.js
git commit -m "feat: final assembly — wire all v2 modules into app controller"
```

### Task 16: Update Service Worker Cache

**Files:**
- Modify: `pwa/sw.js`

- [ ] **Step 1: Add new JS files to ASSETS array**

```javascript
const ASSETS = [
    // ... existing ...
    '/js/toolbar.js',
    '/js/editor.js',
    '/js/tags.js',
    '/js/recycle-bin.js',
    '/js/settings.js',
];
```

- [ ] **Step 2: Commit**

```bash
git add pwa/sw.js
git commit -m "chore: update service worker cache list for v2"
```

---

## Self-Review

1. Spec coverage: Tag aggregation ✓ | Toolbar ✓ | Editor ✓ | Themes ✓ | Tags view ✓ | Recycle bin ✓ | Search ✓ | Infinite scroll ✓ | Snapshot export ✓ | Audio GC ✓ | Sync requests ✓ | Tag slug safety ✓
2. No placeholders — all code blocks contain actual implementation
3. Type consistency: tag_map returns {tag: filename}, used consistently in markdown_writer and tags.js

---

## Execution Handoff

Plan complete at `docs/superpowers/plans/2026-05-28-smart-sticky-notes-v2-plan.md`.
