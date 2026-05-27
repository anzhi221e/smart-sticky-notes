# Smart Sticky Notes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform sticky notes system: PWA (mobile) → Supabase (cloud relay) → PC Sync Script → local Markdown folder → AI reads.

**Architecture:** Three independent components: (1) Supabase schema + auth as foundation, (2) Python PC sync script that polls Supabase and writes Markdown files, (3) vanilla JS PWA that handles voice recording, text notes, calendar/tag views, offline queue, and settings.

**Tech Stack:** Supabase (PostgreSQL + Auth + Storage), Python 3.10+ (sync script), vanilla HTML/CSS/JS (PWA, no build tools), Web Speech API + MediaRecorder API (voice).

---

## File Structure

```
smart_sticky_notes/
├── supabase/
│   └── migrations/
│       └── 001_initial.sql
├── sync/
│   ├── requirements.txt
│   ├── config.py
│   ├── auth.py
│   ├── supabase_client.py
│   ├── sync_state.py
│   ├── markdown_writer.py
│   ├── conflict.py
│   ├── audio_downloader.py
│   ├── sync_loop.py
│   ├── tray_app.py
│   └── main.py
├── pwa/
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   ├── css/
│   │   └── app.css
│   ├── js/
│   │   ├── app.js
│   │   ├── supabase.js
│   │   ├── auth.js
│   │   ├── db.js
│   │   ├── notes.js
│   │   ├── voice.js
│   │   ├── ui.js
│   │   ├── calendar.js
│   │   ├── tags.js
│   │   ├── recycle-bin.js
│   │   ├── settings.js
│   │   ├── wizard.js
│   │   ├── offline.js
│   │   └── audio-player.js
│   └── icons/
│       └── icon-192.png
└── docs/
    └── superpowers/
        ├── specs/
        │   └── 2026-05-27-smart-sticky-notes-design.md
        └── plans/
            └── 2026-05-27-smart-sticky-notes-plan.md
```

---

## Phase 1: Foundation

### Task 1: Project Scaffolding

**Files:**
- Create: `supabase/migrations/001_initial.sql`
- Create: `sync/requirements.txt`
- Create: `pwa/index.html` (placeholder)
- Create: `pwa/manifest.json`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p supabase/migrations sync pwa/css pwa/js pwa/icons docs/superpowers/plans
```

- [ ] **Step 2: Write Supabase migration SQL**

Create `supabase/migrations/001_initial.sql`:

```sql
-- Create tables
CREATE TABLE smartstickynotes_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    type text NOT NULL CHECK (type IN ('voice', 'text')),
    text text NOT NULL DEFAULT '',
    tags text[] NOT NULL DEFAULT '{}',
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

-- RLS: smartstickynotes_items
ALTER TABLE smartstickynotes_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "items_select" ON smartstickynotes_items
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "items_insert" ON smartstickynotes_items
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "items_update" ON smartstickynotes_items
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "items_delete" ON smartstickynotes_items
    FOR DELETE USING (auth.uid() = user_id);

-- RLS: deletion_events
ALTER TABLE deletion_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deletion_select" ON deletion_events
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "deletion_insert" ON deletion_events
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "deletion_delete" ON deletion_events
    FOR DELETE USING (auth.uid() = user_id);

-- RLS: smartstickynotes_config
ALTER TABLE smartstickynotes_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "config_select" ON smartstickynotes_config
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "config_insert" ON smartstickynotes_config
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "config_update" ON smartstickynotes_config
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_items_user_status ON smartstickynotes_items(user_id, status);
CREATE INDEX idx_items_user_synced ON smartstickynotes_items(user_id, synced_at);
CREATE INDEX idx_items_user_updated ON smartstickynotes_items(user_id, updated_at);
CREATE INDEX idx_items_tags ON smartstickynotes_items USING gin(tags);
CREATE INDEX idx_deletion_user ON deletion_events(user_id);
```

- [ ] **Step 3: Write sync script requirements**

Create `sync/requirements.txt`:

```
supabase>=2.3.0
pystray>=0.19.0
keyring>=24.0.0
Pillow>=10.0.0
PyYAML>=6.0
python-dateutil>=2.8.0
```

- [ ] **Step 4: Write PWA manifest**

Create `pwa/manifest.json`:

```json
{
  "name": "Smart Sticky Notes",
  "short_name": "Notes",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f0f0f",
  "theme_color": "#0f0f0f",
  "icons": [
    {
      "src": "icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    }
  ]
}
```

- [ ] **Step 5: Create placeholder icon**

Create a minimal 192x192 PNG using Python:

```bash
python -c "
import struct, zlib
def create_png(w, h, color):
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    raw = b''
    for y in range(h):
        raw += b'\x00' + bytes(color) * w
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
with open('pwa/icons/icon-192.png', 'wb') as f:
    f.write(create_png(192, 192, (60, 60, 60)))
"
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: project scaffolding — SQL migration, requirements, PWA manifest"
```

---

## Phase 2: PC Sync Script

### Task 2: Sync Script — Config Reader

**Files:**
- Create: `sync/config.py`
- Create: `sync/supabase_client.py`

- [ ] **Step 1: Write Supabase client wrapper**

Create `sync/supabase_client.py`:

```python
"""Supabase client factory. Reads URL and anon key from environment."""
import os
from supabase import create_client, Client

def get_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_ANON_KEY must be set")
    return create_client(url, key)
```

- [ ] **Step 2: Write config reader**

Create `sync/config.py`:

```python
"""Read user config from Supabase smartstickynotes_config table."""
from supabase_client import get_client

DEFAULT_CONFIG = {
    "local_folder_path": "",
    "filename_template": "{date}_{time}_{type}_{id}",
    "default_calendar_view": "month",
}

def read_config() -> dict:
    client = get_client()
    rows = client.table("smartstickynotes_config").select("key, value").execute()
    cfg = dict(DEFAULT_CONFIG)
    for row in rows.data:
        cfg[row["key"]] = row["value"]
    return cfg

def get_config_last_updated() -> str | None:
    client = get_client()
    rows = client.table("smartstickynotes_config").select("updated_at").order("updated_at", desc=True).limit(1).execute()
    if rows.data:
        return rows.data[0]["updated_at"]
    return None
```

- [ ] **Step 3: Commit**

```bash
git add sync/supabase_client.py sync/config.py
git commit -m "feat: sync script config reader"
```

### Task 3: Sync Script — Auth Module

**Files:**
- Create: `sync/auth.py`

- [ ] **Step 1: Write auth module**

Create `sync/auth.py`:

```python
"""Manage Supabase auth for headless PC sync script.

On first run, opens browser for OAuth/magic link login.
Stores refresh_token in Windows Credential Manager via keyring.
Auto-refreshes session JWT before expiry.
"""
import os
import webbrowser
import time
import keyring
from supabase_client import get_client

SERVICE_NAME = "SmartStickyNotes"
ACCOUNT_NAME = "supabase_refresh_token"

def _store_token(token: str) -> None:
    keyring.set_password(SERVICE_NAME, ACCOUNT_NAME, token)

def _get_stored_token() -> str | None:
    return keyring.get_password(SERVICE_NAME, ACCOUNT_NAME)

def _delete_stored_token() -> None:
    try:
        keyring.delete_password(SERVICE_NAME, ACCOUNT_NAME)
    except keyring.errors.PasswordDeleteError:
        pass

def login() -> bool:
    """Open browser for OAuth login. Returns True if successful."""
    client = get_client()
    url = os.environ.get("SUPABASE_URL", "")
    anon_key = os.environ.get("SUPABASE_ANON_KEY", "")

    print(f"Opening browser for login: {url}")
    print("After login, paste the access_token from the URL or Supabase dashboard.")

    # For magic link / OAuth flow: we open the browser and ask the user to paste the token
    webbrowser.open(f"{url}/auth/v1/authorize?provider=email&redirect_to=http://localhost:9999/callback")

    token = input("Paste your refresh_token: ").strip()
    if token:
        _store_token(token)
        _set_session(token)
        return True
    return False

def _set_session(refresh_token: str) -> None:
    client = get_client()
    try:
        resp = client.auth.refresh_session(refresh_token)
        _store_token(resp.session.refresh_token)
    except Exception:
        raise RuntimeError("Failed to refresh session. Token may be expired. Run login again.")

def ensure_session() -> None:
    """Ensure we have a valid session. Call on startup and before each poll cycle."""
    client = get_client()
    try:
        # Try to get current session
        session = client.auth.get_session()
        if session and session.expires_at and session.expires_at > time.time() + 300:
            return  # Session valid for at least 5 more minutes
    except Exception:
        pass

    # Try to refresh using stored token
    token = _get_stored_token()
    if token:
        try:
            _set_session(token)
            return
        except Exception:
            _delete_stored_token()

    # Need re-login
    raise RuntimeError("Not authenticated. Run login().")

def logout() -> None:
    _delete_stored_token()
    client = get_client()
    try:
        client.auth.sign_out()
    except Exception:
        pass
```

- [ ] **Step 2: Commit**

```bash
git add sync/auth.py
git commit -m "feat: sync script auth module with Windows Credential Manager"
```

### Task 4: Sync Script — Sync State Manager

**Files:**
- Create: `sync/sync_state.py`

- [ ] **Step 1: Write sync state manager**

Create `sync/sync_state.py`:

```python
"""Manage .sync_state.json — the PC sync script's local state file."""
import json
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Any

class SyncState:
    def __init__(self, folder_path: str):
        self.path = Path(folder_path) / ".sync_state.json"
        self.data: dict[str, Any] = {
            "last_sync_cursor": None,
            "notes": {},
            "local_missing": {},
            "audio_download_retries": {},
            "config_last_updated": None,
        }
        self._load()

    def _load(self) -> None:
        if self.path.exists():
            with open(self.path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                self.data.update(loaded)

    def save(self) -> None:
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=2, ensure_ascii=False)

    def get_cursor(self) -> str | None:
        return self.data.get("last_sync_cursor")

    def set_cursor(self, cursor: str) -> None:
        self.data["last_sync_cursor"] = cursor

    def get_note_state(self, note_id: str) -> dict | None:
        return self.data["notes"].get(note_id)

    def set_note_state(self, note_id: str, local_path: str,
                       remote_updated_at: str, remote_content_hash: str) -> None:
        self.data["notes"][note_id] = {
            "local_path": local_path,
            "last_remote_updated_at": remote_updated_at,
            "last_remote_content_hash": remote_content_hash,
            "last_written_local_hash": "",
        }

    def set_written_local_hash(self, note_id: str, file_hash: str) -> None:
        if note_id in self.data["notes"]:
            self.data["notes"][note_id]["last_written_local_hash"] = file_hash

    def remove_note(self, note_id: str) -> None:
        self.data["notes"].pop(note_id, None)
        self.data["local_missing"].pop(note_id, None)
        self.data["audio_download_retries"].pop(note_id, None)

    def get_local_missing(self, note_id: str) -> dict | None:
        return self.data["local_missing"].get(note_id)

    def set_local_missing(self, note_id: str) -> dict:
        now = datetime.now().isoformat()
        existing = self.data["local_missing"].get(note_id, {})
        entry = {
            "first_detected": existing.get("first_detected", now),
            "last_detected": now,
            "detection_count": existing.get("detection_count", 0) + 1,
        }
        self.data["local_missing"][note_id] = entry
        return entry

    def clear_local_missing(self, note_id: str) -> None:
        self.data["local_missing"].pop(note_id, None)

    def get_audio_retries(self, note_id: str) -> dict:
        return self.data["audio_download_retries"].get(note_id, {"retries": 0})

    def increment_audio_retries(self, note_id: str) -> int:
        entry = self.get_audio_retries(note_id)
        entry["retries"] += 1
        entry["last_attempt"] = datetime.now().isoformat()
        self.data["audio_download_retries"][note_id] = entry
        return entry["retries"]

    def clear_audio_retries(self, note_id: str) -> None:
        self.data["audio_download_retries"].pop(note_id, None)

    def get_config_last_updated(self) -> str | None:
        return self.data.get("config_last_updated")

    def set_config_last_updated(self, timestamp: str) -> None:
        self.data["config_last_updated"] = timestamp

def compute_hash(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]

def compute_file_hash(path: Path) -> str:
    with open(path, "rb") as f:
        return "sha256:" + hashlib.sha256(f.read()).hexdigest()[:16]
```

- [ ] **Step 2: Commit**

```bash
git add sync/sync_state.py
git commit -m "feat: sync state manager with hash tracking and missing file detection"
```

### Task 5: Sync Script — Markdown Writer

**Files:**
- Create: `sync/markdown_writer.py`

- [ ] **Step 1: Write markdown writer**

Create `sync/markdown_writer.py`:

```python
"""Generate Markdown files with YAML frontmatter for synced notes."""
import yaml
from pathlib import Path
from datetime import datetime

def _parse_template(template: str, note: dict) -> str:
    """Replace template variables with actual values."""
    created = datetime.fromisoformat(note["created_at"].replace("Z", "+00:00"))
    short_id = note["id"][:8]
    result = template
    result = result.replace("{id}", short_id)
    result = result.replace("{date}", created.strftime("%Y-%m-%d"))
    result = result.replace("{time}", created.strftime("%H%M%S"))
    result = result.replace("{type}", note.get("type", "text"))
    if note.get("tags") and len(note["tags"]) > 0:
        result = result.replace("{tag}", note["tags"][0])
    else:
        result = result.replace("{tag}", "note")
    # Ensure {id} is present
    if "{id}" not in template and short_id not in result:
        result = f"{result}_{short_id}"
    return result

def make_frontmatter(note: dict, remote_content_hash: str) -> str:
    """Generate YAML frontmatter block."""
    created = note.get("created_at", "")
    if created:
        try:
            dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
            display_time = dt.strftime("%Y-%m-%d %H:%M")
        except (ValueError, AttributeError):
            display_time = created
    else:
        display_time = ""

    frontmatter = {
        "id": note["id"],
        "type": note.get("type", "text"),
        "created_at": created,
        "updated_at": note.get("updated_at", created),
        "status": note.get("status", "active"),
        "tags": note.get("tags", []),
        "remote_hash": remote_content_hash,
    }
    if note.get("audio_path"):
        note_id_short = note["id"][:8]
        frontmatter["audio"] = f"../audio/{note_id_short}.opus"
    if note.get("audio_duration"):
        frontmatter["audio_duration"] = note["audio_duration"]

    yaml_block = yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False, sort_keys=False)
    return f"---\n{yaml_block}---\n\n# {display_time}\n\n{note.get('text', '')}\n"

def make_audio_footer(note: dict) -> str:
    """Generate audio link footer for voice notes."""
    note_id_short = note["id"][:8]
    duration = note.get("audio_duration", 0)
    mins, secs = divmod(duration, 60) if duration else (0, 0)
    duration_str = f"({mins}:{secs:02d})" if duration else ""
    return f"\n> [收听录音](../audio/{note_id_short}.opus) {duration_str}\n"

def write_note(note: dict, folder: str, template: str, remote_content_hash: str) -> str:
    """Write a note as a Markdown file. Returns the relative path of the created file."""
    active_dir = Path(folder) / "active"
    active_dir.mkdir(parents=True, exist_ok=True)

    filename = _parse_template(template, note) + ".md"
    filepath = active_dir / filename

    content = make_frontmatter(note, remote_content_hash)
    if note.get("type") == "voice" and note.get("audio_path"):
        content += make_audio_footer(note)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)

    return f"active/{filename}"

def move_to_trash(note_id: str, folder: str, local_path: str) -> str | None:
    """Move a file from active/ to trash/. Returns new path or None."""
    src = Path(folder) / local_path
    if not src.exists():
        return None
    trash_dir = Path(folder) / "trash"
    trash_dir.mkdir(parents=True, exist_ok=True)
    dst = trash_dir / f"_deleted_{src.name}"
    src.rename(dst)
    return f"trash/{dst.name}"

def move_to_active(note_id: str, folder: str, trash_path: str) -> str | None:
    """Move a file from trash/ back to active/. Returns new path or None."""
    src = Path(folder) / trash_path
    if not src.exists():
        return None
    active_dir = Path(folder) / "active"
    active_dir.mkdir(parents=True, exist_ok=True)
    # Remove _deleted_ prefix
    new_name = src.name.replace("_deleted_", "", 1) if src.name.startswith("_deleted_") else src.name
    dst = active_dir / new_name
    src.rename(dst)
    return f"active/{dst.name}"

def delete_local_files(note_id: str, folder: str, local_path: str | None) -> None:
    """Delete .md file and audio file for a permanently-deleted note."""
    note_id_short = note_id[:8]
    if local_path:
        md_file = Path(folder) / local_path
        if md_file.exists():
            md_file.unlink()
    # Also check trash
    trash_dir = Path(folder) / "trash"
    if trash_dir.exists():
        for f in trash_dir.iterdir():
            if note_id_short in f.name:
                f.unlink()
    # Delete audio
    audio_dir = Path(folder) / "audio"
    audio_file = audio_dir / f"{note_id_short}.opus"
    if audio_file.exists():
        audio_file.unlink()
```

- [ ] **Step 2: Commit**

```bash
git add sync/markdown_writer.py
git commit -m "feat: markdown writer with YAML frontmatter and trash management"
```

### Task 6: Sync Script — Conflict Detector

**Files:**
- Create: `sync/conflict.py`

- [ ] **Step 1: Write conflict detector**

Create `sync/conflict.py`:

```python
"""Hash-based conflict detection for sync operations."""
from pathlib import Path
from sync_state import compute_file_hash

class ConflictResult:
    OVERWRITE = "overwrite"       # Local unchanged, safe to overwrite
    SKIP_LOCAL_WINS = "skip"      # Local edited, Supabase unchanged — keep local
    COLLISION = "collision"       # Both changed — write conflict copy
    MISSING = "missing"           # Local file doesn't exist

def detect(file_path: Path, note_id: str, sync_state) -> str:
    """Detect conflict state between local file and remote note.

    Returns one of: overwrite, skip, collision, missing
    """
    note_state = sync_state.get_note_state(note_id)
    if note_state is None:
        # Never synced before — no conflict possible
        return ConflictResult.OVERWRITE if file_path.exists() else ConflictResult.MISSING

    if not file_path.exists():
        return ConflictResult.MISSING

    last_written_hash = note_state.get("last_written_local_hash", "")
    last_remote_hash = note_state.get("last_remote_content_hash", "")

    current_local_hash = compute_file_hash(file_path)

    if current_local_hash == last_written_hash:
        # Local file unchanged since last sync → safe to overwrite
        return ConflictResult.OVERWRITE

    # Local file has been modified since last sync
    # Check if remote also changed (caller provides new remote hash)
    # This is resolved in the sync loop where we have both hashes
    return ConflictResult.SKIP_LOCAL_WINS  # Default: local wins; caller overrides for collision

def resolve(current_local_hash: str, last_written_hash: str,
            new_remote_hash: str, last_remote_hash: str) -> str:
    """Full resolution when we have both old and new hashes.

    Returns: overwrite, skip, collision
    """
    local_changed = (current_local_hash != last_written_hash) if last_written_hash else False
    remote_changed = (new_remote_hash != last_remote_hash) if last_remote_hash else False

    if not local_changed and not remote_changed:
        return ConflictResult.OVERWRITE  # Neither changed, safe overwrite (idempotent)
    if local_changed and not remote_changed:
        return ConflictResult.SKIP_LOCAL_WINS  # Only local changed
    if not local_changed and remote_changed:
        return ConflictResult.OVERWRITE  # Only remote changed, safe to pull
    # Both changed
    return ConflictResult.COLLISION
```

- [ ] **Step 2: Commit**

```bash
git add sync/conflict.py
git commit -m "feat: hash-based conflict detection for sync"
```

### Task 7: Sync Script — Audio Downloader

**Files:**
- Create: `sync/audio_downloader.py`

- [ ] **Step 1: Write audio downloader**

Create `sync/audio_downloader.py`:

```python
"""Download audio files from Supabase Storage to local audio/ directory."""
from pathlib import Path
from supabase_client import get_client

MAX_RETRIES = 3

def download(note_id: str, audio_path: str, folder: str, sync_state) -> bool:
    """Download audio file from Supabase Storage.

    Returns True on success, False on failure.
    audio_path format: {user_id}/{note_id}.opus
    """
    note_id_short = note_id[:8]
    audio_dir = Path(folder) / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    dest = audio_dir / f"{note_id_short}.opus"

    if dest.exists():
        sync_state.clear_audio_retries(note_id)
        return True

    retries = sync_state.get_audio_retries(note_id)
    if retries.get("retries", 0) >= MAX_RETRIES:
        return False

    try:
        client = get_client()
        with open(dest, "wb") as f:
            res = client.storage.from_("smartstickynotes_audio").download(audio_path)
            f.write(res)
        sync_state.clear_audio_retries(note_id)
        return True
    except Exception:
        sync_state.increment_audio_retries(note_id)
        return False
```

- [ ] **Step 2: Commit**

```bash
git add sync/audio_downloader.py
git commit -m "feat: audio downloader with retry tracking"
```

### Task 8: Sync Script — Main Sync Loop

**Files:**
- Create: `sync/sync_loop.py`

- [ ] **Step 1: Write sync loop**

Create `sync/sync_loop.py`:

```python
"""Main sync loop: poll Supabase, detect changes, write Markdown files."""
from datetime import datetime, timezone
from pathlib import Path
import time

from supabase_client import get_client
from config import read_config, get_config_last_updated
from sync_state import SyncState, compute_hash
from markdown_writer import write_note, move_to_trash, move_to_active, delete_local_files
from conflict import ConflictResult, resolve as resolve_conflict
from audio_downloader import download as download_audio

MISSING_THRESHOLD = 3  # Consecutive detections before prompting user to delete

class SyncLoop:
    def __init__(self, on_alert=None):
        self.on_alert = on_alert or (lambda level, msg: print(f"[{level.upper()}] {msg}"))
        self.running = False

    def stop(self):
        self.running = False

    def run_once(self) -> dict:
        """Execute one sync cycle. Returns stats dict."""
        client = get_client()
        config = read_config()
        folder = config.get("local_folder_path", "")
        if not folder:
            self.on_alert("warning", "No folder configured. Skipping sync.")
            return {"status": "no_folder"}

        folder_path = Path(folder)
        if not folder_path.exists() or not folder_path.is_dir():
            self.on_alert("error", f"Folder not accessible: {folder}")
            return {"status": "folder_inaccessible"}

        state = SyncState(folder)
        template = config.get("filename_template", "{date}_{time}_{type}_{id}")
        cursor = state.get_cursor()
        stats = {"created": 0, "updated": 0, "deleted": 0, "restored": 0, "purged": 0, "skipped": 0, "conflicts": 0, "missing": 0, "errors": 0}

        # --- Fetch changed notes ---
        query = client.table("smartstickynotes_items").select("*")
        if cursor:
            query = query.or_(f"synced_at.is.null,updated_at.gt.{cursor}")
        else:
            query = query.is_("synced_at", "null")
        result = query.execute()

        for note in result.data:
            note_id = note["id"]
            status = note.get("status", "active")
            remote_hash = compute_hash(note.get("text", ""))

            try:
                if status == "active":
                    self._handle_active(note, note_id, remote_hash, state, folder, template, stats)
                elif status == "deleted":
                    self._handle_deleted(note, note_id, state, folder, stats)
            except Exception as e:
                self.on_alert("error", f"Error processing note {note_id[:8]}: {e}")
                stats["errors"] += 1

        # --- Fetch deletion events ---
        del_result = client.table("deletion_events").select("*").execute()
        for event in del_result.data:
            self._handle_purge(event, state, folder, stats)
            client.table("deletion_events").delete().eq("id", event["id"]).execute()

        # --- Update cursor ---
        state.set_cursor(datetime.now(timezone.utc).isoformat())
        state.save()
        return stats

    def _handle_active(self, note, note_id, remote_hash, state, folder, template, stats):
        note_state = state.get_note_state(note_id)
        note_id_short = note_id[:8]
        local_path = note_state["local_path"] if note_state else None
        expected_path = Path(folder) / (local_path or "")

        if not expected_path.exists():
            if note_state and note.get("synced_at"):
                # File existed before but is now missing
                entry = state.set_local_missing(note_id)
                count = entry["detection_count"]
                if count >= MISSING_THRESHOLD:
                    self.on_alert("warning", f"File missing for {count} cycles: {note_id_short}. Prompting user.")
                else:
                    self.on_alert("warning", f"Local file missing: {note_id_short} (detection {count}/{MISSING_THRESHOLD})")
                state.save()
                stats["missing"] += 1
                return

        if note_state and expected_path.exists():
            current_local_hash = state.get_note_state(note_id).get("last_written_local_hash", "")
            # Recompute current local hash
            from sync_state import compute_file_hash
            current_local_hash = compute_file_hash(expected_path)
            last_written = note_state.get("last_written_local_hash", "")
            last_remote = note_state.get("last_remote_content_hash", "")

            result = resolve_conflict(current_local_hash, last_written, remote_hash, last_remote)
            if result == ConflictResult.COLLISION:
                conflict_path = expected_path.with_suffix(".conflict.md")
                with open(conflict_path, "w", encoding="utf-8") as f:
                    f.write(f"# CONFLICT — both local and remote changed\nRemote version saved here.\n")
                stats["conflicts"] += 1
                return
            elif result == ConflictResult.SKIP_LOCAL_WINS:
                stats["skipped"] += 1
                return

        # Write note
        rel_path = write_note(note, folder, template, remote_hash)
        written_path = Path(folder) / rel_path
        from sync_state import compute_file_hash
        written_hash = compute_file_hash(written_path)

        # Download audio if voice note
        if note.get("type") == "voice" and note.get("audio_path"):
            ok = download_audio(note_id, note["audio_path"], folder, state)
            if not ok:
                retries = state.get_audio_retries(note_id).get("retries", 0)
                if retries >= 3:
                    # Append failure marker to markdown
                    with open(written_path, "a", encoding="utf-8") as f:
                        f.write("\n[音频下载失败]\n")
                    self.on_alert("error", f"Audio download failed after 3 retries: {note_id_short}")

        state.set_note_state(note_id, rel_path, note.get("updated_at", ""), remote_hash)
        state.set_written_local_hash(note_id, written_hash)
        state.clear_local_missing(note_id)

        # Mark synced
        client = get_client()
        client.table("smartstickynotes_items").update({"synced_at": datetime.now(timezone.utc).isoformat()}).eq("id", note_id).execute()

        if note_state and note_state.get("last_written_local_hash"):
            stats["updated"] += 1
        else:
            stats["created"] += 1

    def _handle_deleted(self, note, note_id, state, folder, stats):
        note_state = state.get_note_state(note_id)
        if note_state:
            local_path = note_state["local_path"]
            # Move to trash
            new_path = move_to_trash(note_id, folder, local_path)
            if new_path:
                state.set_note_state(note_id, new_path, note.get("updated_at", ""),
                                     note_state.get("last_remote_content_hash", ""))
            # Mark synced
            client = get_client()
            client.table("smartstickynotes_items").update({"synced_at": datetime.now(timezone.utc).isoformat()}).eq("id", note_id).execute()
            stats["deleted"] += 1
        # If restored: status back to active but note in trash
        # Handled by _handle_active when status changes back

    def _handle_purge(self, event, state, folder, stats):
        note_id = event["note_id"]
        note_state = state.get_note_state(note_id)
        local_path = note_state["local_path"] if note_state else None
        delete_local_files(note_id, folder, local_path)
        state.remove_note(note_id)
        stats["purged"] += 1

def run_sync_loop(interval_seconds: int = 300, on_alert=None):
    """Run sync in a loop with configurable interval."""
    loop = SyncLoop(on_alert=on_alert)
    loop.running = True
    while loop.running:
        try:
            stats = loop.run_once()
            if on_alert and stats.get("status") not in ("no_folder", "folder_inaccessible"):
                total = sum(v for k, v in stats.items() if isinstance(v, int))
                if total > 0:
                    on_alert("info", f"Sync: {stats}")
        except Exception as e:
            if on_alert:
                on_alert("error", f"Sync cycle failed: {e}")
        time.sleep(interval_seconds)
```

- [ ] **Step 2: Commit**

```bash
git add sync/sync_loop.py
git commit -m "feat: main sync loop with conflict detection and deletion handling"
```

### Task 9: Sync Script — System Tray

**Files:**
- Create: `sync/tray_app.py`
- Create: `sync/main.py`

- [ ] **Step 1: Write system tray app**

Create `sync/tray_app.py`:

```python
"""Windows system tray icon for the sync script."""
import threading
from pathlib import Path
try:
    import pystray
    from PIL import Image, ImageDraw
    HAS_TRAY = True
except ImportError:
    HAS_TRAY = False

class TrayApp:
    def __init__(self, sync_loop, folder_path: str):
        self.sync_loop = sync_loop
        self.folder_path = folder_path
        self.icon = None
        self.status = "idle"  # idle, syncing, error

    def _create_icon_image(self, color: str):
        size = 64
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        colors = {"green": (0, 200, 100), "orange": (255, 165, 0), "red": (220, 50, 50), "grey": (128, 128, 128)}
        c = colors.get(color, colors["grey"])
        # Draw a simple square with rounded corners
        margin = 12
        draw.rounded_rectangle([margin, margin, size - margin, size - margin], radius=12, fill=c)
        return img

    def _set_status(self, status: str):
        self.status = status
        if self.icon and HAS_TRAY:
            color = {"idle": "green", "syncing": "orange", "error": "red"}.get(status, "grey")
            self.icon.icon = self._create_icon_image(color)

    def _open_folder(self):
        import subprocess
        subprocess.Popen(['explorer', self.folder_path])

    def _force_sync(self):
        self._set_status("syncing")
        try:
            stats = self.sync_loop.run_once()
            self._set_status("idle")
        except Exception:
            self._set_status("error")

    def _create_menu(self):
        if not HAS_TRAY:
            return None
        return pystray.Menu(
            pystray.MenuItem("Force Sync Now", lambda: self._force_sync()),
            pystray.MenuItem("Open Notes Folder", lambda: self._open_folder()),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Exit", lambda: self.stop()),
        )

    def run(self):
        if not HAS_TRAY:
            print("pystray not available, running without system tray")
            return

        self.icon = pystray.Icon(
            "smartstickynotes",
            self._create_icon_image("green"),
            "Smart Sticky Notes",
            menu=self._create_menu(),
        )
        self._set_status("idle")
        self.icon.run()

    def stop(self):
        self.sync_loop.stop()
        if self.icon and HAS_TRAY:
            self.icon.stop()
```

- [ ] **Step 2: Write main entry point**

Create `sync/main.py`:

```python
"""Main entry point for PC Sync Script."""
import sys
import os
import threading
from pathlib import Path

from sync_loop import SyncLoop, run_sync_loop
from tray_app import TrayApp, HAS_TRAY
from auth import ensure_session, login as do_login
from config import read_config


def on_alert(level: str, msg: str):
    prefix = {"error": "[ERROR]", "warning": "[WARN]", "info": "[INFO]"}
    print(f"{prefix.get(level, '[?]')} {msg}")


def main():
    # Ensure environment variables are set
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_ANON_KEY"):
        print("Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.")
        print("Usage: SUPABASE_URL=<url> SUPABASE_ANON_KEY=<key> python main.py")
        sys.exit(1)

    # Authenticate
    try:
        ensure_session()
    except RuntimeError:
        print("Not authenticated. Starting login flow...")
        if not do_login():
            print("Login failed.")
            sys.exit(1)

    # Read config
    config = read_config()
    folder = config.get("local_folder_path", "")
    if not folder:
        print("No local folder configured. Set it in PWA settings first.")
        sys.exit(1)

    # Create sync loop
    loop = SyncLoop(on_alert=on_alert)

    if HAS_TRAY:
        # Run sync in background thread, tray in main thread
        sync_thread = threading.Thread(
            target=run_sync_loop,
            kwargs={"interval_seconds": 300, "on_alert": on_alert},
            daemon=True,
        )
        sync_thread.start()
        tray = TrayApp(loop, folder)
        tray.run()
    else:
        # Headless mode
        run_sync_loop(interval_seconds=300, on_alert=on_alert)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Commit**

```bash
git add sync/tray_app.py sync/main.py
git commit -m "feat: system tray app and main entry point"
```

---

## Phase 3: PWA

### Task 10: PWA Shell — HTML + CSS Foundation

**Files:**
- Create: `pwa/index.html`
- Create: `pwa/css/app.css`

- [ ] **Step 1: Write PWA HTML shell**

Create `pwa/index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <meta name="theme-color" content="#0f0f0f">
    <link rel="manifest" href="manifest.json">
    <link rel="stylesheet" href="css/app.css">
    <title>Smart Sticky Notes</title>
</head>
<body>
    <div id="app">
        <!-- Auth screen -->
        <div id="screen-auth" class="screen hidden">
            <div class="auth-container">
                <h1>Smart Sticky Notes</h1>
                <p class="subtitle">随时随地记录，自动汇总整理</p>
                <form id="login-form">
                    <input type="email" id="email-input" placeholder="输入邮箱地址" required autocomplete="email">
                    <button type="submit" id="login-btn">发送登录链接</button>
                </form>
                <p id="login-msg" class="msg hidden"></p>
            </div>
        </div>

        <!-- Setup wizard -->
        <div id="screen-wizard" class="screen hidden">
            <div class="wizard-container">
                <div id="wizard-steps"></div>
            </div>
        </div>

        <!-- Main chat view -->
        <div id="screen-main" class="screen hidden">
            <header class="top-bar">
                <button id="menu-toggle" class="icon-btn" aria-label="菜单">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                </button>
                <span class="sync-status" id="sync-status">已同步</span>
                <button id="calendar-toggle" class="icon-btn" aria-label="日历">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                </button>
            </header>

            <div id="notes-list" class="notes-list"></div>

            <footer class="bottom-bar">
                <div class="input-row">
                    <input type="text" id="text-input" placeholder="输入文字..." autocomplete="off">
                    <button id="mic-btn" class="icon-btn mic-btn" aria-label="录音">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="1" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                    </button>
                    <button id="send-btn" class="icon-btn send-btn hidden" aria-label="发送">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </button>
                </div>
            </footer>
        </div>

        <!-- Calendar view -->
        <div id="screen-calendar" class="screen hidden">
            <header class="top-bar">
                <button id="calendar-back" class="icon-btn" aria-label="返回">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <div class="calendar-tabs">
                    <button class="cal-tab active" data-view="day">日</button>
                    <button class="cal-tab" data-view="week">周</button>
                    <button class="cal-tab" data-view="month">月</button>
                    <button class="cal-tab" data-view="year">年</button>
                </div>
                <button id="cal-today" class="icon-btn">今天</button>
            </header>
            <div id="calendar-content" class="calendar-content"></div>
        </div>

        <!-- Sidebar -->
        <div id="sidebar" class="sidebar hidden">
            <div class="sidebar-header">
                <h2>菜单</h2>
                <button id="sidebar-close" class="icon-btn" aria-label="关闭">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <nav class="sidebar-nav">
                <button class="nav-item" data-screen="main">全部笔记</button>
                <button class="nav-item" data-screen="recycle-bin">回收站</button>
                <button class="nav-item" data-screen="tags">标签</button>
                <button class="nav-item" data-screen="settings">设置</button>
            </nav>
        </div>

        <!-- Recycle bin view -->
        <div id="screen-recycle-bin" class="screen hidden">
            <header class="top-bar">
                <button id="trash-back" class="icon-btn" aria-label="返回">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <h2>回收站</h2>
                <span></span>
            </header>
            <div id="trash-list" class="notes-list"></div>
        </div>

        <!-- Tags view -->
        <div id="screen-tags" class="screen hidden">
            <header class="top-bar">
                <button id="tags-back" class="icon-btn" aria-label="返回">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <h2>标签</h2>
                <span></span>
            </header>
            <div id="tags-content" class="tags-content"></div>
        </div>

        <!-- Settings view -->
        <div id="screen-settings" class="screen hidden">
            <header class="top-bar">
                <button id="settings-back" class="icon-btn" aria-label="返回">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <h2>设置</h2>
                <span></span>
            </header>
            <div id="settings-content" class="settings-content"></div>
        </div>

        <!-- Toast container -->
        <div id="toast-container" class="toast-container"></div>
    </div>

    <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write CSS**

Create `pwa/css/app.css`:

```css
:root {
    --bg: #0f0f0f;
    --surface: #1a1a1a;
    --surface-hover: #242424;
    --border: #2a2a2a;
    --text: #e8e8e8;
    --text-secondary: #888;
    --accent: #6c8cff;
    --accent-dim: rgba(108, 140, 255, 0.15);
    --danger: #e05555;
    --radius: 12px;
    --radius-sm: 8px;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
    height: 100%;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    overscroll-behavior: none;
}

#app {
    max-width: 600px;
    margin: 0 auto;
    height: 100%;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
}

.screen { display: none; flex-direction: column; height: 100%; }
.screen.active { display: flex; }

/* Top bar */
.top-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid var(--border);
    background: var(--bg); min-height: 52px;
}
.top-bar h2 { font-size: 17px; font-weight: 600; }
.sync-status { font-size: 12px; color: var(--text-secondary); }

/* Icon buttons */
.icon-btn {
    background: none; border: none; color: var(--text);
    width: 40px; height: 40px; display: flex; align-items: center;
    justify-content: center; border-radius: 50%; cursor: pointer;
    transition: background 0.15s;
}
.icon-btn:hover { background: var(--surface-hover); }
.icon-btn:active { background: var(--border); }
.icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }

/* Notes list */
.notes-list {
    flex: 1; overflow-y: auto; padding: 16px;
    display: flex; flex-direction: column; gap: 8px;
    -webkit-overflow-scrolling: touch;
}

/* Chat bubbles */
.note-bubble {
    background: var(--surface); border-radius: var(--radius);
    padding: 14px 16px; max-width: 90%; align-self: flex-end;
    position: relative; cursor: pointer;
    transition: transform 0.2s;
    border: 1px solid var(--border);
}
.note-bubble.swiping { transform: translateX(-80px); }
.note-bubble .note-text { font-size: 15px; white-space: pre-wrap; word-break: break-word; }
.note-bubble .note-meta {
    font-size: 11px; color: var(--text-secondary);
    margin-top: 6px; display: flex; gap: 8px; align-items: center;
}
.note-bubble .note-tag {
    background: var(--accent-dim); color: var(--accent);
    padding: 1px 8px; border-radius: 10px; font-size: 12px;
    text-decoration: none; cursor: pointer;
}

/* Audio player (inline in bubble) */
.audio-player {
    margin-top: 8px; display: flex; align-items: center; gap: 10px;
    background: var(--bg); border-radius: var(--radius-sm); padding: 8px 12px;
}
.audio-player button { background: none; border: none; color: var(--text); cursor: pointer; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; }
.audio-player .progress-bar {
    flex: 1; height: 4px; background: var(--border); border-radius: 2px;
    position: relative; cursor: pointer;
}
.audio-player .progress-fill { height: 100%; background: var(--accent); border-radius: 2px; width: 0%; }
.audio-player .time-display { font-size: 11px; color: var(--text-secondary); min-width: 32px; }
.audio-player .speed-btn { font-size: 11px; color: var(--accent); background: var(--accent-dim); border-radius: 4px; padding: 2px 6px; }

/* Bottom bar */
.bottom-bar { padding: 12px 16px 20px; border-top: 1px solid var(--border); background: var(--bg); }
.input-row { display: flex; gap: 8px; align-items: center; }
#text-input {
    flex: 1; background: var(--surface); border: 1px solid var(--border);
    border-radius: 24px; padding: 12px 20px; color: var(--text);
    font-size: 15px; font-family: var(--font); outline: none;
    transition: border-color 0.15s;
}
#text-input:focus { border-color: var(--accent); }

/* Calendar */
.calendar-tabs { display: flex; gap: 4px; }
.cal-tab {
    background: none; border: 1px solid var(--border); color: var(--text-secondary);
    padding: 6px 14px; border-radius: 16px; font-size: 13px; cursor: pointer;
}
.cal-tab.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.calendar-content { flex: 1; overflow-y: auto; padding: 16px; }

/* Month grid */
.month-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }
.month-grid .day-header { font-size: 11px; color: var(--text-secondary); padding: 8px 0; }
.month-grid .day-cell {
    padding: 10px 0; border-radius: var(--radius-sm); cursor: pointer;
    font-size: 14px; position: relative;
}
.month-grid .day-cell:hover { background: var(--surface-hover); }
.month-grid .day-cell.today { background: var(--accent-dim); color: var(--accent); font-weight: 600; }
.month-grid .day-cell.has-notes::after { content: ''; display: block; width: 5px; height: 5px; background: var(--accent); border-radius: 50%; margin: 3px auto 0; }

/* Year cards */
.year-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 8px; }
.year-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 16px; cursor: pointer; text-align: center;
}
.year-card:hover { background: var(--surface-hover); }
.year-card .month-name { font-size: 14px; font-weight: 600; }
.year-card .note-count { font-size: 24px; color: var(--accent); margin-top: 4px; }

/* Week grid */
.week-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }
.week-grid .week-day { padding: 12px 4px; cursor: pointer; border-radius: var(--radius-sm); font-size: 13px; }
.week-grid .week-day:hover { background: var(--surface-hover); }
.week-grid .week-day.selected { background: var(--accent); color: #fff; }
.week-grid .week-day.has-notes { font-weight: 600; }

/* Sidebar */
.sidebar {
    position: fixed; top: 0; left: 0; width: 280px; height: 100%;
    background: var(--surface); z-index: 100; display: flex; flex-direction: column;
    border-right: 1px solid var(--border);
    transform: translateX(-100%); transition: transform 0.25s ease;
}
.sidebar.open { transform: translateX(0); }
.sidebar-header { display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid var(--border); }
.sidebar-nav { flex: 1; padding: 8px; }
.nav-item {
    display: block; width: 100%; text-align: left; padding: 14px 16px;
    background: none; border: none; color: var(--text); font-size: 15px;
    border-radius: var(--radius-sm); cursor: pointer;
}
.nav-item:hover { background: var(--surface-hover); }

/* Toast */
.toast-container { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 200; display: flex; flex-direction: column; gap: 8px; }
.toast {
    background: var(--surface); border: 1px solid var(--border);
    padding: 12px 20px; border-radius: var(--radius);
    font-size: 14px; display: flex; gap: 16px; align-items: center;
    animation: toastIn 0.3s ease;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.toast .undo-btn { color: var(--accent); background: none; border: none; font-size: 14px; cursor: pointer; font-weight: 600; }
@keyframes toastIn { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }

/* Auth & Wizard */
.auth-container, .wizard-container {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 40px 24px; text-align: center;
}
.auth-container h1 { font-size: 24px; margin-bottom: 8px; }
.subtitle { color: var(--text-secondary); margin-bottom: 32px; font-size: 15px; }
#login-form { width: 100%; max-width: 340px; display: flex; flex-direction: column; gap: 12px; }
#email-input, .wizard-input {
    padding: 14px 18px; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); color: var(--text); font-size: 16px;
    font-family: var(--font); outline: none; width: 100%;
}
#email-input:focus, .wizard-input:focus { border-color: var(--accent); }
#login-btn, .wizard-btn {
    padding: 14px; background: var(--accent); color: #fff; border: none;
    border-radius: var(--radius); font-size: 16px; cursor: pointer; font-weight: 600;
}
.msg { font-size: 14px; color: var(--text-secondary); margin-top: 12px; }
.msg.error { color: var(--danger); }
.hidden { display: none !important; }

/* Settings */
.settings-content { flex: 1; overflow-y: auto; padding: 16px; }
.setting-group { margin-bottom: 28px; }
.setting-group h3 { font-size: 12px; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 10px; letter-spacing: 0.5px; }
.setting-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.setting-row label { font-size: 13px; color: var(--text-secondary); }
.setting-row input, .setting-row select {
    padding: 10px 14px; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-sm); color: var(--text); font-size: 14px;
    font-family: var(--font); outline: none;
}
.setting-row input:focus { border-color: var(--accent); }
.setting-hint { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }
.setting-preview { font-size: 12px; color: var(--accent); background: var(--accent-dim); padding: 6px 10px; border-radius: 4px; margin-top: 4px; }

/* Recording overlay */
.recording-overlay {
    position: fixed; bottom: 0; left: 0; right: 0; background: var(--surface);
    border-top: 1px solid var(--border); padding: 24px 16px 36px; z-index: 50;
    display: flex; flex-direction: column; align-items: center; gap: 12px;
}
.recording-waveform { width: 100%; height: 40px; display: flex; align-items: center; justify-content: center; gap: 2px; }
.recording-waveform .bar {
    width: 3px; background: var(--accent); border-radius: 2px;
    animation: wave 0.6s ease-in-out infinite alternate;
}
@keyframes wave { from { height: 8px; } to { height: 32px; } }
.recording-hint { font-size: 13px; color: var(--text-secondary); }
.recording-text { font-size: 15px; color: var(--text); min-height: 24px; text-align: center; }
.recording-cancel { font-size: 13px; color: var(--danger); margin-top: 8px; }

/* Scrollbar */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
```

- [ ] **Step 3: Commit**

```bash
git add pwa/index.html pwa/css/app.css pwa/manifest.json pwa/icons/icon-192.png
git commit -m "feat: PWA shell with HTML structure and complete CSS design system"
```

### Task 11: PWA — Supabase Client + Auth

**Files:**
- Create: `pwa/js/supabase.js`
- Create: `pwa/js/auth.js`

- [ ] **Step 1: Write Supabase client init**

Create `pwa/js/supabase.js`:

```javascript
// Supabase client initialization
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

let supabase = null;

export function initSupabase(url, anonKey) {
    supabase = createClient(url, anonKey, {
        auth: {
            persistSession: true,
            storageKey: 'ssn-auth',
            autoRefreshToken: true,
        },
    });
    return supabase;
}

export function getSupabase() {
    if (!supabase) {
        const url = localStorage.getItem('ssn_supabase_url');
        const key = localStorage.getItem('ssn_supabase_anon_key');
        if (url && key) {
            supabase = createClient(url, key, {
                auth: { persistSession: true, storageKey: 'ssn-auth', autoRefreshToken: true },
            });
        }
    }
    return supabase;
}

export function saveConnection(url, anonKey) {
    localStorage.setItem('ssn_supabase_url', url);
    localStorage.setItem('ssn_supabase_anon_key', anonKey);
}

export function getConnection() {
    return {
        url: localStorage.getItem('ssn_supabase_url'),
        anonKey: localStorage.getItem('ssn_supabase_anon_key'),
    };
}
```

- [ ] **Step 2: Write auth module**

Create `pwa/js/auth.js`:

```javascript
import { getSupabase } from './supabase.js';

export async function sendMagicLink(email) {
    const sb = getSupabase();
    const { error } = await sb.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
    });
    return { error };
}

export async function getSession() {
    const sb = getSupabase();
    const { data: { session } } = await sb.auth.getSession();
    return session;
}

export async function getUser() {
    const sb = getSupabase();
    const { data: { user } } = await sb.auth.getUser();
    return user;
}

export async function signOut() {
    const sb = getSupabase();
    await sb.auth.signOut();
}

export function onAuthStateChange(callback) {
    const sb = getSupabase();
    return sb.auth.onAuthStateChange((event, session) => {
        callback(event, session);
    });
}
```

- [ ] **Step 3: Commit**

```bash
git add pwa/js/supabase.js pwa/js/auth.js
git commit -m "feat: PWA Supabase client init and magic link auth"
```

### Task 12: PWA — Database Queries

**Files:**
- Create: `pwa/js/db.js`

- [ ] **Step 1: Write database query module**

Create `pwa/js/db.js`:

```javascript
import { getSupabase } from './supabase.js';

export async function fetchNotes(limit = 50) {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('smartstickynotes_items')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return data;
}

export async function fetchDeletedNotes() {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('smartstickynotes_items')
        .select('*')
        .eq('status', 'deleted')
        .order('deleted_at', { ascending: false });
    if (error) throw error;
    return data;
}

export async function fetchNotesByDateRange(from, to) {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('smartstickynotes_items')
        .select('id, type, text, tags, audio_path, audio_duration, created_at, status')
        .eq('status', 'active')
        .gte('created_at', from)
        .lte('created_at', to)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

export async function fetchNoteDates() {
    // Fetch just dates for calendar dot indicators
    const sb = getSupabase();
    const { data, error } = await sb
        .from('smartstickynotes_items')
        .select('created_at')
        .eq('status', 'active');
    if (error) throw error;
    return data.map(d => d.created_at);
}

export async function insertNote(note) {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('smartstickynotes_items')
        .insert({
            type: note.type,
            text: note.text,
            tags: note.tags || [],
            audio_path: note.audio_path || null,
            audio_duration: note.audio_duration || null,
        })
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function softDeleteNote(id) {
    const sb = getSupabase();
    const { error } = await sb
        .from('smartstickynotes_items')
        .update({ status: 'deleted', deleted_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
}

export async function restoreNote(id) {
    const sb = getSupabase();
    const { error } = await sb
        .from('smartstickynotes_items')
        .update({ status: 'active', deleted_at: null })
        .eq('id', id);
    if (error) throw error;
}

export async function permanentDeleteNote(id, audioPath) {
    const sb = getSupabase();
    if (audioPath) {
        await sb.storage.from('smartstickynotes_audio').remove([audioPath]);
    }
    await sb.from('deletion_events').insert({
        note_id: id,
        audio_path: audioPath || null,
    });
    const { error } = await sb.from('smartstickynotes_items').delete().eq('id', id);
    if (error) throw error;
}

export async function uploadAudio(noteId, blob) {
    const sb = getSupabase();
    const user = await sb.auth.getUser();
    const userId = user.data.user.id;
    const path = `${userId}/${noteId}.opus`;
    const { error } = await sb.storage
        .from('smartstickynotes_audio')
        .upload(path, blob, { contentType: 'audio/webm', upsert: true });
    if (error) throw error;
    return path;
}

export async function getAudioSignedUrl(audioPath) {
    const sb = getSupabase();
    const { data, error } = await sb.storage
        .from('smartstickynotes_audio')
        .createSignedUrl(audioPath, 3600); // 1 hour
    if (error) throw error;
    return data.signedUrl;
}

export async function fetchTags() {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('smartstickynotes_items')
        .select('tags')
        .eq('status', 'active');
    if (error) throw error;
    const tagCounts = {};
    data.forEach(row => {
        (row.tags || []).forEach(tag => {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
    });
    return tagCounts;
}

export async function fetchNotesByTag(tag) {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('smartstickynotes_items')
        .select('*')
        .eq('status', 'active')
        .contains('tags', [tag])
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

// Config
export async function readConfig() {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('smartstickynotes_config')
        .select('key, value');
    if (error) throw error;
    const cfg = {};
    data.forEach(row => { cfg[row.key] = row.value; });
    return cfg;
}

export async function writeConfig(key, value) {
    const sb = getSupabase();
    const { error } = await sb
        .from('smartstickynotes_config')
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' });
    if (error) throw error;
}
```

- [ ] **Step 2: Commit**

```bash
git add pwa/js/db.js
git commit -m "feat: PWA database queries — notes CRUD, audio, tags, config"
```

### Task 13: PWA — Offline Manager

**Files:**
- Create: `pwa/js/offline.js`

- [ ] **Step 1: Write offline manager**

Create `pwa/js/offline.js`:

```javascript
// Offline detection, IndexedDB queue, and network status

const DB_NAME = 'ssn-offline';
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('queue')) {
                db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('cache')) {
                db.createObjectStore('cache', { keyPath: 'id' });
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

// Queue
export async function addToQueue(note) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('queue', 'readwrite');
        tx.objectStore('queue').add({ ...note, queued_at: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

export async function getQueue() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('queue', 'readonly');
        const req = tx.objectStore('queue').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

export async function clearQueue() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('queue', 'readwrite');
        tx.objectStore('queue').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

export async function removeFromQueue(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('queue', 'readwrite');
        tx.objectStore('queue').delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

// Cache (last 100 notes)
export async function cacheNotes(notes) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('cache', 'readwrite');
        const store = tx.objectStore('cache');
        store.clear();
        notes.forEach(n => store.put(n));
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

export async function getCachedNotes() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('cache', 'readonly');
        const req = tx.objectStore('cache').getAll();
        req.onsuccess = () => resolve(req.result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
        req.onerror = (e) => reject(e.target.error);
    });
}

// Network detection
export function isOnline() {
    return navigator.onLine;
}

export function onNetworkChange(callback) {
    window.addEventListener('online', () => callback(true));
    window.addEventListener('offline', () => callback(false));
}

// Flush offline queue
export async function flushQueue(sendFn) {
    const queue = await getQueue();
    if (queue.length === 0) return 0;
    let sent = 0;
    for (const item of queue) {
        try {
            await sendFn(item);
            await removeFromQueue(item.id);
            sent++;
        } catch (e) {
            console.error('Failed to send queued item:', e);
            break; // Stop on first failure
        }
    }
    return sent;
}

export async function getQueueCount() {
    const queue = await getQueue();
    return queue.length;
}
```

- [ ] **Step 2: Commit**

```bash
git add pwa/js/offline.js
git commit -m "feat: PWA offline manager — IndexedDB queue, note cache, network detection"
```

### Task 14: PWA — Voice Recording + Audio Player

**Files:**
- Create: `pwa/js/voice.js`
- Create: `pwa/js/audio-player.js`

- [ ] **Step 1: Write voice recording module**

Create `pwa/js/voice.js`:

```javascript
import { isOnline } from './offline.js';

let mediaRecorder = null;
let audioChunks = [];
let recognition = null;
let isRecording = false;
let onTranscription = null;
let onRecordingState = null;

function getBestMimeType() {
    const types = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
    ];
    for (const t of types) {
        if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return 'audio/webm'; // fallback
}

export async function startRecording({ onText, onState }) {
    if (!isOnline()) {
        throw new Error('offline');
    }

    onTranscription = onText;
    onRecordingState = onState;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getBestMimeType();
    mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 16000,
    });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
    };

    // Start speech recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.lang = 'zh-CN';
        recognition.interimResults = true;
        recognition.continuous = true;
        recognition.onresult = (e) => {
            let text = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                text += e.results[i][0].transcript;
            }
            if (onTranscription) onTranscription(text, e.results[e.results.length - 1].isFinal);
        };
        recognition.onerror = (e) => {
            console.warn('Speech recognition error:', e.error);
        };
        recognition.start();
    }

    mediaRecorder.start(100); // collect data every 100ms
    isRecording = true;
    if (onRecordingState) onRecordingState('recording');
}

export function stopRecording() {
    return new Promise((resolve) => {
        if (!mediaRecorder || !isRecording) {
            resolve(null);
            return;
        }

        mediaRecorder.onstop = () => {
            const mimeType = mediaRecorder.mimeType || 'audio/webm';
            const blob = new Blob(audioChunks, { type: mimeType });
            // Stop tracks
            mediaRecorder.stream.getTracks().forEach(t => t.stop());
            // Stop recognition
            if (recognition) {
                recognition.stop();
                recognition = null;
            }
            isRecording = false;
            const duration = Math.round(audioChunks.reduce((acc, chunk) => acc + chunk.size, 0) / (16000 / 8));
            resolve({ blob, duration, mimeType });
        };

        mediaRecorder.stop();
        if (onRecordingState) onRecordingState('stopped');
    });
}

export function cancelRecording() {
    if (recognition) {
        recognition.abort();
        recognition = null;
    }
    if (mediaRecorder && isRecording) {
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
        mediaRecorder = null;
        isRecording = false;
        audioChunks = [];
    }
    if (onRecordingState) onRecordingState('cancelled');
}

export function getIsRecording() {
    return isRecording;
}
```

- [ ] **Step 2: Write audio player component**

Create `pwa/js/audio-player.js`:

```javascript
import { getAudioSignedUrl } from './db.js';

// Cache signed URLs for 5 minutes
const urlCache = new Map();

async function getCachedUrl(audioPath) {
    const cached = urlCache.get(audioPath);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
        return cached.url;
    }
    const url = await getAudioSignedUrl(audioPath);
    urlCache.set(audioPath, { url, timestamp: Date.now() });
    return url;
}

export function createAudioPlayer(audioPath, duration) {
    const container = document.createElement('div');
    container.className = 'audio-player';

    let audio = null;
    let isPlaying = false;
    let speed = 1.0;
    let currentTime = 0;

    const playBtn = document.createElement('button');
    playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    playBtn.setAttribute('aria-label', '播放');

    const timeDisplay = document.createElement('span');
    timeDisplay.className = 'time-display';
    const formatTime = (s) => {
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };
    timeDisplay.textContent = formatTime(0);

    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-bar';
    const progressFill = document.createElement('div');
    progressFill.className = 'progress-fill';
    progressContainer.appendChild(progressFill);

    const durationDisplay = document.createElement('span');
    durationDisplay.className = 'time-display';
    durationDisplay.textContent = duration ? formatTime(duration) : '--:--';

    const speedBtn = document.createElement('button');
    speedBtn.className = 'speed-btn';
    speedBtn.textContent = '1x';

    container.appendChild(playBtn);
    container.appendChild(timeDisplay);
    container.appendChild(progressContainer);
    container.appendChild(durationDisplay);
    container.appendChild(speedBtn);

    async function initAudio() {
        if (!audio) {
            const url = await getCachedUrl(audioPath);
            audio = new Audio(url);
            audio.addEventListener('timeupdate', () => {
                currentTime = audio.currentTime;
                timeDisplay.textContent = formatTime(currentTime);
                if (audio.duration) {
                    progressFill.style.width = `${(currentTime / audio.duration) * 100}%`;
                }
            });
            audio.addEventListener('ended', () => {
                isPlaying = false;
                playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
            });
            audio.addEventListener('loadedmetadata', () => {
                durationDisplay.textContent = formatTime(audio.duration);
                if (duration && !audio.duration) {
                    durationDisplay.textContent = formatTime(duration);
                }
            });
        }
        return audio;
    }

    playBtn.addEventListener('click', async () => {
        const a = await initAudio();
        if (isPlaying) {
            a.pause();
            isPlaying = false;
            playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
        } else {
            a.playbackRate = speed;
            await a.play();
            isPlaying = true;
            playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
        }
    });

    progressContainer.addEventListener('click', async (e) => {
        const a = await initAudio();
        const rect = progressContainer.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        a.currentTime = ratio * (a.duration || duration || 0);
    });

    speedBtn.addEventListener('click', async () => {
        const speeds = [1.0, 1.5, 2.0];
        const idx = speeds.indexOf(speed);
        speed = speeds[(idx + 1) % speeds.length];
        speedBtn.textContent = speed + 'x';
        if (audio) {
            audio.playbackRate = speed;
        }
    });

    return container;
}
```

- [ ] **Step 3: Commit**

```bash
git add pwa/js/voice.js pwa/js/audio-player.js
git commit -m "feat: PWA voice recording with Web Speech API and audio player component"
```

### Task 15: PWA — UI Helpers + Notes Rendering + Main App

**Files:**
- Create: `pwa/js/ui.js`
- Create: `pwa/js/notes.js`
- Create: `pwa/js/app.js`

- [ ] **Step 1: Write UI helpers**

Create `pwa/js/ui.js`:

```javascript
// Toast, screen navigation, and DOM helpers

export function showToast(message, { undoLabel, onUndo, duration = 3000 } = {}) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;

    if (undoLabel && onUndo) {
        const btn = document.createElement('button');
        btn.className = 'undo-btn';
        btn.textContent = undoLabel;
        btn.addEventListener('click', () => {
            onUndo();
            toast.remove();
        });
        toast.appendChild(btn);
    }

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

export function navigateTo(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(`screen-${screenId}`);
    if (screen) screen.classList.add('active');
    document.getElementById('sidebar')?.classList.remove('open');
}

export function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

export function setSyncStatus(text) {
    document.getElementById('sync-status').textContent = text;
}

export function setMicEnabled(enabled) {
    const btn = document.getElementById('mic-btn');
    if (enabled) {
        btn.disabled = false;
        btn.style.opacity = '';
    } else {
        btn.disabled = true;
        btn.style.opacity = '0.3';
    }
}

export function toggleSendButton(show) {
    const micBtn = document.getElementById('mic-btn');
    const sendBtn = document.getElementById('send-btn');
    if (show) {
        micBtn.classList.add('hidden');
        sendBtn.classList.remove('hidden');
    } else {
        micBtn.classList.remove('hidden');
        sendBtn.classList.add('hidden');
    }
}

export function showRecordingOverlay(text) {
    let overlay = document.getElementById('recording-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'recording-overlay';
        overlay.className = 'recording-overlay';
        overlay.innerHTML = `
            <div class="recording-waveform" id="waveform"></div>
            <div class="recording-text" id="recording-text"></div>
            <div class="recording-hint">↑ 上滑取消</div>
        `;
        // Animate waveform bars
        const waveform = overlay.querySelector('#waveform');
        for (let i = 0; i < 20; i++) {
            const bar = document.createElement('div');
            bar.className = 'bar';
            bar.style.animationDelay = `${i * 0.05}s`;
            waveform.appendChild(bar);
        }
        document.getElementById('app').appendChild(overlay);
    }
    overlay.style.display = 'flex';
    document.getElementById('recording-text').textContent = text || '...';
}

export function hideRecordingOverlay() {
    const overlay = document.getElementById('recording-overlay');
    if (overlay) overlay.style.display = 'none';
}

export function updateRecordingText(text) {
    const el = document.getElementById('recording-text');
    if (el) el.textContent = text;
}

export function showConnectionScreen() {
    // If never configured, show connection screen before auth
    const conn = JSON.parse(localStorage.getItem('ssn_connection') || 'null');
    if (!conn || !conn.url || !conn.anonKey) {
        // Show inline connection form
        const authScreen = document.getElementById('screen-auth');
        authScreen.classList.add('active');
        document.getElementById('login-form').classList.add('hidden');
        // Create connection form if needed
        let connForm = document.getElementById('connection-form');
        if (!connForm) {
            connForm = document.createElement('form');
            connForm.id = 'connection-form';
            connForm.innerHTML = `
                <input type="url" id="supabase-url" class="wizard-input" placeholder="Supabase Project URL" required>
                <input type="text" id="supabase-anon-key" class="wizard-input" placeholder="Supabase Anon Key" required>
                <button type="submit" class="wizard-btn">连接</button>
                <p class="msg">在 Supabase Dashboard → Settings → API 中可找到这些信息</p>
            `;
            connForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const url = document.getElementById('supabase-url').value.trim();
                const anonKey = document.getElementById('supabase-anon-key').value.trim();
                localStorage.setItem('ssn_connection', JSON.stringify({ url, anonKey }));
                window.location.reload();
            });
            authScreen.querySelector('.auth-container').appendChild(connForm);
        }
        return true; // Show connection screen
    }
    return false;
}
```

- [ ] **Step 2: Write notes rendering**

Create `pwa/js/notes.js`:

```javascript
import { createAudioPlayer } from './audio-player.js';
import { showToast } from './ui.js';
import { softDeleteNote } from './db.js';

const TAG_REGEX = /#([一-鿿\w]+)/g;

export function parseTags(text) {
    const tags = [];
    const matches = text.matchAll(TAG_REGEX);
    for (const m of matches) {
        const tag = m[1].toLowerCase();
        if (!tags.includes(tag)) tags.push(tag);
        if (tags.length >= 20) break;
    }
    return tags;
}

export function renderNoteBubble(note, onDelete) {
    const bubble = document.createElement('div');
    bubble.className = 'note-bubble';
    bubble.dataset.noteId = note.id;

    // Text
    const textEl = document.createElement('div');
    textEl.className = 'note-text';
    textEl.textContent = note.text || '';
    bubble.appendChild(textEl);

    // Audio player (voice notes)
    if (note.type === 'voice' && note.audio_path && !note.audio_failed) {
        const player = createAudioPlayer(note.audio_path, note.audio_duration);
        bubble.appendChild(player);
    } else if (note.type === 'voice' && note.audio_failed) {
        const failedEl = document.createElement('div');
        failedEl.className = 'note-text';
        failedEl.style.color = 'var(--text-secondary)';
        failedEl.style.fontSize = '12px';
        failedEl.textContent = '[音频下载失败]';
        bubble.appendChild(failedEl);
    }

    // Meta: time + tags
    const meta = document.createElement('div');
    meta.className = 'note-meta';
    const time = new Date(note.created_at);
    const timeStr = time.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const timeSpan = document.createElement('span');
    timeSpan.textContent = timeStr;
    meta.appendChild(timeSpan);

    (note.tags || []).forEach(tag => {
        const tagEl = document.createElement('span');
        tagEl.className = 'note-tag';
        tagEl.textContent = '#' + tag;
        tagEl.addEventListener('click', (e) => {
            e.stopPropagation();
            import('./app.js').then(m => m.navigateToTags(tag));
        });
        meta.appendChild(tagEl);
    });
    bubble.appendChild(meta);

    // Swipe left to delete
    let startX = 0;
    bubble.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; });
    bubble.addEventListener('touchend', (e) => {
        const diff = startX - e.changedTouches[0].clientX;
        if (diff > 80) {
            softDeleteNote(note.id).then(() => {
                showToast('已移至回收站', {
                    undoLabel: '撤销',
                    onUndo: () => {
                        import('./db.js').then(m => m.restoreNote(note.id)).then(() => {
                            bubble.remove();
                            // Reload notes
                            import('./app.js').then(m => m.loadNotes());
                        });
                    },
                });
                bubble.remove();
                if (onDelete) onDelete(note.id);
            });
        }
    });

    // Long press → context menu (placeholder)
    bubble.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // For now, just delete
        softDeleteNote(note.id).then(() => {
            showToast('已移至回收站', {
                undoLabel: '撤销',
                onUndo: () => {
                    import('./db.js').then(m => m.restoreNote(note.id)).then(() => {
                        bubble.remove();
                        import('./app.js').then(m => m.loadNotes());
                    });
                },
            });
            bubble.remove();
        });
    });

    return bubble;
}
```

- [ ] **Step 3: Write main app controller**

Create `pwa/js/app.js`:

```javascript
import { initSupabase, getSupabase, getConnection, saveConnection } from './supabase.js';
import { sendMagicLink, getSession, signOut, onAuthStateChange } from './auth.js';
import { fetchNotes, insertNote, uploadAudio, readConfig, writeConfig, fetchNoteDates, fetchTags, fetchNotesByTag, fetchNotesByDateRange, fetchDeletedNotes, restoreNote, permanentDeleteNote } from './db.js';
import { renderNoteBubble, parseTags } from './notes.js';
import { startRecording, stopRecording, cancelRecording, getIsRecording } from './voice.js';
import { navigateTo, toggleSidebar, setSyncStatus, setMicEnabled, toggleSendButton, showRecordingOverlay, hideRecordingOverlay, updateRecordingText, showToast } from './ui.js';
import { isOnline, onNetworkChange, cacheNotes, getCachedNotes, addToQueue, getQueueCount, flushQueue } from './offline.js';
import { renderCalendarDay, renderCalendarWeek, renderCalendarMonth, renderCalendarYear } from './calendar.js';

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
    const conn = getConnection();
    if (!conn.url || !conn.anonKey) {
        // Show connection form
        document.getElementById('screen-auth').classList.add('active');
        setupConnectionForm();
        return;
    }

    initSupabase(conn.url, conn.anonKey);

    const session = await getSession();
    if (session) {
        navigateTo('main');
        loadNotes();
        setupMainUI();
    } else {
        document.getElementById('screen-auth').classList.add('active');
        setupAuthUI();
    }
});

function setupConnectionForm() {
    // Handled in ui.js showConnectionScreen
    const { showConnectionScreen } = await import('./ui.js');
    showConnectionScreen();
}

function setupAuthUI() {
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email-input').value.trim();
        if (!email) return;
        const msg = document.getElementById('login-msg');
        msg.classList.remove('hidden');
        msg.textContent = '正在发送登录链接...';
        const { error } = await sendMagicLink(email);
        if (error) {
            msg.textContent = '发送失败: ' + error.message;
            msg.classList.add('error');
        } else {
            msg.textContent = '登录链接已发送，请检查邮箱并点击链接';
        }
    });

    onAuthStateChange((event, session) => {
        if (session) {
            navigateTo('main');
            loadNotes();
            setupMainUI();
        }
    });
}

// --- Main UI ---
function setupMainUI() {
    // Menu toggle
    document.getElementById('menu-toggle').addEventListener('click', toggleSidebar);
    document.getElementById('sidebar-close').addEventListener('click', toggleSidebar);

    // Sidebar navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const screen = item.dataset.screen;
            if (screen === 'recycle-bin') showRecycleBin();
            else if (screen === 'tags') showTags();
            else if (screen === 'settings') showSettings();
            else navigateTo('main');
        });
    });

    // Calendar toggle
    document.getElementById('calendar-toggle').addEventListener('click', () => {
        navigateTo('calendar');
        renderCalendarMonth(new Date());
    });

    // Text input
    const textInput = document.getElementById('text-input');
    textInput.addEventListener('input', () => {
        toggleSendButton(textInput.value.trim().length > 0);
    });

    // Send text
    document.getElementById('send-btn').addEventListener('click', sendTextNote);

    // Mic button
    const micBtn = document.getElementById('mic-btn');
    micBtn.addEventListener('pointerdown', onMicPress);
    micBtn.addEventListener('pointerup', onMicRelease);
    micBtn.addEventListener('pointerleave', onMicRelease);

    // Network status
    updateMicState();
    onNetworkChange((online) => {
        updateMicState();
        if (online) flushAndReload();
    });

    // Pull to refresh
    setupPullToRefresh();

    // Calendar back
    document.getElementById('calendar-back').addEventListener('click', () => navigateTo('main'));
    document.getElementById('cal-today').addEventListener('click', () => {
        renderCalendarDay(new Date());
    });
    document.querySelectorAll('.cal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.cal-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const view = tab.dataset.view;
            const now = new Date();
            if (view === 'day') renderCalendarDay(now);
            else if (view === 'week') renderCalendarWeek(now);
            else if (view === 'month') renderCalendarMonth(now);
            else if (view === 'year') renderCalendarYear(now);
        });
    });

    // Trash back
    document.getElementById('trash-back')?.addEventListener('click', () => {
        navigateTo('main');
        loadNotes();
    });
    // Tags back
    document.getElementById('tags-back')?.addEventListener('click', () => navigateTo('main'));
    // Settings back
    document.getElementById('settings-back')?.addEventListener('click', () => navigateTo('main'));

    setSyncStatus('已同步');
}

function updateMicState() {
    if (isOnline()) {
        setMicEnabled(true);
    } else {
        setMicEnabled(false);
        document.getElementById('mic-btn').title = '当前离线，请使用文字输入';
    }
}

async function onMicPress(e) {
    if (!isOnline()) {
        showToast('当前离线，请使用文字输入');
        return;
    }
    if (getIsRecording()) return;

    let startY = e.clientY;
    let cancelled = false;

    showRecordingOverlay('准备录音...');

    try {
        await startRecording({
            onText: (text, isFinal) => {
                updateRecordingText(text);
            },
            onState: (state) => {
                if (state === 'recording') {
                    updateRecordingText('说话中...');
                }
            },
        });
    } catch (err) {
        hideRecordingOverlay();
        if (err.message === 'offline') {
            showToast('当前离线，请使用文字输入');
        } else {
            showToast('无法访问麦克风');
        }
        return;
    }

    // Track swipe-to-cancel
    const onMove = (e) => {
        const dy = startY - (e.touches ? e.touches[0].clientY : e.clientY);
        if (dy > 60) {
            cancelled = true;
            updateRecordingText('松开取消');
        }
    };
    const onUp = async () => {
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);

        if (cancelled) {
            cancelRecording();
            hideRecordingOverlay();
            return;
        }

        const result = await stopRecording();
        hideRecordingOverlay();

        if (result && result.blob) {
            const currentText = document.getElementById('recording-text')?.textContent || '';
            document.getElementById('text-input').value = currentText;
            toggleSendButton(currentText.trim().length > 0);

            // Store recording result for send
            document.getElementById('text-input').dataset.voiceBlob = 'pending';
            document.getElementById('text-input').dataset.voiceData = JSON.stringify({
                size: result.blob.size,
                duration: result.duration,
            });
            // Store blob temporarily
            window._pendingVoiceBlob = result.blob;
        }
    };

    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onUp);
}

function onMicRelease(e) {
    // Handled by touchend in onMicPress
}

async function sendTextNote() {
    const textInput = document.getElementById('text-input');
    const text = textInput.value.trim();
    if (!text && !window._pendingVoiceBlob) return;

    const tags = parseTags(text);
    let noteData = {
        type: 'text',
        text: text || '[语音笔记]',
        tags,
        audio_path: null,
        audio_duration: null,
    };

    try {
        if (window._pendingVoiceBlob) {
            noteData.type = 'voice';
            // Insert first to get ID
            const note = await insertNote({ type: 'voice', text: text || '', tags, audio_path: '', audio_duration: 0 });
            // Upload audio
            const audioPath = await uploadAudio(note.id, window._pendingVoiceBlob);
            window._pendingVoiceBlob = null;
            // Update note with audio path
            const sb = getSupabase();
            await sb.from('smartstickynotes_items').update({ audio_path: audioPath }).eq('id', note.id);
            noteData = { ...note, audio_path: audioPath };
        } else {
            noteData = await insertNote(noteData);
        }

        textInput.value = '';
        textInput.dataset.voiceBlob = '';
        toggleSendButton(false);

        // Render bubble
        const list = document.getElementById('notes-list');
        const bubble = renderNoteBubble(noteData);
        list.insertBefore(bubble, list.firstChild);

        // Update cache
        const notes = Array.from(list.children).map(b => b._noteData || noteData);
        await cacheNotes(notes.filter(n => n.id));

    } catch (err) {
        if (!isOnline()) {
            // Queue offline
            await addToQueue(noteData);
            showToast('已保存到本地，联网后自动发送');
            textInput.value = '';
            toggleSendButton(false);
        } else {
            showToast('发送失败: ' + err.message);
        }
    }
}

export async function loadNotes() {
    const list = document.getElementById('notes-list');
    list.innerHTML = '';

    try {
        let notes;
        if (!isOnline()) {
            notes = await getCachedNotes();
        } else {
            notes = await fetchNotes(100);
            await cacheNotes(notes);
        }
        notes.forEach(note => {
            const bubble = renderNoteBubble(note);
            list.appendChild(bubble);
        });
    } catch (err) {
        // Try cache
        const cached = await getCachedNotes();
        cached.forEach(note => {
            const bubble = renderNoteBubble(note);
            list.appendChild(bubble);
        });
    }

    const queueCount = await getQueueCount();
    if (queueCount > 0) {
        setSyncStatus(`${queueCount} 条待发送`);
    }
}

async function flushAndReload() {
    const sent = await flushQueue(async (item) => {
        await insertNote(item);
    });
    if (sent > 0) {
        setSyncStatus('已同步');
        await loadNotes();
    }
}

function setupPullToRefresh() {
    const list = document.getElementById('notes-list');
    let startY = 0;
    list.addEventListener('touchstart', (e) => { if (list.scrollTop === 0) startY = e.touches[0].clientY; });
    list.addEventListener('touchend', async (e) => {
        if (list.scrollTop === 0) {
            const diff = e.changedTouches[0].clientY - startY;
            if (diff > 60) {
                setSyncStatus('同步中...');
                await loadNotes();
                setSyncStatus('已同步');
            }
        }
    });
}

// --- Recycle Bin ---
async function showRecycleBin() {
    navigateTo('recycle-bin');
    const list = document.getElementById('trash-list');
    list.innerHTML = '';
    const notes = await fetchDeletedNotes();
    notes.forEach(note => {
        const div = document.createElement('div');
        div.className = 'note-bubble';
        div.innerHTML = `
            <div class="note-text">${note.text || '[无文字]'}</div>
            <div class="note-meta">${new Date(note.created_at).toLocaleString('zh-CN')}</div>
            <div style="display:flex;gap:8px;margin-top:8px;">
                <button class="restore-btn" style="padding:6px 14px;background:var(--accent);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;">恢复</button>
                <button class="purge-btn" style="padding:6px 14px;background:var(--danger);color:#fff;border:none;border-radius:16px;cursor:pointer;font-size:13px;">彻底删除</button>
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
}

// --- Tags ---
async function showTags() {
    navigateTo('tags');
    const content = document.getElementById('tags-content');
    const tags = await fetchTags();
    content.innerHTML = '';
    const sorted = Object.entries(tags).sort((a, b) => b[1] - a[1]);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:16px;';
    sorted.forEach(([tag, count]) => {
        const pill = document.createElement('button');
        pill.style.cssText = 'background:var(--accent-dim);color:var(--accent);border:none;padding:8px 16px;border-radius:20px;font-size:14px;cursor:pointer;';
        pill.textContent = `#${tag} (${count})`;
        pill.addEventListener('click', () => navigateToTags(tag));
        grid.appendChild(pill);
    });
    content.appendChild(grid);
}

export async function navigateToTags(tag) {
    navigateTo('tags');
    const notes = await fetchNotesByTag(tag);
    const content = document.getElementById('tags-content');
    content.innerHTML = `<h3 style="padding:16px;font-size:16px;">#${tag}</h3>`;
    notes.forEach(note => {
        content.appendChild(renderNoteBubble(note));
    });
}

// --- Settings ---
async function showSettings() {
    navigateTo('settings');
    const content = document.getElementById('settings-content');
    const cfg = await readConfig();

    content.innerHTML = `
        <div class="setting-group">
            <h3>同步</h3>
            <div class="setting-row">
                <label>本地文件夹路径</label>
                <input type="text" id="cfg-folder" value="${cfg.local_folder_path || ''}" placeholder="例如: D:/OneDrive/Notes">
                <span class="setting-hint" id="cfg-folder-hint"></span>
            </div>
            <div class="setting-row">
                <label>文件名格式</label>
                <input type="text" id="cfg-template" value="${cfg.filename_template || '{date}_{time}_{type}_{id}'}">
                <span class="setting-hint">可用: {date} {time} {type} {id} {tag}</span>
                <span class="setting-preview" id="template-preview"></span>
            </div>
            <button id="cfg-sync-now" style="padding:10px 20px;background:var(--accent);color:#fff;border:none;border-radius:20px;cursor:pointer;font-size:14px;margin-top:8px;">立即同步配置到 PC</button>
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

    // Live preview
    const templateInput = document.getElementById('cfg-template');
    const preview = document.getElementById('template-preview');
    const updatePreview = () => {
        const now = new Date();
        const previewText = templateInput.value
            .replace('{date}', now.toISOString().split('T')[0])
            .replace('{time}', now.toTimeString().split(' ')[0].replace(/:/g, ''))
            .replace('{type}', 'voice')
            .replace('{id}', 'a1b2c3d4')
            .replace('{tag}', '产品');
        preview.textContent = '预览: ' + previewText + '.md';
    };
    templateInput.addEventListener('input', updatePreview);
    updatePreview();

    // Save on change
    const saveField = async (key, value) => {
        await writeConfig(key, value);
        document.getElementById('cfg-folder-hint').textContent = '已保存 · PC 端将在 5 分钟内生效';
    };
    document.getElementById('cfg-folder').addEventListener('change', (e) => saveField('local_folder_path', e.target.value));
    document.getElementById('cfg-template').addEventListener('change', (e) => saveField('filename_template', e.target.value));
    document.getElementById('cfg-calendar-view').addEventListener('change', (e) => saveField('default_calendar_view', e.target.value));

    document.getElementById('cfg-sync-now').addEventListener('click', async () => {
        await writeConfig('config_sync_requested_at', new Date().toISOString());
        document.getElementById('cfg-folder-hint').textContent = '已发送同步请求 · PC 将在 30 秒内响应';
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await signOut();
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('screen-auth').classList.add('active');
    });
}
```

- [ ] **Step 4: Commit**

```bash
git add pwa/js/ui.js pwa/js/notes.js pwa/js/app.js
git commit -m "feat: PWA main app — UI, notes rendering, routing, settings"
```

### Task 16: PWA — Calendar Views

**Files:**
- Create: `pwa/js/calendar.js`

- [ ] **Step 1: Write calendar module**

Create `pwa/js/calendar.js`:

```javascript
import { fetchNotesByDateRange, fetchNoteDates } from './db.js';
import { renderNoteBubble } from './notes.js';

const content = () => document.getElementById('calendar-content');

export async function renderCalendarDay(date) {
    const c = content();
    c.innerHTML = '';
    const from = new Date(date); from.setHours(0, 0, 0, 0);
    const to = new Date(date); to.setHours(23, 59, 59, 999);
    const notes = await fetchNotesByDateRange(from.toISOString(), to.toISOString());

    const header = document.createElement('h3');
    header.style.cssText = 'font-size:16px;margin-bottom:12px;';
    header.textContent = date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    c.appendChild(header);

    if (notes.length === 0) {
        const empty = document.createElement('p');
        empty.style.color = 'var(--text-secondary)';
        empty.textContent = '当天没有笔记';
        c.appendChild(empty);
    } else {
        notes.forEach(n => c.appendChild(renderNoteBubble(n)));
    }
}

export async function renderCalendarWeek(date) {
    const c = content();
    c.innerHTML = '';
    const startOfWeek = new Date(date);
    startOfWeek.setDate(date.getDate() - date.getDay() + 1); // Monday
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const notes = await fetchNotesByDateRange(startOfWeek.toISOString(), endOfWeek.toISOString());
    const notesByDay = {};
    notes.forEach(n => {
        const d = n.created_at.split('T')[0];
        if (!notesByDay[d]) notesByDay[d] = [];
        notesByDay[d].push(n);
    });

    const grid = document.createElement('div');
    grid.className = 'week-grid';
    for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        const ds = d.toISOString().split('T')[0];
        const cell = document.createElement('div');
        cell.className = 'week-day';
        cell.textContent = d.getDate();
        if (ds === date.toISOString().split('T')[0]) cell.classList.add('selected');
        if (notesByDay[ds]) cell.classList.add('has-notes');
        cell.addEventListener('click', () => renderCalendarDay(d));
        grid.appendChild(cell);
    }
    c.appendChild(grid);

    const selectedDay = date.toISOString().split('T')[0];
    const dayNotes = notesByDay[selectedDay] || [];
    const list = document.createElement('div');
    list.style.cssText = 'margin-top:16px;';
    if (dayNotes.length > 0) {
        dayNotes.forEach(n => list.appendChild(renderNoteBubble(n)));
    } else {
        const empty = document.createElement('p');
        empty.style.color = 'var(--text-secondary)';
        empty.textContent = '当天没有笔记';
        list.appendChild(empty);
    }
    c.appendChild(list);
}

export async function renderCalendarMonth(date) {
    const c = content();
    c.innerHTML = '';
    const year = date.getFullYear();
    const month = date.getMonth();

    const dates = await fetchNoteDates();
    const dateSet = new Set(dates.map(d => d.split('T')[0]));

    const header = document.createElement('h3');
    header.style.cssText = 'text-align:center;margin-bottom:12px;font-size:16px;';
    header.textContent = `${year} 年 ${month + 1} 月`;
    c.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'month-grid';
    const dayNames = ['一', '二', '三', '四', '五', '六', '日'];
    dayNames.forEach(d => {
        const dh = document.createElement('div');
        dh.className = 'day-header';
        dh.textContent = d;
        grid.appendChild(dh);
    });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;

    for (let i = 0; i < startOffset; i++) {
        grid.appendChild(document.createElement('div'));
    }

    const today = new Date().toISOString().split('T')[0];
    for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const cell = document.createElement('div');
        cell.className = 'day-cell';
        cell.textContent = d;
        if (ds === today) cell.classList.add('today');
        if (dateSet.has(ds)) cell.classList.add('has-notes');
        cell.addEventListener('click', () => {
            const selected = new Date(year, month, d);
            renderCalendarDay(selected);
        });
        grid.appendChild(cell);
    }
    c.appendChild(grid);
}

export async function renderCalendarYear(date) {
    const c = content();
    c.innerHTML = '';
    const year = date.getFullYear();
    const from = new Date(year, 0, 1).toISOString();
    const to = new Date(year, 11, 31, 23, 59, 59, 999).toISOString();
    const notes = await fetchNotesByDateRange(from, to);
    const countByMonth = new Array(12).fill(0);
    const summaryByMonth = new Array(12).fill(null).map(() => []);
    notes.forEach(n => {
        const m = new Date(n.created_at).getMonth();
        countByMonth[m]++;
        if (summaryByMonth[m].length < 2) summaryByMonth[m].push(n.text?.substring(0, 30));
    });

    const header = document.createElement('h3');
    header.style.cssText = 'text-align:center;margin-bottom:12px;font-size:16px;';
    header.textContent = `${year} 年`;
    c.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'year-grid';
    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    for (let m = 0; m < 12; m++) {
        const card = document.createElement('div');
        card.className = 'year-card';
        card.innerHTML = `
            <div class="month-name">${monthNames[m]}</div>
            <div class="note-count">${countByMonth[m]}</div>
        `;
        card.addEventListener('click', () => renderCalendarMonth(new Date(year, m, 1)));
        grid.appendChild(card);
    }
    c.appendChild(grid);
}
```

- [ ] **Step 2: Commit**

```bash
git add pwa/js/calendar.js
git commit -m "feat: PWA calendar views — day, week, month, year"
```

### Task 17: PWA — Service Worker

**Files:**
- Create: `pwa/sw.js`

- [ ] **Step 1: Write service worker**

Create `pwa/sw.js`:

```javascript
const CACHE_NAME = 'ssn-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/css/app.css',
    '/manifest.json',
    '/js/app.js',
    '/js/supabase.js',
    '/js/auth.js',
    '/js/db.js',
    '/js/notes.js',
    '/js/voice.js',
    '/js/ui.js',
    '/js/calendar.js',
    '/js/tags.js',
    '/js/recycle-bin.js',
    '/js/settings.js',
    '/js/wizard.js',
    '/js/offline.js',
    '/js/audio-player.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Skip Supabase API calls — don't cache network requests
    if (event.request.url.includes('supabase.co')) return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            // Return cached asset, then update cache in background
            const fetchPromise = fetch(event.request).then((response) => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => cached);
            return cached || fetchPromise;
        })
    );
});
```

- [ ] **Step 2: Commit**

```bash
git add pwa/sw.js
git commit -m "feat: PWA service worker for offline asset caching"
```

---

## Phase 4: Integration & Final Assembly

### Task 18: PWA — Setup Wizard

**Files:**
- Create: `pwa/js/wizard.js`

- [ ] **Step 1: Write setup wizard**

Create `pwa/js/wizard.js`:

```javascript
import { getSupabase } from './supabase.js';
import { writeConfig } from './db.js';
import { navigateTo } from './ui.js';

const SQL_SNIPPET = `
-- Copy and paste this into Supabase SQL Editor:
-- https://app.supabase.com/project/_/sql

CREATE TABLE smartstickynotes_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    type text NOT NULL CHECK (type IN ('voice', 'text')),
    text text NOT NULL DEFAULT '',
    tags text[] NOT NULL DEFAULT '{}',
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
CREATE INDEX idx_items_tags ON smartstickynotes_items USING gin(tags);
CREATE INDEX idx_deletion_user ON deletion_events(user_id);

-- Then create Storage bucket "smartstickynotes_audio" via Supabase Dashboard → Storage
`.trim();

export function renderWizard(step = 1) {
    const container = document.getElementById('wizard-steps');
    container.innerHTML = '';

    if (step === 1) {
        container.innerHTML = `
            <h2>设置笔记文件夹</h2>
            <p class="subtitle">笔记最终会以 Markdown 文件存到这个文件夹</p>
            <input type="text" id="wiz-folder" class="wizard-input" placeholder="例如: D:/OneDrive/Notes" value="D:/OneDrive/Notes">
            <button id="wiz-step1-next" class="wizard-btn" style="margin-top:16px;">下一步</button>
        `;
        document.getElementById('wiz-step1-next').addEventListener('click', () => {
            const folder = document.getElementById('wiz-folder').value.trim();
            if (!folder) return;
            writeConfig('local_folder_path', folder);
            writeConfig('filename_template', '{date}_{time}_{type}_{id}');
            writeConfig('default_calendar_view', 'month');
            renderWizard(2);
        });
    } else if (step === 2) {
        container.innerHTML = `
            <h2>初始化数据库</h2>
            <p class="subtitle">复制以下 SQL，在 Supabase SQL Editor 中粘贴执行（一次性操作）</p>
            <textarea readonly style="width:100%;height:200px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:12px;font-family:monospace;font-size:12px;resize:none;">${SQL_SNIPPET}</textarea>
            <button id="copy-sql" class="wizard-btn" style="margin-top:8px;background:var(--surface);color:var(--text);border:1px solid var(--border);">复制 SQL</button>
            <p style="margin-top:12px;font-size:13px;color:var(--text-secondary);">然后前往 <a href="https://app.supabase.com" target="_blank" style="color:var(--accent);">Supabase Dashboard</a> → SQL Editor → 粘贴执行</p>
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
            <p class="subtitle">同步脚本在后台运行，将笔记同步到本地文件夹</p>
            <p style="margin-top:8px;font-size:14px;color:var(--text-secondary);">
                1. 从项目目录中复制 <code>sync/</code> 文件夹<br>
                2. 安装 Python 依赖: <code>pip install -r requirements.txt</code><br>
                3. 设置环境变量后运行: <code>main.py</code><br>
                4. 脚本将打开浏览器完成登录，之后自动注册为 Windows 后台服务
            </p>
            <button id="wiz-done" class="wizard-btn" style="margin-top:24px;">完成设置，开始使用</button>
        `;
        document.getElementById('wiz-done').addEventListener('click', () => {
            navigateTo('main');
        });
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add pwa/js/wizard.js
git commit -m "feat: PWA setup wizard with SQL snippet and PC script instructions"
```

### Task 19: Integration Test Plan

**Files:**
- No new files. Run manual verification.

- [ ] **Step 1: Test Supabase schema**

```bash
# After running migration in Supabase SQL Editor, verify tables exist:
# Check via Supabase Dashboard → Table Editor
# Verify RLS policies are listed under Authentication → Policies
```

Expected: Three tables with RLS enabled and policies listed.

- [ ] **Step 2: Test PC sync script (headless mode)**

```bash
cd sync
pip install -r requirements.txt
SUPABASE_URL="https://xxx.supabase.co" SUPABASE_ANON_KEY="xxx" python main.py
# Login via browser
# Verify notes appear in configured folder
```

Expected: Sync script authenticates, polls Supabase, writes Markdown files to configured folder.

- [ ] **Step 3: Test PWA locally**

```bash
cd pwa
python -m http.server 8080
# Open http://localhost:8080 on mobile browser or Chrome DevTools device mode
```

Expected flow:
1. Enter Supabase URL + anon key → saved
2. Enter email → receive magic link → click → logged in
3. Main chat view loads
4. Text input works: type text → send button appears → send → bubble appears
5. Voice: long-press mic → recording overlay → release → transcription in input → send
6. Swipe left on bubble → toast with undo
7. Calendar icon → calendar view → day/week/month/year tabs work
8. Tags: type `#test` → tag appears in bubble → click tag → tag view
9. Settings: change folder path → save
10. Offline: turn off network → mic disabled → text works → queued
11. Recycle bin: sidebar → recycle bin → restore / permanent delete

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "docs: integration test plan added"
```
```

- [ ] **Step 5: Commit**

Wait, this is the plan file itself. Commit the plan:

```bash
git add docs/superpowers/plans/2026-05-27-smart-sticky-notes-plan.md
git commit -m "docs: implementation plan — 19 tasks across 4 phases"
```
