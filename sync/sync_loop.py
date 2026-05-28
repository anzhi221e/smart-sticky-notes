"""Main sync loop v2: snapshot export with tag aggregation."""
from datetime import datetime, timezone, timedelta
from pathlib import Path
import time

from supabase_client import get_client
from config import read_config
from markdown_writer import write_snapshot, rotate_snapshots
from audio_gc import cleanup_orphans

SYNC_REQUEST_TIMEOUT_MINUTES = 10


class SyncLoopV2:
    def __init__(self, on_alert=None):
        self.on_alert = on_alert or (lambda level, msg: print(f"[{level.upper()}] {msg}"))
        self.running = False

    def stop(self):
        self.running = False

    def run_once(self) -> dict:
        client = get_client(use_service_role=True)
        config = read_config()
        folder = config.get("local_folder_path", "")
        if not folder:
            return {"status": "no_folder"}

        folder_path = Path(folder)
        if not folder_path.is_dir():
            self.on_alert("error", f"Folder not accessible: {folder}")
            return {"status": "folder_inaccessible"}

        has_requests = self._check_sync_requests(client)

        active = client.table("smartstickynotes_items").select("*").eq("status", "active").execute()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        deleted = client.table("smartstickynotes_items").select("*").eq("status", "deleted").gte("deleted_at", cutoff).execute()

        self._purge_expired(client, folder)

        manifest = write_snapshot(active.data, deleted.data, folder)
        rotate_snapshots(folder, keep=5)
        removed = cleanup_orphans(folder)
        if removed:
            self.on_alert("info", f"Cleaned {removed} orphaned audio files")

        now_iso = datetime.now(timezone.utc).isoformat()
        self._update_last_sync_at(client, config, now_iso)
        self._complete_sync_request(client, success=True)

        return {
            "status": "ok",
            "active": len(active.data),
            "deleted": len(deleted.data),
            "files": len(manifest.get("files", [])),
            "audio_cleaned": removed,
            "has_requests": has_requests,
        }

    def _check_sync_requests(self, client) -> bool:
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=SYNC_REQUEST_TIMEOUT_MINUTES)).isoformat()
        pending = client.table("sync_requests").select("*").or_(
            f"status.eq.pending, and(status.eq.processing,processing_started_at.lt.{cutoff})"
        ).execute()

        for req in pending.data:
            client.table("sync_requests").update({
                "status": "processing",
                "processing_started_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", req["id"]).execute()

        return len(pending.data) > 0

    def _complete_sync_request(self, client, success: bool, error_msg: str = ""):
        now = datetime.now(timezone.utc).isoformat()
        if success:
            client.table("sync_requests").update({
                "status": "completed", "completed_at": now,
            }).eq("status", "processing").execute()
        else:
            client.table("sync_requests").update({
                "status": "failed", "error_message": error_msg, "completed_at": now,
            }).eq("status", "processing").execute()

    def _update_last_sync_at(self, client, config, timestamp: str):
        users = client.auth.admin.list_users()
        if users:
            uid = users[0].id
            client.table("smartstickynotes_config").upsert({
                "user_id": uid, "key": "last_sync_at",
                "value": timestamp, "updated_at": timestamp,
            }, on_conflict="user_id,key").execute()

    def _purge_expired(self, client, folder: str):
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        expired = client.table("smartstickynotes_items").select("id, audio_path").eq("status", "deleted").lt("deleted_at", cutoff).execute()
        for note in expired.data:
            if note.get("audio_path"):
                try:
                    client.storage.from_("smartstickynotes_audio").remove([note["audio_path"]])
                except Exception:
                    pass
            client.table("smartstickynotes_items").delete().eq("id", note["id"]).execute()


def run_sync_loop(interval_seconds: int = 1800, on_alert=None):
    loop = SyncLoopV2(on_alert=on_alert)
    loop.running = True
    while loop.running:
        try:
            stats = loop.run_once()
            if stats.get("status") == "ok":
                on_alert("info", f"Sync: {stats['active']} active, {stats['deleted']} deleted, {stats['files']} files")
        except Exception as e:
            on_alert("error", f"Sync failed: {e}")
        for _ in range(interval_seconds):
            if not loop.running:
                break
            time.sleep(1)
