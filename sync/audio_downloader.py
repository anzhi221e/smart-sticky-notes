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
        sync_state.save()
        return False
