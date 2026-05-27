# Smart Sticky Notes — Design Spec

**Date**: 2026-05-27
**Status**: Draft
**Revision**: v4 — merged two external reviews, corrected Web Speech API scope, completed auth + init + sync model

## 1. Problem

User takes notes scattered across devices (mostly WeChat, system notepad). These notes end up fragmented and hard to consolidate for AI processing. The goal is a single, low-cost system that captures voice and text notes from anywhere, consolidates them into a local Markdown folder, where any Agentic AI can read and organize them.

## 2. Architecture

```
Phone PWA  ──HTTP──→  Supabase (auth + config + notes DB + audio storage)  ←──  PC Sync Script (background)  ──→  Local Markdown Folder  ──→  AI reads
```

| Component | Runtime | Purpose |
|-----------|---------|---------|
| PWA | Mobile browser | Voice recording (online only, real-time Web Speech API), text notes, history browsing, calendar view, tag system, audio playback |
| Supabase | Cloud (free tier) | Auth (magic link), config store, notes DB, audio Storage. Single source of truth. |
| PC Sync Script | User's Windows PC | Background service, polls Supabase, writes Markdown to local folder. One-way sync: Supabase → local. |
| Local Folder | User-configured directory | Export target. One Markdown file per note + local audio copies. AI reads directly from here. |

### Data Flow Direction (MVP)

```
Supabase  ──(one-way sync)──→  Local Markdown Folder  ──→  AI reads
```

- **Supabase is the single source of truth.** PWA writes directly to Supabase. PC sync script pulls from Supabase to local folder.
- **Local folder is a read-only export target** from Supabase's perspective. Files edited locally are NOT synced back to Supabase in MVP. The conflict detection exists to protect local edits from being overwritten — not to merge them upstream.
- Future v2 may add bidirectional sync (scan local files, upload new/changed ones to Supabase).

### Extensibility

Desktop apps, CLI tools, or scripts can write directly to the local folder. Notes written this way are local-only in MVP (not visible in PWA). In v2, the sync script would detect new local files and upload them to Supabase.

## 3. Authentication

### Supabase Auth — Magic Link

- Passwordless email login via Supabase Auth magic link
- User opens PWA → enters email → receives one-time link → clicks → logged in
- Auth session token stored in browser IndexedDB; persists across PWA sessions
- `anon` key IS present in PWA frontend code (this is normal and expected for Supabase apps). Security comes from RLS, not from hiding the anon key.
- All table and Storage access is gated by RLS policies keyed to `auth.uid()`

### PC Sync Script Authentication

The PC sync script is a headless background process. It cannot use magic link interactively. Auth flow:

1. **First run**: Script opens the user's default browser to a Supabase OAuth/magic-link page
2. User completes login in the browser
3. Supabase returns a `refresh_token` with long expiry
4. Script stores `refresh_token` in **Windows Credential Manager** (not a plaintext file)
5. Script exchanges `refresh_token` for a session JWT on startup and periodically (every 55 minutes, before the 1-hour JWT expiry)
6. All Supabase API calls use the session JWT → pass RLS as `auth.uid()`
7. `service_role` key is **never** distributed to user machines or present in PWA code

Token refresh flow:
```
Windows Credential Manager          Supabase Auth
        │                                │
        ├── refresh_token ──────────────→│
        │                                │
        │←──── new JWT + refresh_token ──┤
        │                                │
        ├── store updated refresh_token  │
```

If refresh fails (token revoked, expired), script shows system tray alert: "登录已过期，请重新登录" and opens browser for re-auth.

### RLS Policies

```sql
-- smartstickynotes_items
ALTER TABLE smartstickynotes_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "items_select" ON smartstickynotes_items
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "items_insert" ON smartstickynotes_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "items_update" ON smartstickynotes_items
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "items_delete" ON smartstickynotes_items
  FOR DELETE USING (auth.uid() = user_id);

-- Enforce user_id on insert
ALTER TABLE smartstickynotes_items ALTER COLUMN user_id SET DEFAULT auth.uid();

-- smartstickynotes_config
ALTER TABLE smartstickynotes_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "config_select" ON smartstickynotes_config
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "config_insert" ON smartstickynotes_config
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "config_update" ON smartstickynotes_config
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- deletion_events
ALTER TABLE deletion_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deletion_select" ON deletion_events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "deletion_insert" ON deletion_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "deletion_delete" ON deletion_events
  FOR DELETE USING (auth.uid() = user_id);

-- Storage bucket: smartstickynotes_audio
-- Storage policies: SELECT/INSERT/DELETE restricted to auth.uid() = owner
```

## 4. Data Model

### Supabase Table: `smartstickynotes_items`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key, `DEFAULT gen_random_uuid()` |
| user_id | uuid | `DEFAULT auth.uid()`, NOT NULL |
| type | text | `"voice"` or `"text"`, NOT NULL |
| text | text | Note content (transcription or typed text) |
| tags | text[] | Extracted from `#tag` in text (see tag parsing rules) |
| audio_path | text? | Storage path: `{user_id}/{note_id}.opus`. NULL for text notes. This is a path, never a signed URL. |
| audio_duration | int? | Seconds, nullable |
| status | text | `"active"`, `"deleted"`. Default `"active"`. No `purged` status — permanent deletion uses `deletion_events`. |
| created_at | timestamptz | `DEFAULT now()` |
| updated_at | timestamptz | `DEFAULT now()` |
| deleted_at | timestamptz? | When soft-deleted, nullable |
| synced_at | timestamptz? | When PC last synced this note, nullable. Per-client in future; for single-PC MVP this is adequate. |

### Supabase Table: `deletion_events`

Lightweight tombstone table. Rows exist only long enough for PC to see them.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| user_id | uuid | `DEFAULT auth.uid()` |
| note_id | uuid | ID of the permanently-deleted note |
| audio_path | text? | Storage path of audio to clean up, nullable |
| created_at | timestamptz | When permanent deletion occurred |

When PWA permanently deletes a note:
1. Delete audio from Storage (if voice note)
2. Insert a row into `deletion_events`
3. Delete the row from `smartstickynotes_items`

PC sync script: checks `deletion_events` each cycle → deletes corresponding local `.md` and audio file → deletes the `deletion_events` row.

This ensures:
- Audio is removed from Supabase Storage immediately (no zombie files consuming quota while PC is offline)
- PC still gets the cleanup signal even if it was offline during deletion
- Row in `smartstickynotes_items` goes away immediately (no stale data visible in PWA)

### Supabase Table: `smartstickynotes_config`

| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid | `DEFAULT auth.uid()` |
| key | text | Config key |
| value | text | Config value |
| updated_at | timestamptz | `DEFAULT now()` |

Primary key: `(user_id, key)`.

Both PWA and PC sync script read/write config from this table. No config stored in browser localStorage except auth session + Supabase connection info (URL, anon key).

Config keys:
- `local_folder_path` — PC writes Markdown here. Note: stored in Supabase, reveals user's local directory structure. Acceptable trade-off; documented in privacy note.
- `filename_template` — `{id}` mandatory, auto-appended if omitted. Variables: `{id}`, `{date}`, `{time}`, `{type}`, `{tag}`.
- `default_calendar_view` — `"day"` | `"week"` | `"month"`

### Supabase Storage: `smartstickynotes_audio`

- Files stored at path: `{user_id}/{note_id}.opus`
- Private bucket — access only via signed URLs generated at display time
- Permanent retention (never auto-deleted except on permanent delete)
- Signed URLs generated fresh by PWA when displaying voice notes, with a client-side cache (5-minute TTL for generated URL) to avoid rate-limiting

### Audio Encoding

| Parameter | Target | Notes |
|-----------|--------|-------|
| Codec | Opus | Best speech compression available in browsers |
| Bitrate | 16 kbps | ~120KB per minute of speech |
| Channels | Mono | Voice only |
| Sample rate | 16 kHz | Covers speech frequency range |

Browser `MediaRecorder` support for Opus varies by platform. PWA MUST do runtime capability detection (`MediaRecorder.isTypeSupported('audio/webm;codecs=opus')`) and fall back to browser default codec if Opus is unavailable. The 16kbps/16kHz/mono constraints are best-effort; actual encoding depends on the browser's `MediaRecorder` implementation.

Space estimate: 5 voice notes/day × 1 min × ~120KB × 365 days ≈ 219MB/year. Supabase free tier: 1GB Storage. Roughly 4 years of capacity for typical usage. However, this is an estimate, not a guarantee — actual usage, browser codec behavior, and Supabase policy changes may affect this.

### Local Folder Structure

```
{configured_folder}/
├── active/
│   ├── 2026-05-27_142530_a1b2c3d4_voice.md
│   └── 2026-05-27_100815_e5f6g7h8_text.md
├── trash/
│   └── _deleted_2026-05-26_183200_i9j0k1l2_text.md
├── audio/
│   ├── a1b2c3d4.opus
│   └── e5f6g7h8.opus
└── .sync_state.json
```

### Markdown File Format (YAML frontmatter)

```markdown
---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
type: voice
created_at: 2026-05-27T14:25:30+08:00
updated_at: 2026-05-27T14:25:30+08:00
status: active
tags: [产品, 设计]
audio: ../audio/a1b2c3d4.opus
audio_duration: 32
remote_hash: sha256:def456...
---

# 2026-05-27 14:25

今天下午想到了一个关于产品设计的灵感...

> [收听录音](../audio/a1b2c3d4.opus) (0:32)
```

- Frontmatter contains machine-readable metadata for AI processing
- Audio file reference uses relative path from `active/` to `audio/` (`../audio/{note_id}.opus`)
- `remote_hash` is the content hash from Supabase at time of last sync — used for conflict detection

### Tag Parsing Rules

- `#tagName` pattern detected in note text
- Tags support: Chinese characters, letters, digits, underscores
- Tag boundary: whitespace, punctuation, end-of-string, or another `#`
- Duplicate tags in same note collapsed to one
- Tags stored lowercase for ASCII, as-is for CJK
- Max 20 tags per note
- Examples:
  - `#产品 #设计 v2` → tags: `[产品, 设计]`
  - `#todo #待办 #TODO` → tags: `[todo, 待办]`

### PC Sync State File (`.sync_state.json`)

```json
{
  "last_sync_cursor": "2026-05-27T14:30:00+08:00",
  "notes": {
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890": {
      "local_path": "active/2026-05-27_142530_a1b2c3d4_voice.md",
      "last_remote_updated_at": "2026-05-27T14:25:30+08:00",
      "last_remote_content_hash": "sha256:def456...",
      "last_written_local_hash": "sha256:abc123..."
    }
  },
  "local_missing": {
    "note-id-1": {
      "first_detected": "2026-05-27T14:30:00+08:00",
      "detection_count": 2
    }
  },
  "audio_download_retries": {}
}
```

Key per-note fields:
- `last_remote_content_hash` — hash of Supabase content at time we last wrote to local
- `last_written_local_hash` — hash of local file right after we wrote it
- On next poll: compare current local hash to `last_written_local_hash`. Match → safe to overwrite. Differ → user modified locally, skip or handle conflict.

## 5. Sync Rules (PC Script)

### Startup & Config

1. Read config from Supabase `smartstickynotes_config` (folder path, filename template)
2. Verify folder path exists and is writable
3. If entire directory is unreachable → **pause sync immediately** and alert system tray. Never proceed with a missing root directory — this could mean a path config error, and proceeding could cause mass deletion of cloud-side status.

### Write with Conflict Detection

On each poll cycle, for each Supabase row with `synced_at IS NULL OR updated_at > synced_at`:

1. Check if local `.md` file exists
2. If file exists:
   a. Compute current local file hash
   b. Compare with `last_written_local_hash` from `.sync_state.json`
   c. **Hash matches** → local file unchanged since last sync. Safe to overwrite with Supabase version.
   d. **Hash differs** → user/AI modified locally.
      - If Supabase `updated_at` > `last_remote_updated_at` (Supabase also changed) → collision. Write `_conflict` copy, don't overwrite either.
      - If Supabase content hash matches `last_remote_content_hash` (Supabase unchanged) → local edit wins. Skip, don't overwrite. Log info.
3. If file does NOT exist:
   - Add to `local_missing` tracker in `.sync_state.json`
   - First detection: system tray warning "文件缺失: [filename]"
   - On N-th consecutive detection (N=3, configurable): prompt user via tray "N个文件持续缺失，是否标记为已删除？" → user chooses to mark as deleted or ignore
   - Never auto-delete Supabase status on first missing detection

### Status Actions

| Supabase status | PC Script action |
|-----------------|------------------|
| `active` (new / updated) | Conflict-check, then generate/overwrite `.md` in `active/`. Download audio to `audio/{note_id}.opus`. Set `synced_at`. Update `.sync_state.json` hashes. Audio stays on Supabase for PWA playback. |
| `deleted` | Move `.md` from `active/` to `trash/`, prefix filename with `_deleted_`. Set `synced_at`. Audio kept on Supabase (for recycle bin restore). |
| restored (`deleted`→`active`) | Move `.md` from `trash/` back to `active/`. If local file missing, rebuild from Supabase data. Set `synced_at`. |

### Permanent Delete Handling (via `deletion_events`)

On each poll cycle, for each row in `deletion_events`:
1. Delete local `active/{note}.md` or `trash/_deleted_{note}.md` (whichever exists)
2. Delete local `audio/{note_id}.opus` (if exists)
3. Remove note entry from `.sync_state.json`
4. Remove from `local_missing` tracker (if present)
5. Delete the `deletion_events` row

### Audio Download

- Download `audio/{note_id}.opus` from Supabase Storage
- Retry on failure: next poll cycle, up to 3 attempts, tracked in `.sync_state.json`
- After 3 failures: Markdown writes `[音频下载失败]` instead of a broken link. System tray alert with option to retry.
- Audio download is best-effort; failure does not block the Markdown file write

### Configuration Sync

- PC script reads config at startup and polls for changes each cycle (check `updated_at`)
- Config applied within one poll cycle (≤5 min)
- After saving config in PWA, UI shows: "已保存 · PC 端将在 5 分钟内生效"
- Settings page has a "立即同步配置" button that sets a `config_sync_requested_at` flag in config table; PC script checks this flag at higher frequency (every 30s) for 5 minutes after request

### Safety: Directory Unreachable

If the configured folder path is not accessible (drive disconnected, folder deleted, permissions changed):
1. **Immediately pause all sync operations**
2. System tray turns red, shows "笔记文件夹无法访问: [path]"
3. Do NOT mark any cloud-side notes as deleted
4. Resume automatically when folder becomes accessible
5. User can update path via PWA settings; PC detects config change within 5 min and tries new path

## 6. PWA (Frontend)

### Initial Setup Wizard

First-time user flow:

1. **Connection screen**: User enters Supabase Project URL + anon key. These are stored in IndexedDB for subsequent sessions. A "这是什么？" link explains where to find these in Supabase Dashboard.
2. **Login screen**: User enters email → Supabase sends magic link → user clicks link in email → redirected back to PWA, now authenticated.
3. **Setup wizard** (3 steps):
   - Step 1: "你的笔记文件夹在哪里？" → input path, e.g. `D:/OneDrive/Notes`
   - Step 2: "初始化数据库" → PWA displays SQL snippet. User copies it, pastes into Supabase Dashboard SQL Editor (one-time). SQL creates tables, enables RLS, creates Storage bucket with policies. This uses the Supabase Dashboard where user is already authenticated as project owner — no extra API keys.
   - Step 3: "下载 PC 同步脚本" → download link. Instructions: extract, run `SmartStickyNotes.Sync.exe`, it will open browser for login, then auto-register as Windows background service.
4. Wizard complete → main chat view

SQL snippet includes:
- `CREATE TABLE smartstickynotes_items (...)`
- `CREATE TABLE deletion_events (...)`
- `CREATE TABLE smartstickynotes_config (...)`
- All RLS policies (SELECT/INSERT/UPDATE/DELETE with USING + WITH CHECK)
- `CREATE POLICY` for Storage bucket

### Session Persistence

- Supabase Project URL + anon key → IndexedDB (persistent)
- Auth session → managed by Supabase SDK (automatic refresh)
- Subsequent opens → straight to main view if session is valid
- Logout option in settings clears session

### Main View — Chat-Style Interface

- Notes as chat bubbles (right-aligned), newest at top
- Voice notes: audio player + transcription below
- Text notes: clean text bubble
- Gestures:
  - **Swipe left** → soft-delete with toast: "已移至回收站" + "撤销" (3s). Toast at **top** of screen (not bottom, avoids finger occlusion after swipe).
  - **Long press** → context menu: copy, delete, share
- Top bar: sidebar toggle, last sync time ("已同步 · 2 分钟前"), pull-to-refresh

### Bottom Input Bar — Mode Switching

| Input state | Right button | Action |
|-------------|-------------|--------|
| Text empty, online | Mic icon | Long-press to record |
| Text empty, offline | Mic icon (greyed) | Tap shows toast: "当前离线，请使用文字输入" |
| Text has content | Send icon (↑) | Tap to send |

- After sending text, field auto-clears → mic icon returns
- After editing transcription, field has text → send icon
- Recording while field has text → transcription appended to existing text

### Voice Recording Flow (Online Only)

1. Long-press mic → recording starts (haptic, waveform animation)
2. Web Speech API transcribes in **real-time** from mic input, text appears below waveform
3. **Swipe up during recording → cancel** (discard all)
4. Release (no swipe-up) → recording stops. Audio saved as Opus/WebM (browser best-effort). Transcription shown in input area for editing.
5. Tap send → audio uploaded to Supabase Storage, note saved with `audio_path`, transcription saved in `text`
6. Audio always uploaded regardless of whether transcription succeeded

### Offline Behavior

- **Offline detection**: `navigator.onLine` + fetch failure fallback
- **Voice recording**: Disabled when offline. Mic icon greyed out. Tap shows toast.
- **Text notes**: Fully functional offline. Notes queued in IndexedDB.
- **Note browsing**: Last 100 notes cached in IndexedDB for offline viewing. Calendar/tag views work against cache.
- **Reconnect**: Queued notes auto-sent (FIFO). New notes (never synced) just POST to Supabase. Offline edits to existing notes (if enabled in future) would need conflict guard.
- Badge: "3 条待发送"

PWA offline capability is **best-effort**, not a reliable queue. IndexedDB may be cleared by browser storage pressure; iOS PWA background sync is limited. The primary use case is temporary offline (subway, elevator), not extended disconnected operation.

### Calendar View

- Entry: calendar icon (top-right)
- Tabs: **Day | Week | Month | Year**
  - **Day**: chronological list for selected date
  - **Week**: 7-day grid with dot indicators, selected day expanded below
  - **Month**: traditional calendar grid with dot indicators
  - **Year**: 12 month cards, each showing note count + first 2 summaries. Tap → enter that month.
- "Today" quick-jump always visible
- Drill-down: Year card → Month → Week → Day → note

### Tag System

- `#tagName` auto-detected (rules in section 4)
- Tags rendered as tappable pills in note bubbles
- Tag view: list of all tags with counts, tap to filter

### Audio Playback Controls

In voice note bubbles:
- Play/pause, time display, draggable progress, 1x/1.5x/2x speed
- Audio streamed via **fresh signed URL** generated at display time
- Signed URL cached client-side for 5 minutes (avoids re-generating on every re-render and spamming Supabase rate limits)
- `audio_path` is the source of truth in the DB; signed URL is ephemeral display-only

### Sidebar Menu

- All notes
- Recycle bin (deleted notes: restore / permanent delete)
- Tags
- Settings

### Recycle Bin

- Lists `status = "deleted"` notes
- **Restore**: sets `status = "active"`, `deleted_at = NULL`. PC moves file back on next sync. If local file missing, rebuild from Supabase data.
- **Permanent delete**: deletes audio from Storage (if voice note), inserts `deletion_events` row, then deletes the `smartstickynotes_items` row

### Settings Page

All settings (except Supabase connection info) read/written to Supabase `smartstickynotes_config`.

- Local folder path — "已保存 · PC 端将在 5 分钟内生效"
- "立即同步配置到 PC" button — sets flag that PC checks at 30s interval
- Last PC config sync time display
- Filename template with live preview (`{id}` mandatory)
- Default calendar view: Day / Week / Month
- Logout
- Version, sync stats, manual sync trigger

## 7. Voice-to-Text

- **Technology**: Web Speech API `SpeechRecognition` — browser built-in, free, real-time mic input only
- **Online only**: Voice recording requires network connectivity. Offline → voice button disabled with explanatory toast.
- **No deferred/file-based transcription**: Web Speech API cannot process audio files. Audio is saved and uploaded, but transcription only happens during the live recording session.
- **Transcription result** is shown immediately for editing before sending
- If Web Speech API returns empty result (recognition failed): text field shows `[识别未成功，请手动输入或重录]`, user can type text manually or re-record
- **No server-side ASR in MVP**. Future v2 may add Whisper API integration as optional paid add-on for offline-recorded audio transcription.

## 8. Configuration Architecture

```
Supabase smartstickynotes_config  ←  Source of truth for settings
        │
        ├── PWA reads/writes via authenticated REST API
        │
        └── PC sync script reads on startup + polls for changes (≤5 min staleness, 30s after "sync now" request)
```

- PWA also stores in IndexedDB: Supabase Project URL, anon key (connection info, not config)
- PWA auth session managed by Supabase SDK
- PC stores: refresh_token in Windows Credential Manager
- Filename template changes apply to new notes only; historical files not renamed
- Audio files named `{note_id}.opus` internally, completely decoupled from Markdown filename template

## 9. Design Principles

- Modern, minimal visual design — line-art outlines, no literal icons
- Chat-like interaction model — "taking notes is like messaging yourself"
- Near-zero learning curve — magic link login, WeChat-like recording gesture, chat-bubble UI
- Data sovereignty — all notes ultimately land as plain Markdown files with YAML frontmatter on local disk
- Low cost — Supabase free tier + Web Speech API = $0 operational cost
- Honest about limitations — PWA offline is best-effort; voice is online-only; no fake promises
- `anon` key in frontend is normal and expected; security is from RLS, not key secrecy
