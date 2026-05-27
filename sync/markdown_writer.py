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
