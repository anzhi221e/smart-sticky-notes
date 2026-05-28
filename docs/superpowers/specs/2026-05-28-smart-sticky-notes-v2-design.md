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

## 2. Architecture (Revised)

```
PWA (rich text edit → Markdown storage)
        │
        ↓
    Supabase (source of truth)
        │
        ↓  PC sync (30min + manual trigger)
        │
   OneDrive/Notes/
   ├── 产品.md          ← all #产品 notes aggregated
   ├── 设计.md          ← all #设计 notes aggregated
   ├── 未分类.md        ← notes without tags
   ├── trash/           ← 30-day soft-delete staging
   └── audio/           ← audio files
```

### Sync Model

**Tag-based full regeneration** — each sync cycle:

1. Query all active notes from Supabase
2. Group by tag
3. Regenerate each `{tag}.md` with all notes for that tag
4. Notes with multiple tags appear in all relevant files
5. Untagged notes go to `未分类.md`
6. Deleted notes (status=deleted) are excluded

**Data integrity**:
- Atomic writes: write to `.tmp` → verify → rename old to `.bak` → rename `.tmp` to final
- Supabase is always the source of truth; PC only exports
- Local folder is read-only from PWA's perspective
- Deleting or editing local `.md` files has no effect on Supabase data

**Sync frequency**:
- Default: 30-minute interval
- Manual sync button in PWA settings
- Auto-trigger on note send (immediate sync for new content)

### Deletion Lifecycle

```
PWA delete → status=deleted in Supabase → excluded from tag aggregation
                                        → PC moves to trash/
                                        → 30-day countdown starts
  30 days pass → auto-purge:
    - Supabase row deleted
    - audio file deleted from Storage
    - local trash/ file deleted
  Within 30 days → restore from recycle bin
```

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
├── 产品.md
├── 设计.md
├── 待办.md
├── 未分类.md
├── trash/
│   ├── _deleted_产品.md
│   └── ...
├── audio/
│   └── {note_id}.opus
└── .sync_state.json
```

### Tag MD File Format

```markdown
# 产品



今天想了一个产品设计的**灵感**，需要验证
1. 第一步
2. 第二步

tags: #产品 #设计
> [收听录音](../audio/a1b2c3d4.opus) (0:32)

---

方案确认了，可以开始执行
> 引用自会议纪要

---

```

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
- **Manual sync button**: "立即同步" with last sync timestamp
- **Pinned tags**: multi-select from existing tags
- Existing settings (folder path, filename template, calendar view) unchanged

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
1. Query all active notes (status=active) from Supabase
2. Group by tag:
   - For each unique tag → create {tag}.md with all belonging notes
   - Multi-tag notes appear in each relevant file
   - Notes with no tags → 未分类.md
3. Query deleted notes (status=deleted, deleted_at < 30 days):
   - Move corresponding content out of tag files
   - Move any remaining trash/ files
4. Handle purged notes (deleted_at > 30 days):
   - Delete from Supabase (row + audio)
   - Delete from local trash/
5. Atomic write for every .md file (.tmp → .bak → final)
```

### Removed Features from v1

- Individual note `.md` files are no longer generated
- Conflict detection (hash comparison) no longer needed — tag files are fully regenerated
- Local file missing detection no longer needed
- `deletion_events` table still used for PC-notification of permanent deletions

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
