"""
Scroll actions using xdotool.
Requires X11 session - does not work on Wayland.
"""
import subprocess


class ScrollActions:
    def __init__(self, has_xdotool, is_wayland):
        self.has_xdotool = has_xdotool
        self.is_wayland = is_wayland

    def _check_x11(self):
        if not self.has_xdotool:
            return "xdotool not installed (sudo apt install xdotool)"
        if self.is_wayland:
            return "xdotool requires X11 session (not Wayland)"
        return None

    def adjust(self, delta, direction="vertical"):
        """Scroll by delta steps"""
        err = self._check_x11()
        if err:
            return {"error": err}

        if direction == "horizontal":
            # Horizontal scroll: xdotool doesn't directly support horizontal scroll
            # Use Shift+scroll as workaround in many apps, or xdotool key with modifiers
            # For now, simulate with key presses
            if delta > 0:
                subprocess.run(["xdotool", "key", "Shift+Right"], check=True, timeout=2)
            else:
                subprocess.run(["xdotool", "key", "Shift+Left"], check=True, timeout=2)
            return {"action": "scroll", "direction": "horizontal", "delta": delta}

        # Vertical scroll
        # xdotool click 4 = scroll up, click 5 = scroll down
        # Use --repeat for multiple steps
        steps = min(abs(delta), 10)  # Cap at 10 steps per action
        button = "4" if delta > 0 else "5"

        try:
            if steps > 1:
                subprocess.run(["xdotool", "click", "--repeat", str(steps), button], check=True, timeout=2)
            else:
                subprocess.run(["xdotool", "click", button], check=True, timeout=2)
            return {"action": "scroll", "direction": "vertical", "delta": delta, "steps": steps}
        except subprocess.CalledProcessError as e:
            return {"error": f"xdotool failed: {e}"}
        except subprocess.TimeoutExpired:
            return {"error": "xdotool timeout"}