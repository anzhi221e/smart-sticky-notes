"""Main sync loop: poll Supabase, detect changes, write Markdown files."""
from datetime import datetime, timezone
from pathlib import Path
import time

from supabase_client import get_client
from config import read_config
from sync_state import SyncState, compute_hash, compute_file_hash
from markdown_writer import write_note, move_to_trash, move_to_active, delete_local_files
from conflict import ConflictResult, resolve as resolve_conflict
from audio_downloader import download as download_audio

MISSING_THRESHOLD = 3


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
        stats = {
            "created": 0, "updated": 0, "deleted": 0,
            "restored": 0, "purged": 0, "skipped": 0,
            "conflicts": 0, "missing": 0, "errors": 0,
        }

        # Fetch changed notes
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

        # Fetch deletion events
        del_result = client.table("deletion_events").select("*").execute()
        for event in del_result.data:
            self._handle_purge(event, state, folder, stats)
            client.table("deletion_events").delete().eq("id", event["id"]).execute()

        # Update cursor
        state.set_cursor(datetime.now(timezone.utc).isoformat())
        state.save()
        return stats

    def _handle_active(self, note, note_id, remote_hash, state, folder, template, stats):
        note_state = state.get_note_state(note_id)
        note_id_short = note_id[:8]
        local_path = note_state["local_path"] if note_state else None
        expected_path = Path(folder) / (local_path or "") if local_path else None

        # Check for previously-synced file that's now missing
        if note_state and note.get("synced_at") and expected_path and not expected_path.exists():
            entry = state.set_local_missing(note_id)
            count = entry["detection_count"]
            if count >= MISSING_THRESHOLD:
                self.on_alert("warning",
                    f"File missing for {count} cycles: {note_id_short}. "
                    f"Check tray to confirm deletion.")
            else:
                self.on_alert("warning",
                    f"Local file missing: {note_id_short} "
                    f"(detection {count}/{MISSING_THRESHOLD})")
            state.save()
            stats["missing"] += 1
            return

        # Conflict detection for existing files
        if note_state and expected_path and expected_path.exists():
            current_local_hash = compute_file_hash(expected_path)
            last_written = note_state.get("last_written_local_hash", "")
            last_remote = note_state.get("last_remote_content_hash", "")

            result = resolve_conflict(current_local_hash, last_written, remote_hash, last_remote)
            if result == ConflictResult.COLLISION:
                conflict_path = expected_path.with_suffix(".conflict.md")
                with open(conflict_path, "w", encoding="utf-8") as f:
                    f.write(f"# CONFLICT\nBoth local and remote changed.\n"
                            f"Local file preserved at: {expected_path.name}\n"
                            f"Remote version saved here.\n")
                stats["conflicts"] += 1
                return
            elif result == ConflictResult.SKIP_LOCAL_WINS:
                stats["skipped"] += 1
                # Still mark synced so we don't re-check every cycle
                client = get_client()
                client.table("smartstickynotes_items").update(
                    {"synced_at": datetime.now(timezone.utc).isoformat()}
                ).eq("id", note_id).execute()
                return

        # Write note
        rel_path = write_note(note, folder, template, remote_hash)
        written_path = Path(folder) / rel_path
        written_hash = compute_file_hash(written_path)

        # Download audio if voice note
        audio_failed = False
        if note.get("type") == "voice" and note.get("audio_path"):
            ok = download_audio(note_id, note["audio_path"], folder, state)
            if not ok:
                retries = state.get_audio_retries(note_id).get("retries", 0)
                if retries >= 3:
                    with open(written_path, "a", encoding="utf-8") as f:
                        f.write("\n[音频下载失败]\n")
                    self.on_alert("error", f"Audio download failed after 3 retries: {note_id_short}")
                    audio_failed = True

        state.set_note_state(note_id, rel_path, note.get("updated_at", ""), remote_hash)
        state.set_written_local_hash(note_id, written_hash)
        state.clear_local_missing(note_id)

        # Mark synced
        client = get_client()
        client.table("smartstickynotes_items").update(
            {"synced_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", note_id).execute()

        if note_state and note_state.get("last_written_local_hash"):
            stats["updated"] += 1
        else:
            stats["created"] += 1

    def _handle_deleted(self, note, note_id, state, folder, stats):
        note_state = state.get_note_state(note_id)
        if note_state:
            local_path = note_state["local_path"]
            new_path = move_to_trash(note_id, folder, local_path)
            if new_path:
                state.set_note_state(note_id, new_path,
                    note.get("updated_at", ""),
                    note_state.get("last_remote_content_hash", ""))

        client = get_client()
        client.table("smartstickynotes_items").update(
            {"synced_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", note_id).execute()
        stats["deleted"] += 1

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
                    on_alert("info", f"Sync complete: {stats}")
        except Exception as e:
            if on_alert:
                on_alert("error", f"Sync cycle failed: {e}")
            else:
                print(f"[ERROR] Sync cycle failed: {e}")
        for _ in range(interval_seconds):
            if not loop.running:
                break
            time.sleep(1)
