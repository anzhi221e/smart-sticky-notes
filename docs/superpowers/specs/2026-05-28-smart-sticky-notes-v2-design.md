# Smart Sticky Notes v2 — Design Spec

**Date**: 2026-05-28
**Status**: Draft
**Based on**: v1 (2026-05-27)

## 1. Overview

v2 transforms Smart Sticky Notes from a simple note recorder into a lightweight knowledge management tool. Key changes:

- Tag-based Markdown aggregation (not one-file-per-note)
- Rich text editing with Markdown storage
- Dual toolbar (formatting + Obsidian syntax + tag quick bar)
- 6 themes (3 light, 3 dark)
- In-PWA deletion with 30-day recycle bin
- Infinite scroll, search, manual sync
- Reduced sync interval (30 min)

### Core Design Decision

**Local Markdown files are read-only exports.** Supabase is the single source of truth. PWA is the only editing entry point. The PC sync script generates local Markdown files for AI to read. Neither users nor AI should directly modify these exported files — if editing is needed, copy the files elsewhere first. This eliminates the bidirectional sync complexity that plagued v1's design.

## 2. Architecture (Revised)

```
PWA (rich text edit → Markdown storage)
        │
        ↓
    Supabase (source of truth)
        │
        ↓  PC sync (30min + manual trigger via sync_requests table)
        │
   OneDrive/Notes/
   ├── snapshots/
   │   └── 2026-05-28T143000/   ← atomic snapshot (all tag files + manifest)
   │       ├── manifest.json     ← marks snapshot complete, lists all files
   │       ├── 产品.md
   │       ├── 设计.md
   │       ├── 未分类.md
   │       └── ...
   ├── trash/                    ← read-only export of deleted notes
   │   └── deleted.md
   └── audio/                    ← audio files (shared, not per-snapshot)
```

### Sync Model

**Tag-based full regeneration into atomic snapshots** — each sync cycle:

1. Query all active notes from Supabase
2. Group by tag
3. Write all tag files into `snapshots/{timestamp}/` directory
4. Write `manifest.json` as the LAST file — AI should only read snapshots where manifest exists
5. Clean up old snapshots (keep last 5)
6. Multi-tag notes appear in all relevant tag files with `<!-- note:id=uuid -->` boundaries for AI dedup
7. Untagged notes → `未分类.md`
8. Deleted notes → `trash/deleted.md` (read-only export, recovery is PWA-only)
9. Deleted notes' audio kept until purge

**Data integrity**:
- Snapshot is complete or absent — manifest.json is written last, AI skips directories without it
- New snapshot directory, never overwrites in-place — no partial reads
- Supabase is always the source of truth; PC only exports
- Local files are read-only — editing or deleting them has no effect on Supabase data
- Old snapshots auto-rotated (keep 5) to prevent disk bloat

**Sync frequency**:
- Default: 30-minute interval
- Manual sync: PWA writes to `sync_requests` table → PC checks on poll cycle + every 30s when requests pending
- Auto-trigger on note save (immediate sync for new/edited content)

**Manual sync flow**:
```
PWA "立即同步" → INSERT sync_requests → PC polls (30s interval when pending)
                                          → executes full snapshot export
                                          → DELETEs sync_request row
                                          → updates last_sync timestamp in config
```
PWA shows "上次同步: N 分钟前" and "同步中..." during pending state.

### Deletion Lifecycle

```
PWA delete → status=deleted, deleted_at=now in Supabase
           → PWA recycle bin shows note with purge countdown
           → PC sync: note excluded from tag files, listed in trash/deleted.md
           → 30-day countdown

  Within 30 days: restore from PWA recycle bin → status=active, deleted_at=null
  30 days pass: PWA (on open) cleans up expired notes:
    - audio deleted from Storage
    - row deleted from smartstickynotes_items
    - PC catches up on next sync cycle
```

Purge is triggered by PWA, not PC — ensuring cleanup happens even if PC is offline. PC simply removes the note from trash/deleted.md on next sync.

## 3. Data Model Changes

### `smartstickynotes_items` — new columns

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | (unchanged) |
| user_id | uuid | (unchanged) |
| type | text | (unchanged) |
| text | text | **Now stores Markdown** (bold, italic, lists, headers, etc.) |
| tags | text[] | (unchanged) |
| audio_path | text? | (unchanged) |
| audio_duration | int? | (unchanged) |
| status | text | `"active"`, `"deleted"` (unchanged) |
| created_at | timestamptz | (unchanged) |
| updated_at | timestamptz | (unchanged) |
| deleted_at | timestamptz | Set on soft-delete, used for 30-day timer |
| synced_at | timestamptz | (unchanged) |

### `smartstickynotes_config` — new keys

| Key | Value | Notes |
|-----|-------|-------|
| `theme` | `"pink-light"` `"green-light"` `"blue-light"` `"dark-blue"` `"pure-black"` `"pink-dark"` | User's selected theme |
| `sync_interval` | minutes (default 30) | Configurable poll interval |
| `pinned_tags` | JSON array of tag names | Pinned tags for quick bar |

### Local Folder Structure (v2)

```
{configured_folder}/
├── snapshots/
│   ├── 2026-05-28T100000/
│   │   ├── manifest.json        ← {generated_at, notes_count, files: [...]}
│   │   ├── 产品.md
│   │   ├── 设计.md
│   │   └── 未分类.md
│   └── 2026-05-28T103000/       ← newest complete snapshot
│       └── ...
├── trash/
│   └── deleted.md               ← read-only export, recovery via PWA only
├── audio/
│   └── {note_id}.opus
├── .sync_state.json
└── manifest.json → symlink or copy of latest snapshot manifest
```

Old snapshots auto-rotated, keeping last 5.

### Tag Filename Safety

Tags are sanitized for Windows filename compatibility:
- `/ \ : * ? " < > |` → replaced with `_`
- Leading/trailing spaces and dots trimmed
- Max 100 characters, truncated if longer
- Unicode (emoji, CJK) preserved as-is
- Empty tag → `untagged`
- Tag `产品/设计` → file `产品_设计.md`

The mapping `original_tag → safe_filename` is stored in `manifest.json`.

### Tag MD File Format

Each note is wrapped in an HTML comment boundary for AI dedup:

```markdown
# 产品

<!-- note:id=abc123 created_at=2026-05-28T14:25:30+08:00 updated_at=2026-05-28T14:25:30+08:00 tags=产品,设计 -->

今天想了一个产品设计的**灵感**，需要验证
1. 第一步
2. 第二步

tags: #产品 #设计
> [收听录音](../audio/abc123.opus) (0:32)

---

<!-- note:id=def456 created_at=2026-05-28T10:08:00+08:00 -->

方案确认了，可以开始执行

---
```

The `<!-- note:id=uuid -->` boundary:
- Allows AI to identify and deduplicate notes appearing in multiple tag files
- Carries machine-readable metadata (id, timestamps, tags)
- Is invisible in rendered Markdown
- Enables stable note extraction by external tools

## 4. PWA UI (Revised)

### Main View

```
┌─────────────────────────────────┐
│  ☰  搜索笔记...            📅  │  ← search bar
├─────────────────────────────────┤
│                                 │
│  ┌────────────────────────┐    │  ← note bubbles (Markdown rendered)
│  │ 今天想了一个产品设计的   │    │
│  │ **灵感**，需要验证      │    │
│  │ 1. 第一步               │    │
│  │ 2. 第二步               │    │
│  │ #产品 #设计    14:25   │    │
│  └────────────────────────┘    │
│                                 │
│  [infinite scroll up for more] │
│                                 │
├─────────────────────────────────┤  ← toolbar (hidden when idle)
│ B  I  U  S̶  ••  1.  │ # ## ### :: > │  ← Row 1
├─────────────────────────────────┤
│ #产品 #设计 #待办 #灵感 #读书 →  │  ← Row 2
├─────────────────────────────────┤
│ ┌───────────────────────┐ [🎤]  │
│ │ 输入文字...            │       │
│ └───────────────────────┘       │
└─────────────────────────────────┘
```

**Toolbar visibility**: Hidden by default. Slides in when text input is focused (new note) or when editing an existing bubble.

### Toolbar — Row 1: Formatting

Left group — rich text (inserts Markdown syntax):
| Button | Action | Markdown |
|--------|--------|----------|
| **B** | Bold | `**text**` |
| *I* | Italic | `*text*` |
| U | Underline | `<u>text</u>` |
| S̶ | Strikethrough | `~~text~~` |
| •• | Bullet list | `- item` |
| 1. | Numbered list | `1. item` |

Right group — Obsidian syntax:
| Button | Insert |
|--------|--------|
| # | `# ` |
| ## | `## ` |
| ### | `### ` |
| :: | `::` |
| > | `> ` |

### Toolbar — Row 2: Tag Quick Bar

Horizontal scrollable pills. Order:
1. Pinned tags (from settings)
2. 5 most recently used tags
3. 5 most frequently used tags
4. Tapping a pill inserts `#tagName` at cursor position

### Note Bubbles — Gestures

| Gesture | Action |
|---------|--------|
| Swipe left | Soft delete (toast + undo) |
| Long press | Menu: Edit / Delete / Copy |
| Tap tag pill | Filter by tag |

### Editing an Existing Note

Long press bubble → "Edit" → bubble transforms to editable:

```
│  ┌────────────────────────┐    │
│  │ [editable textarea]     │    │  ← direct inline editing
│  │ 今天想了一个...         │    │
│  │                         │    │
│  │ [保存] [取消]           │    │
│  └────────────────────────┘    │
```

- Textarea shows raw Markdown
- Toolbar (Row 1+2) slides in for formatting
- Save → updates `text` + `updated_at` in Supabase
- Cancel → reverts to original
- Bubble position unchanged after save

### Markdown Rendering

Bubbles render Markdown to formatted display:
- `**bold**` → bold
- `*italic*` → italic
- `~~strike~~` → strikethrough
- `- item` → bullet
- `1. item` → numbered list
- `# Heading` → heading
- `> quote` → blockquote
- `::smart-connections` → styled as obsidian syntax

Unrecognized text renders as plain text (backwards compatible with v1 notes).

### Tags View

Two display modes, toggled via top-right button.

**Card Mode** (default, 2-column grid):

```
┌──────────────┐ ┌──────────────┐
│ #产品    📌  │ │ #设计        │
│ 12 条        │ │ 8 条         │
│ 今天想了一个  │ │ 方案确认了...│
│ 产品设计的... │ │              │
└──────────────┘ └──────────────┘
```

**List Mode** (single column rounded cards):

```
┌──────────────────────────────┐
│ #产品  📌  12 条              │
│ 今天想了一个产品设计的灵感... │
└──────────────────────────────┘
```

**Tag card gestures**:
- Tap → enter that tag's note list
- Long press → menu: Pin toggle / Delete tag's notes

**Pinned tags**: Appear first with a pushpin SVG icon. Pinned tags also appear first in the tag quick bar.

### Search

Top bar search input. As user types, filter notes in real-time by text content (client-side for loaded notes, server-side `.ilike()` query for broader search). Search works across all notes regardless of tag.

### Infinite Scroll

- Initial load: 50 most recent notes
- Scroll to top → load next 50
- Uses Supabase `range(offset, offset+50)` with cursor-based pagination on created_at

### Recycle Bin

- Access from sidebar menu
- Lists deleted notes with time-until-purge countdown
- Restore: status → active, re-included in next sync
- "Empty trash" button: permanently delete all expired (30+ day) notes

### Settings (New Items)

- **Theme selector**: 6 options with live preview thumbnails
- **Sync interval**: number input (minutes, default 30, min 5)
- **Manual sync button**: "立即同步" — writes to `sync_requests` table, shows "PC 将在 30 秒内响应" or "上次同步: N 分钟前"
- **Pinned tags**: multi-select from existing tags
- **Removed**: `filename_template` — no longer applicable under tag-based aggregation
- Existing settings (folder path, calendar view) unchanged

### Sync Requests Table (New)

```sql
CREATE TABLE sync_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    requested_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed'))
);
```

- PWA inserts `pending` row on manual sync request
- PC script checks: if `pending` rows exist → poll at 30s instead of 30min
- PC sets `processing` → runs sync → sets `completed`
- PWA shows sync status based on most recent request state

## 5. Themes

All themes use CSS custom properties. Switching updates `document.documentElement` attributes.

### Light Themes

| # | Name | Background | Surface | Accent | Text |
|---|------|-----------|---------|--------|------|
| 1 | 粉色晨曦 | `#fff5f7` | `#fff` / `#ffe0e5` | `#e91e63` | `#333` / `#888` |
| 2 | 青绿薄荷 | `#f5fff8` | `#fff` / `#e0ffe8` | `#10b981` | `#333` / `#888` |
| 3 | 晴空蓝 | `#f5f8ff` | `#fff` / `#e0e8ff` | `#3b82f6` | `#333` / `#888` |

Light themes have: white bubbles, subtle colored borders, dark text.

### Dark Themes

| # | Name | Background | Surface | Accent | Text |
|---|------|-----------|---------|--------|------|
| 4 | 暗夜蓝 | `#0f1119` | `#1a1d2e` / `#252840` | `#6c8cff` | `#e8e8e8` / `#888` |
| 5 | 纯黑 | `#000` | `#111` / `#1a1a1a` | `#4ade80` | `#e8e8e8` / `#888` |
| 6 | 灰粉暮色 | `#1a1518` | `#261f23` / `#32282d` | `#e05588` | `#e8d8dc` / `#988` |

Dark themes use the existing v1 dark style as base.

## 6. PC Sync Script Changes

### Sync Loop (Revised)

```
1. Check sync_requests table for pending requests → if found, poll at 30s
2. Query all active notes (status=active) from Supabase
3. Build tag slug map from tags (sanitize for filename safety)
4. Create new snapshot directory: snapshots/{ISO timestamp}/
5. For each unique tag → generate {tag_slug}.md with all belonging notes
   - Each note wrapped in <!-- note:id=uuid ... --> boundary
   - Multi-tag notes appear in all relevant files
   - Notes with no tags → 未分类.md
6. Query deleted notes → generate trash/deleted.md
7. Write manifest.json LAST (marks snapshot complete)
8. Clean up old snapshots (keep 5, delete oldest)
9. Mark sync_request row as completed (if manual trigger)
```

### Removed Features from v1

- Individual note `.md` files — replaced by tag aggregation
- Conflict detection (hash comparison) — not applicable to read-only export
- Local file missing detection — not applicable
- `deletion_events` table — still used, PC cleans up local trash on purge
- `filename_template` config — replaced by fixed `{tag_slug}.md`

### Auth

Service role key (stored in `sync/.env`, gitignored) for PC script. This is a local trusted process, not a shared client. v1's working approach is maintained.

## 7. Voice & Audio (Unchanged from v1)

- Web Speech API: real-time mic input, online only
- Offline voice recording disabled with toast
- Audio encoding: Opus 16kbps mono
- Audio permanently stored on Supabase
- Audio player: play/pause, seek, speed control

## 8. Configuration Architecture (Unchanged from v1)

```
Supabase smartstickynotes_config  ←  source of truth
        │
        ├── PWA reads/writes
        │
        └── PC sync script reads on startup + polls for changes
```

New config keys: `theme`, `sync_interval`, `pinned_tags`

## 9. Design Principles

- Modern, minimal — line-art outlines
- Chat-like — "taking notes is like messaging yourself"
- Markdown-native — WYSIWYG editing, pure Markdown storage
- Tag-centric — tags are the organizing principle, not folders
- Read-only local export — local files are derived, Supabase is truth
- Low cost — Supabase free tier + Web Speech API = $0
