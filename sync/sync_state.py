"""Manage .sync_state.json — the PC sync script's local state file."""
import json
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Any

class SyncState:
    def __init__(self, folder_path: str):
        self.path = Path(folder_path) / ".sync_state.json"
        self.data: dict[str, Any] = {
            "last_sync_cursor": None,
            "notes": {},
            "local_missing": {},
            "audio_download_retries": {},
            "config_last_updated": None,
        }
        self._load()

    def _load(self) -> None:
        if self.path.exists():
            with open(self.path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                self.data.update(loaded)

    def save(self) -> None:
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=2, ensure_ascii=False)

    def get_cursor(self) -> str | None:
        return self.data.get("last_sync_cursor")

    def set_cursor(self, cursor: str) -> None:
        self.data["last_sync_cursor"] = cursor

    def get_note_state(self, note_id: str) -> dict | None:
        return self.data["notes"].get(note_id)

    def set_note_state(self, note_id: str, local_path: str,
                       remote_updated_at: str, remote_content_hash: str) -> None:
        self.data["notes"][note_id] = {
            "local_path": local_path,
            "last_remote_updated_at": remote_updated_at,
            "last_remote_content_hash": remote_content_hash,
            "last_written_local_hash": "",
        }

    def set_written_local_hash(self, note_id: str, file_hash: str) -> None:
        if note_id in self.data["notes"]:
            self.data["notes"][note_id]["last_written_local_hash"] = file_hash

    def remove_note(self, note_id: str) -> None:
        self.data["notes"].pop(note_id, None)
        self.data["local_missing"].pop(note_id, None)
        self.data["audio_download_retries"].pop(note_id, None)

    def get_local_missing(self, note_id: str) -> dict | None:
        return self.data["local_missing"].get(note_id)

    def set_local_missing(self, note_id: str) -> dict:
        now = datetime.now().isoformat()
        existing = self.data["local_missing"].get(note_id, {})
        entry = {
            "first_detected": existing.get("first_detected", now),
            "last_detected": now,
            "detection_count": existing.get("detection_count", 0) + 1,
        }
        self.data["local_missing"][note_id] = entry
        return entry

    def clear_local_missing(self, note_id: str) -> None:
        self.data["local_missing"].pop(note_id, None)

    def get_audio_retries(self, note_id: str) -> dict:
        return self.data["audio_download_retries"].get(note_id, {"retries": 0})

    def increment_audio_retries(self, note_id: str) -> int:
        entry = self.get_audio_retries(note_id)
        entry["retries"] += 1
        entry["last_attempt"] = datetime.now().isoformat()
        self.data["audio_download_retries"][note_id] = entry
        return entry["retries"]

    def clear_audio_retries(self, note_id: str) -> None:
        self.data["audio_download_retries"].pop(note_id, None)

    def get_config_last_updated(self) -> str | None:
        return self.data.get("config_last_updated")

    def set_config_last_updated(self, timestamp: str) -> None:
        self.data["config_last_updated"] = timestamp


def compute_hash(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def compute_file_hash(path: Path) -> str:
    with open(path, "rb") as f:
        return "sha256:" + hashlib.sha256(f.read()).hexdigest()[:16]
