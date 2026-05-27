"""Main entry point for PC Sync Script."""
import sys
import os
import threading

from sync_loop import SyncLoop, run_sync_loop
from tray_app import TrayApp, HAS_TRAY
from auth import ensure_session
from config import read_config


def on_alert(level: str, msg: str):
    prefix = {"error": "[ERROR]", "warning": "[WARN]", "info": "[INFO]"}
    print(f"{prefix.get(level, '[?]')} {msg}")


def main():
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_ANON_KEY"):
        print("Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.")
        print("Usage: SUPABASE_URL=<url> SUPABASE_ANON_KEY=<key> SUPABASE_REFRESH_TOKEN=<token> python main.py")
        sys.exit(1)

    # Authenticate
    try:
        ensure_session()
    except RuntimeError as e:
        print(f"Authentication failed: {e}")
        sys.exit(1)

    # Read config
    config = read_config()
    folder = config.get("local_folder_path", "")
    if not folder:
        print("No local folder configured. Set it in PWA settings first.")
        sys.exit(1)

    loop = SyncLoop(on_alert=on_alert)

    if HAS_TRAY:
        sync_thread = threading.Thread(
            target=run_sync_loop,
            kwargs={"interval_seconds": 300, "on_alert": on_alert},
            daemon=True,
        )
        sync_thread.start()
        tray = TrayApp(loop, folder)
        tray.run()
    else:
        run_sync_loop(interval_seconds=300, on_alert=on_alert)


if __name__ == "__main__":
    main()
