"""Main entry point for PC Sync Script.

Uses service_role key from sync/.env file for admin access.
No user login required — service_role bypasses RLS.
"""
import sys
import os
import threading

from sync_loop import SyncLoopV2, run_sync_loop
from tray_app import TrayApp, HAS_TRAY
from auth import ensure_session
from config import read_config
from supabase_client import get_client


def on_alert(level: str, msg: str):
    prefix = {"error": "[ERROR]", "warning": "[WARN]", "info": "[INFO]"}
    print(f"{prefix.get(level, '[?]')} {msg}")


def main():
    # Verify credentials
    try:
        client = get_client(use_service_role=True)
    except RuntimeError as e:
        print(str(e))
        sys.exit(1)

    # service_role doesn't need session management
    ensure_session()

    config = read_config()
    folder = config.get("local_folder_path", "")
    if not folder:
        print("No local folder configured. Set it in PWA settings first.")
        print("Or run: python -c \"from supabase_client import get_client; ...\" to insert config.")
        sys.exit(1)

    loop = SyncLoopV2(on_alert=on_alert)

    # --once flag: run one cycle and exit (for Task Scheduler)
    if "--once" in sys.argv:
        stats = loop.run_once()
        print(f"Sync done: {stats}")
        sys.exit(0)

    if HAS_TRAY:
        sync_thread = threading.Thread(
            target=run_sync_loop,
            kwargs={"interval_seconds": 1800, "on_alert": on_alert},
            daemon=True,
        )
        sync_thread.start()
        tray = TrayApp(loop, folder)
        tray.run()
    else:
        run_sync_loop(interval_seconds=1800, on_alert=on_alert)


if __name__ == "__main__":
    main()
