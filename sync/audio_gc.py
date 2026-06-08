"""Clean up orphaned audio files not referenced by any active or deleted note."""
from pathlib import Path
from supabase_client import get_client

def collect_referenced_paths() -> set[str]:
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
