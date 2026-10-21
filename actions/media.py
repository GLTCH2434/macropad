"""
Media controls using playerctl.
Works on both X11 and Wayland.
"""
import subprocess


class MediaActions:
    def __init__(self, has_playerctl):
        self.has_playerctl = has_playerctl

    def control(self, action):
        if not self.has_playerctl:
            return {"error": "playerctl not installed (sudo apt install playerctl)"}

        action_map = {
            "play": "play-pause",
            "pause": "play-pause",
            "next": "next",
            "previous": "previous",
            "prev": "previous",
            "stop": "stop",
            "mute": "mute",
            "volume_up": "volume 5%+",
            "volume_down": "volume 5%-",
        }

        playerctl_action = action_map.get(action.lower())
        if not playerctl_action:
            return {"error": f"Unknown media action: {action}"}

        try:
            if action in ("volume_up", "volume_down"):
                subprocess.run(["playerctl"] + playerctl_action.split(), check=True, timeout=2)
            else:
                subprocess.run(["playerctl", playerctl_action], check=True, timeout=2)
            return {"action": "media", "control": action}
        except subprocess.TimeoutExpired:
            return {"error": "playerctl timeout"}
        except subprocess.CalledProcessError as e:
            return {"error": f"playerctl failed: {e}"}