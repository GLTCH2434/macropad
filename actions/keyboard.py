"""
Keyboard actions using xdotool.
Requires X11 session - does not work on Wayland.
"""
import subprocess
import shlex


class KeyboardActions:
    def __init__(self, has_xdotool, is_wayland):
        self.has_xdotool = has_xdotool
        self.is_wayland = is_wayland

    def _check_x11(self):
        if not self.has_xdotool:
            return "xdotool not installed (sudo apt install xdotool)"
        if self.is_wayland:
            return "xdotool requires X11 session (not Wayland)"
        return None

    def press_key(self, key):
        """Press a single key (e.g., 'Enter', 'Escape', 'F5', 'a')"""
        err = self._check_x11()
        if err:
            return {"error": err}

        # Map common key names to xdotool format
        key_map = {
            "enter": "Return",
            "escape": "Escape",
            "esc": "Escape",
            "tab": "Tab",
            "space": "space",
            "backspace": "BackSpace",
            "delete": "Delete",
            "home": "Home",
            "end": "End",
            "pageup": "Page_Up",
            "pagedown": "Page_Down",
            "up": "Up",
            "down": "Down",
            "left": "Left",
            "right": "Right",
            "printscreen": "Print",
            "prtsc": "Print",
        }
        key_lower = key.lower()
        xdotool_key = key_map.get(key_lower, key)

        try:
            subprocess.run(["xdotool", "key", xdotool_key], check=True, timeout=2)
            return {"action": "keypress", "key": key}
        except subprocess.TimeoutExpired:
            return {"error": "xdotool timeout"}
        except subprocess.CalledProcessError as e:
            return {"error": f"xdotool failed: {e}"}

    def press_combo(self, combo):
        """Press a key combination (e.g., 'Ctrl+C', 'Ctrl+Shift+Z', 'Alt+Tab')"""
        err = self._check_x11()
        if err:
            return {"error": err}

        # Parse combo like "Ctrl+Shift+Z" into xdotool format
        parts = combo.split("+")
        modifiers = []
        key = None

        for part in parts:
            p = part.lower().strip()
            if p in ("ctrl", "control"):
                modifiers.append("ctrl")
            elif p in ("shift",):
                modifiers.append("shift")
            elif p in ("alt", "option"):
                modifiers.append("alt")
            elif p in ("super", "win", "meta", "cmd", "command"):
                modifiers.append("super")
            else:
                key = part  # The actual key

        if not key:
            return {"error": "No key in combo"}

        # Map key
        key_map = {
            "enter": "Return",
            "escape": "Escape",
            "esc": "Escape",
            "tab": "Tab",
            "space": "space",
            "backspace": "BackSpace",
            "delete": "Delete",
            "home": "Home",
            "end": "End",
            "pageup": "Page_Up",
            "pagedown": "Page_Down",
            "up": "Up",
            "down": "Down",
            "left": "Left",
            "right": "Right",
            "printscreen": "Print",
            "prtsc": "Print",
            "a": "a", "b": "b", "c": "c", "d": "d", "e": "e", "f": "f",
            "g": "g", "h": "h", "i": "i", "j": "j", "k": "k", "l": "l",
            "m": "m", "n": "n", "o": "o", "p": "p", "q": "q", "r": "r",
            "s": "s", "t": "t", "u": "u", "v": "v", "w": "w", "x": "x",
            "y": "y", "z": "z",
            "1": "1", "2": "2", "3": "3", "4": "4", "5": "5",
            "6": "6", "7": "7", "8": "8", "9": "9", "0": "0",
            "f1": "F1", "f2": "F2", "f3": "F3", "f4": "F4",
            "f5": "F5", "f6": "F6", "f7": "F7", "f8": "F8",
            "f9": "F9", "f10": "F10", "f11": "F11", "f12": "F12",
            "`": "grave", "~": "asciitilde",
            "-": "minus", "_": "underscore",
            "=": "equal", "+": "plus",
            "[": "bracketleft", "{": "braceleft",
            "]": "bracketright", "}": "braceright",
            "\\": "backslash", "|": "bar",
            ";": "semicolon", ":": "colon",
            "'": "apostrophe", '"': "quotedbl",
            ",": "comma", "<": "less",
            ".": "period", ">": "greater",
            "/": "slash", "?": "question",
        }
        key_lower = key.lower()
        xdotool_key = key_map.get(key_lower, key)

        try:
            if modifiers:
                # xdotool: key ctrl+shift+z
                combo_str = "+".join(modifiers + [xdotool_key])
                subprocess.run(["xdotool", "key", combo_str], check=True, timeout=2)
            else:
                subprocess.run(["xdotool", "key", xdotool_key], check=True, timeout=2)
            return {"action": "shortcut", "combo": combo}
        except subprocess.TimeoutExpired:
            return {"error": "xdotool timeout"}
        except subprocess.CalledProcessError as e:
            return {"error": f"xdotool failed: {e}"}

    def type_text(self, text):
        """Type a text string"""
        err = self._check_x11()
        if err:
            return {"error": err}

        if not text:
            return {"action": "text", "text": ""}

        try:
            # xdotool type handles special characters
            subprocess.run(["xdotool", "type", "--clearmodifiers", text], check=True, timeout=5)
            return {"action": "text", "length": len(text)}
        except subprocess.TimeoutExpired:
            return {"error": "xdotool timeout"}
        except subprocess.CalledProcessError as e:
            return {"error": f"xdotool failed: {e}"}