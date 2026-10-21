"""
System volume control using pactl (PipeWire/PulseAudio).
Works on both X11 and Wayland.
"""
import subprocess


class VolumeActions:
    def __init__(self, has_pactl):
        self.has_pactl = has_pactl

    def _get_default_sink(self):
        """Get the default audio sink"""
        try:
            result = subprocess.run(
                ["pactl", "get-default-sink"],
                capture_output=True, text=True, check=True, timeout=2
            )
            return result.stdout.strip()
        except Exception:
            return "@DEFAULT_SINK@"

    def adjust(self, delta, mute=False):
        """Adjust volume by delta (-100 to 100), optionally toggle mute"""
        if not self.has_pactl:
            return {"error": "pactl not installed (sudo apt install pulseaudio-utils)"}

        sink = self._get_default_sink()
        results = []

        try:
            if mute:
                subprocess.run(["pactl", "set-sink-mute", sink, "toggle"], check=True, timeout=2)
                results.append({"action": "mute_toggle"})

            if delta != 0:
                # delta is in steps, convert to percentage
                # Each step = 2% by default (configurable in dial settings)
                pct = abs(delta) * 2
                direction = "+" if delta > 0 else "-"
                subprocess.run(["pactl", "set-sink-volume", sink, f"{direction}{pct}%"], check=True, timeout=2)
                results.append({"action": "volume", "delta": delta, "pct": pct})

            # Get current volume for feedback
            vol = self._get_volume(sink)
            return {"action": "volume", "results": results, "volume": vol}

        except subprocess.TimeoutExpired:
            return {"error": "pactl timeout"}
        except subprocess.CalledProcessError as e:
            return {"error": f"pactl failed: {e}"}

    def _get_volume(self, sink):
        """Get current volume percentage"""
        try:
            result = subprocess.run(
                ["pactl", "get-sink-volume", sink],
                capture_output=True, text=True, check=True, timeout=2
            )
            # Output like: Volume: front-left: 65536 / 100% / 0.00 dB, front-right: 65536 / 100% / 0.00 dB
            import re
            match = re.search(r'(\d+)%', result.stdout)
            if match:
                return int(match.group(1))
        except Exception:
            pass
        return None

    def set_volume(self, volume_pct):
        """Set absolute volume (0-100)"""
        if not self.has_pactl:
            return {"error": "pactl not installed"}

        sink = self._get_default_sink()
        try:
            subprocess.run(["pactl", "set-sink-volume", sink, f"{volume_pct}%"], check=True, timeout=2)
            return {"action": "volume_set", "volume": volume_pct}
        except subprocess.CalledProcessError as e:
            return {"error": f"pactl failed: {e}"}

    def toggle_mute(self):
        """Toggle mute state"""
        if not self.has_pactl:
            return {"error": "pactl not installed"}

        sink = self._get_default_sink()
        try:
            subprocess.run(["pactl", "set-sink-mute", sink, "toggle"], check=True, timeout=2)
            return {"action": "mute_toggle"}
        except subprocess.CalledProcessError as e:
            return {"error": f"pactl failed: {e}"}