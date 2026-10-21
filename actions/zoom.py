"""
Zoom actions using xdotool (sends Ctrl++ / Ctrl+- / Ctrl+0).
Works in most applications (browsers, editors, etc.).
Requires X11 session - does not work on Wayland.
"""
import subprocess


class ZoomActions:
    def __init__(self, has_xdotool, is_wayland):
        self.has_xdotool = has_xdotool
        self.is_wayland = is_wayland

    def _check_x11(self):
        if not self.has_xdotool:
            return "xdotool not installed (sudo apt install xdotool)"
        if self.is_wayland:
            return "xdotool requires X11 session (not Wayland)"
        return None

    def adjust(self, delta):
        """Adjust zoom by delta steps (positive = zoom in, negative = zoom out)"""
        err = self._check_x11()
        if err:
            return {"error": err}

        try:
            if delta > 0:
                # Zoom in: Ctrl++
                subprocess.run(["xdotool", "key", "ctrl+plus"], check=True, timeout=2)
            elif delta < 0:
                # Zoom out: Ctrl+-
                subprocess.run(["xdotool", "key", "ctrl+minus"], check=True, timeout=2)
            else:
                # Reset zoom: Ctrl+0
                subprocess.run(["xdotool", "key", "ctrl+0"], check=True, timeout=2)

            return {"action": "zoom", "delta": delta}
        except subprocess.CalledProcessError as e:
            return {"error": f"xdotool failed: {e}"}
        except subprocess.TimeoutExpired:
            return {"error": "xdotool timeout"}

    def set_zoom(self, level_pct):
        """Set zoom level - not directly supported, would need app-specific approach"""
        # This would require application-specific implementation
        # For now, just return info
        return {"action": "zoom_info", "message": "Absolute zoom set not supported; use relative adjust"}