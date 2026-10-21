"""
Mouse actions using xdotool.
Requires X11 session - does not work on Wayland.
"""
import subprocess


class MouseActions:
    def __init__(self, has_xdotool, is_wayland):
        self.has_xdotool = has_xdotool
        self.is_wayland = is_wayland

    def _check_x11(self):
        if not self.has_xdotool:
            return "xdotool not installed (sudo apt install xdotool)"
        if self.is_wayland:
            return "xdotool requires X11 session (not Wayland)"
        return None

    def control(self, action):
        err = self._check_x11()
        if err:
            return {"error": err}

        action_map = {
            "left": ["click", "1"],
            "right": ["click", "3"],
            "middle": ["click", "2"],
            "scrollup": ["click", "4"],
            "scrolldown": ["click", "5"],
            "scrollup_smooth": ["click", "--repeat", "3", "4"],
            "scrolldown_smooth": ["click", "--repeat", "3", "5"],
        }

        args = action_map.get(action.lower())
        if not args:
            return {"error": f"Unknown mouse action: {action}"}

        try:
            subprocess.run(["xdotool"] + args, check=True, timeout=2)
            return {"action": "mouse", "control": action}
        except subprocess.TimeoutExpired:
            return {"error": "xdotool timeout"}
        except subprocess.CalledProcessError as e:
            return {"error": f"xdotool failed: {e}"}