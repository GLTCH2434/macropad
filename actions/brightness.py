"""
Brightness control using brightnessctl or xrandr.
Works on systems with backlight control.
"""
import subprocess


class BrightnessActions:
    def __init__(self, has_brightnessctl, has_xrandr):
        self.has_brightnessctl = has_brightnessctl
        self.has_xrandr = has_xrandr
        self._primary_display = None

    def _get_primary_display(self):
        """Cache primary display name for xrandr"""
        if self._primary_display:
            return self._primary_display

        if not self.has_xrandr:
            return None

        try:
            result = subprocess.run(
                ["xrandr", "--query"],
                capture_output=True, text=True, check=True, timeout=2
            )
            for line in result.stdout.split("\n"):
                if " connected" in line and "primary" in line:
                    self._primary_display = line.split()[0]
                    return self._primary_display
                elif " connected" in line and not self._primary_display:
                    self._primary_display = line.split()[0]
        except Exception:
            pass
        return self._primary_display

    def adjust(self, delta):
        """Adjust brightness by delta (-100 to 100)"""
        # Try brightnessctl first (works on Wayland and X11 with kernel support)
        if self.has_brightnessctl:
            return self._adjust_brightnessctl(delta)

        # Fallback to xrandr (X11 only)
        if self.has_xrandr:
            return self._adjust_xrandr(delta)

        return {"error": "No brightness control available (install brightnessctl or use X11 with xrandr)"}

    def _adjust_brightnessctl(self, delta):
        try:
            if delta > 0:
                subprocess.run(["brightnessctl", "set", f"+{abs(delta)}%"], check=True, timeout=2)
            else:
                subprocess.run(["brightnessctl", "set", f"{abs(delta)}%-"], check=True, timeout=2)

            # Get current brightness
            result = subprocess.run(
                ["brightnessctl", "get"],
                capture_output=True, text=True, check=True, timeout=2
            )
            current = int(result.stdout.strip())

            result = subprocess.run(
                ["brightnessctl", "max"],
                capture_output=True, text=True, check=True, timeout=2
            )
            max_val = int(result.stdout.strip())
            pct = int((current / max_val) * 100)

            return {"action": "brightness", "delta": delta, "brightness": pct}
        except subprocess.CalledProcessError as e:
            return {"error": f"brightnessctl failed: {e}"}
        except Exception as e:
            return {"error": f"brightnessctl error: {e}"}

    def _adjust_xrandr(self, delta):
        display = self._get_primary_display()
        if not display:
            return {"error": "No display found for xrandr"}

        try:
            # Get current brightness
            result = subprocess.run(
                ["xrandr", "--verbose", "--current"],
                capture_output=True, text=True, check=True, timeout=2
            )
            current_brightness = 1.0
            for line in result.stdout.split("\n"):
                if "Brightness:" in line and display in result.stdout.split("\n")[result.stdout.split("\n").index(line)-1]:
                    current_brightness = float(line.split(":")[1].strip())
                    break

            # Adjust by delta (each step = 0.05 = 5%)
            step = 0.05
            new_brightness = max(0.1, min(1.0, current_brightness + delta * step))

            subprocess.run(
                ["xrandr", "--output", display, "--brightness", str(new_brightness)],
                check=True, timeout=2
            )

            return {"action": "brightness", "delta": delta, "brightness": int(new_brightness * 100)}
        except subprocess.CalledProcessError as e:
            return {"error": f"xrandr failed: {e}"}
        except Exception as e:
            return {"error": f"xrandr error: {e}"}

    def set_brightness(self, pct):
        """Set absolute brightness (0-100)"""
        if self.has_brightnessctl:
            try:
                subprocess.run(["brightnessctl", "set", f"{pct}%"], check=True, timeout=2)
                return {"action": "brightness_set", "brightness": pct}
            except Exception as e:
                return {"error": f"brightnessctl failed: {e}"}

        if self.has_xrandr:
            display = self._get_primary_display()
            if not display:
                return {"error": "No display found"}
            try:
                brightness = max(0.1, min(1.0, pct / 100.0))
                subprocess.run(["xrandr", "--output", display, "--brightness", str(brightness)], check=True, timeout=2)
                return {"action": "brightness_set", "brightness": pct}
            except Exception as e:
                return {"error": f"xrandr failed: {e}"}

        return {"error": "No brightness control available"}