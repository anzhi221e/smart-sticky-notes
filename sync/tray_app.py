"""Windows system tray icon for the sync script."""
import subprocess
from pathlib import Path

try:
    import pystray
    from PIL import Image, ImageDraw
    HAS_TRAY = True
except ImportError:
    HAS_TRAY = False


class TrayApp:
    def __init__(self, sync_loop, folder_path: str):
        self.sync_loop = sync_loop
        self.folder_path = folder_path
        self.icon = None
        self.status = "idle"

    def _create_icon_image(self, color: str):
        size = 64
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        colors = {
            "green": (0, 200, 100),
            "orange": (255, 165, 0),
            "red": (220, 50, 50),
            "grey": (128, 128, 128),
        }
        c = colors.get(color, colors["grey"])
        margin = 12
        draw.rounded_rectangle(
            [margin, margin, size - margin, size - margin], radius=12, fill=c
        )
        return img

    def _set_status(self, status: str):
        self.status = status
        if self.icon and HAS_TRAY:
            color = {"idle": "green", "syncing": "orange", "error": "red"}.get(
                status, "grey"
            )
            self.icon.icon = self._create_icon_image(color)

    def _open_folder(self):
        subprocess.Popen(["explorer", self.folder_path])

    def _force_sync(self):
        self._set_status("syncing")
        try:
            stats = self.sync_loop.run_once()
            self._set_status("idle")
            # Show notification if changes
            total = sum(v for k, v in stats.items() if isinstance(v, int))
            if total > 0 and self.icon and HAS_TRAY:
                self.icon.notify(f"同步完成: {stats}")
        except Exception as e:
            self._set_status("error")
            if self.icon and HAS_TRAY:
                self.icon.notify(f"同步失败: {e}")

    def _create_menu(self):
        if not HAS_TRAY:
            return None
        return pystray.Menu(
            pystray.MenuItem("立即同步", lambda: self._force_sync()),
            pystray.MenuItem("打开笔记文件夹", lambda: self._open_folder()),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("退出", lambda: self.stop()),
        )

    def run(self):
        if not HAS_TRAY:
            print("pystray not available, running without system tray")
            return

        self.icon = pystray.Icon(
            "smartstickynotes",
            self._create_icon_image("green"),
            "Smart Sticky Notes",
            menu=self._create_menu(),
        )
        self._set_status("idle")
        self.icon.run()

    def stop(self):
        self.sync_loop.stop()
        if self.icon and HAS_TRAY:
            self.icon.stop()
