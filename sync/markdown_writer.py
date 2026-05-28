"""Generate compact tag-aggregated Markdown snapshot exports."""
import hashlib
import json
from pathlib import Path
from datetime import datetime
from tag_slug import build_tag_map


def _format_time(iso_str: str) -> str:
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.strftime("%m-%d %H:%M")
    except (ValueError, AttributeError):
        return iso_str or ""


def _render_note(note: dict) -> str:
    note_id_short = note["id"][:8]
    text = (note.get("text") or "").strip()
    lines = [
        f"### {_format_time(note.get('created_at'))} | `id:{note_id_short}`",
        "",
        text,
    ]

    if note.get("audio_path"):
        dur = note.get("audio_duration", 0) or 0
        mins, secs = divmod(int(dur), 60) if dur else (0, 0)
        lines.extend([
            "",
            f"> [收听录音](../../audio/{note_id_short}.opus) ({mins}:{secs:02d})",
        ])

    lines.extend(["", "---", ""])
    return "\n".join(lines)


def build_tag_files(notes: list[dict]) -> tuple[dict[str, str], dict[str, str]]:
    all_tags = set()
    for note in notes:
        for tag in note.get("tags", []):
            if tag.strip():
                all_tags.add(tag.strip())

    tag_map = build_tag_map(list(all_tags))
    tag_notes: dict[str, list[str]] = {filename: [] for filename in tag_map.values()}
    untagged_notes = []

    for note in notes:
        rendered = _render_note(note)
        note_tags = [t.strip() for t in note.get("tags", []) if t.strip()]
        if not note_tags:
            untagged_notes.append(rendered)
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
            result[filename] = f"# {tag_display}\n\n" + "\n".join(note_texts)

    if untagged_notes:
        result["未分类.md"] = "# 未分类\n\n" + "\n".join(untagged_notes)

    return result, tag_map


def write_snapshot(active_notes: list[dict], deleted_notes: list[dict], folder: str) -> dict:
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
            file_matches = [tag_map.get(t) for t in note_tags if t in tag_map]
            if filename in file_matches:
                note_ids.append(note["id"])
        manifest_files.append({
            "tag": tag,
            "filename": filename,
            "note_ids": note_ids,
            "sha256": sha,
        })

    trash_dir = Path(folder) / "trash"
    trash_dir.mkdir(parents=True, exist_ok=True)
    if deleted_notes:
        trash_content = "# 已删除的笔记\n\n"
        for note in deleted_notes:
            trash_content += _render_note(note)
        (trash_dir / "deleted.md").write_text(trash_content, encoding="utf-8")
    else:
        (trash_dir / "deleted.md").write_text("# 已删除的笔记\n\n回收站为空\n", encoding="utf-8")

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
    (snap_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

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
