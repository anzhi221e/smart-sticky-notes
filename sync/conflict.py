"""Hash-based conflict detection for sync operations."""
from pathlib import Path
from sync_state import compute_file_hash


class ConflictResult:
    OVERWRITE = "overwrite"       # Local unchanged, safe to overwrite
    SKIP_LOCAL_WINS = "skip"      # Local edited, remote unchanged — keep local
    COLLISION = "collision"       # Both changed — write conflict copy
    MISSING = "missing"           # Local file doesn't exist


def detect(file_path: Path, note_id: str, sync_state) -> str:
    """Detect conflict state between local file and remote note.

    Returns one of: overwrite, skip, collision, missing
    """
    note_state = sync_state.get_note_state(note_id)
    if note_state is None:
        return ConflictResult.OVERWRITE if file_path.exists() else ConflictResult.MISSING

    if not file_path.exists():
        return ConflictResult.MISSING

    # If there's a note_state but we haven't written locally yet, allow overwrite
    last_written_hash = note_state.get("last_written_local_hash", "")
    if not last_written_hash:
        return ConflictResult.OVERWRITE

    current_local_hash = compute_file_hash(file_path)
    if current_local_hash == last_written_hash:
        return ConflictResult.OVERWRITE

    return ConflictResult.SKIP_LOCAL_WINS


def resolve(current_local_hash: str, last_written_hash: str,
            new_remote_hash: str, last_remote_hash: str) -> str:
    """Full resolution when we have both old and new hashes.

    Returns: overwrite, skip, collision
    """
    local_changed = bool(last_written_hash and current_local_hash != last_written_hash)
    remote_changed = bool(last_remote_hash and new_remote_hash != last_remote_hash)

    if not local_changed and not remote_changed:
        return ConflictResult.OVERWRITE
    if local_changed and not remote_changed:
        return ConflictResult.SKIP_LOCAL_WINS
    if not local_changed and remote_changed:
        return ConflictResult.OVERWRITE
    return ConflictResult.COLLISION
