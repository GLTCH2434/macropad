#!/usr/bin/env python3
"""
DeskPad - Linux Companion Service
Serves the PWA frontend and executes macro actions on Ubuntu via HTTP API.
"""
import os
import sys
import json
import subprocess
import platform
import shutil
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import mimetypes
import threading
import time

# Add actions directory to path
sys.path.insert(0, str(Path(__file__).parent / "actions"))

from actions.keyboard import KeyboardActions
from actions.media import MediaActions
from actions.mouse import MouseActions
from actions.volume import VolumeActions
from actions.brightness import BrightnessActions
from actions.scroll import ScrollActions
from actions.zoom import ZoomActions
from actions.apps import AppActions
from actions.macros import MacroActions

# Configuration
HOST = "0.0.0.0"
PORT = 8765
FRONTEND_DIR = Path(__file__).parent
CONFIG_FILE = FRONTEND_DIR / "config" / "layout.json"

# Session detection
SESSION_TYPE = os.environ.get("XDG_SESSION_TYPE", "").lower()
IS_WAYLAND = "wayland" in SESSION_TYPE
IS_X11 = "x11" in SESSION_TYPE

# Check available tools
def check_tool(name):
    return shutil.which(name) is not None

TOOLS = {
    "xdotool": check_tool("xdotool"),
    "pactl": check_tool("pactl"),
    "playerctl": check_tool("playerctl"),
    "brightnessctl": check_tool("brightnessctl"),
    "xrandr": check_tool("xrandr"),
    "notify-send": check_tool("notify-send"),
}

# Initialize action handlers
keyboard = KeyboardActions(TOOLS["xdotool"], IS_WAYLAND)
media = MediaActions(TOOLS["playerctl"])
mouse = MouseActions(TOOLS["xdotool"], IS_WAYLAND)
volume = VolumeActions(TOOLS["pactl"])
brightness = BrightnessActions(TOOLS["brightnessctl"], TOOLS["xrandr"])
scroll = ScrollActions(TOOLS["xdotool"], IS_WAYLAND)
zoom = ZoomActions(TOOLS["xdotool"], IS_WAYLAND)
apps = AppActions()
macros = MacroActions(keyboard, media, mouse, volume, brightness, scroll, zoom, apps)

class DeskPadHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # API endpoints
        if path == "/api/status":
            self.send_json({"status": "ok", "session": SESSION_TYPE, "tools": TOOLS})
            return
        elif path == "/api/config":
            self.serve_config()
            return
        elif path == "/api/layers":
            self.send_json({"layers": load_layout()["layers"]})
            return

        # Static files - serve index.html for root and unknown paths (SPA)
        if path == "/" or path == "":
            self.path = "/index.html"
        elif not path.startswith("/api/") and "." not in Path(path).name:
            # Likely a SPA route, serve index.html
            self.path = "/index.html"

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return

        if path == "/api/action":
            self.handle_action(data)
        elif path == "/api/dial":
            self.handle_dial(data)
        elif path == "/api/layer":
            self.handle_layer(data)
        elif path == "/api/config":
            self.save_config(data)
        else:
            self.send_json({"error": "Not found"}, 404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def serve_config(self):
        config = load_layout()
        self.send_json(config)

    def save_config(self, data):
        try:
            # Validate structure
            if "layers" not in data or not isinstance(data["layers"], list):
                self.send_json({"error": "Invalid config: missing layers array"}, 400)
                return
            if len(data["layers"]) != 4:
                self.send_json({"error": "Config must have exactly 4 layers"}, 400)
                return

            # Ensure each layer has required structure
            for i, layer in enumerate(data["layers"]):
                if "keys" not in layer or len(layer["keys"]) != 12:
                    self.send_json({"error": f"Layer {i}: must have 12 keys"}, 400)
                    return
                if "dials" not in layer or len(layer["dials"]) != 2:
                    self.send_json({"error": f"Layer {i}: must have 2 dials"}, 400)
                    return

            # Atomic write
            tmp = CONFIG_FILE.with_suffix(".tmp")
            with open(tmp, "w") as f:
                json.dump(data, f, indent=2)
            tmp.replace(CONFIG_FILE)

            self.send_json({"status": "saved"})
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def handle_action(self, data):
        """Handle button press action"""
        action_type = data.get("type")
        params = data.get("params", {})
        layer = data.get("layer", 0)
        key_index = data.get("keyIndex", 0)

        try:
            result = self.execute_action(action_type, params, layer, key_index)
            self.send_json({"status": "ok", "result": result})
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def handle_dial(self, data):
        """Handle dial/knob action"""
        dial_index = data.get("dialIndex", 0)
        action_type = data.get("type")
        delta = data.get("delta", 0)
        value = data.get("value", 0)
        params = data.get("params", {})
        layer = data.get("layer", 0)

        try:
            result = self.execute_dial(dial_index, action_type, delta, value, params, layer)
            self.send_json({"status": "ok", "result": result})
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def handle_layer(self, data):
        """Handle layer switch"""
        layer = data.get("layer", 0)
        if 0 <= layer <= 3:
            self.send_json({"status": "ok", "layer": layer})
        else:
            self.send_json({"error": "Invalid layer"}, 400)

    def execute_action(self, action_type, params, layer, key_index):
        """Execute a button action"""
        if action_type == "none":
            return "noop"

        elif action_type == "keypress":
            key = params.get("key", "")
            return keyboard.press_key(key)

        elif action_type == "shortcut":
            combo = params.get("combo", "")
            return keyboard.press_combo(combo)

        elif action_type == "text":
            text = params.get("text", "")
            return keyboard.type_text(text)

        elif action_type == "media":
            action = params.get("action", "")
            return media.control(action)

        elif action_type == "mouse":
            action = params.get("action", "")
            return mouse.control(action)

        elif action_type == "app":
            app_id = params.get("appId", "")
            return apps.launch(app_id)

        elif action_type == "shell":
            # Only allow predefined commands from config
            cmd_id = params.get("cmdId", "")
            return apps.run_command(cmd_id)

        elif action_type == "layer":
            target = params.get("target", 0)
            return {"layer": target}

        elif action_type == "macro":
            macro_id = params.get("macroId", "")
            return macros.run(macro_id)

        else:
            raise ValueError(f"Unknown action type: {action_type}")

    def execute_dial(self, dial_index, action_type, delta, value, params, layer):
        """Execute a dial action"""
        if action_type == "none":
            return "noop"

        elif action_type == "volume":
            return volume.adjust(delta, params.get("mute", False))

        elif action_type == "brightness":
            return brightness.adjust(delta)

        elif action_type == "scroll":
            direction = params.get("direction", "vertical")
            return scroll.adjust(delta, direction)

        elif action_type == "zoom":
            return zoom.adjust(delta)

        elif action_type == "custom":
            # Custom dial action - could be a macro or shell command
            cmd = params.get("command", "")
            if cmd:
                return apps.run_command(cmd)
            return "noop"

        else:
            raise ValueError(f"Unknown dial action type: {action_type}")

    def log_message(self, format, *args):
        # Suppress default log messages
        pass


def load_layout():
    """Load layout config with migration support"""
    default_layout = get_default_layout()

    if not CONFIG_FILE.exists():
        # First run - save defaults
        save_layout(default_layout)
        return default_layout

    try:
        with open(CONFIG_FILE) as f:
            saved = json.load(f)
    except (json.JSONDecodeError, OSError):
        return default_layout

    # Migration: ensure all required fields exist
    migrated = migrate_layout(saved, default_layout)
    return migrated


def migrate_layout(saved, default):
    """Migrate old config to current version"""
    # Ensure we have 4 layers
    layers = saved.get("layers", [])
    while len(layers) < 4:
        layers.append(default["layers"][len(layers)])

    # Ensure each layer has 12 keys and 2 dials
    for i, layer in enumerate(layers[:4]):
        keys = layer.get("keys", [])
        while len(keys) < 12:
            keys.append(default["layers"][i]["keys"][len(keys)])
        layer["keys"] = keys[:12]

        dials = layer.get("dials", [])
        while len(dials) < 2:
            dials.append(default["layers"][i]["dials"][len(dials)])
        layer["dials"] = dials[:2]

    return {"layers": layers[:4], "version": default.get("version", 1)}


def save_layout(layout):
    """Save layout to config file"""
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(layout, f, indent=2)


def get_default_layout():
    """Get default 4-layer layout"""
    return {
        "version": 1,
        "layers": [
            # Layer 1: Text / General
            {
                "name": "Text / General",
                "keys": [
                    {"label": "Copy", "icon": "copy", "hint": "Ctrl+C", "action": "shortcut", "params": {"combo": "Ctrl+C"}},
                    {"label": "Paste", "icon": "paste", "hint": "Ctrl+V", "action": "shortcut", "params": {"combo": "Ctrl+V"}},
                    {"label": "Select All", "icon": "select", "hint": "Ctrl+A", "action": "shortcut", "params": {"combo": "Ctrl+A"}},
                    {"label": "Undo", "icon": "undo", "hint": "Ctrl+Z", "action": "shortcut", "params": {"combo": "Ctrl+Z"}},
                    {"label": "Save", "icon": "save", "hint": "Ctrl+S", "action": "shortcut", "params": {"combo": "Ctrl+S"}},
                    {"label": "New Tab", "icon": "tab-new", "hint": "Ctrl+T", "action": "shortcut", "params": {"combo": "Ctrl+T"}},
                    {"label": "Switch Win", "icon": "window-switch", "hint": "Alt+Tab", "action": "shortcut", "params": {"combo": "Alt+Tab"}},
                    {"label": "Lock", "icon": "lock", "hint": "Win+L", "action": "shortcut", "params": {"combo": "Super+L"}},
                    {"label": "Terminal", "icon": "terminal", "hint": "Ctrl+Alt+T", "action": "shortcut", "params": {"combo": "Ctrl+Alt+T"}},
                    {"label": "New Window", "icon": "window-new", "hint": "Ctrl+Shift+N", "action": "shortcut", "params": {"combo": "Ctrl+Shift+N"}},
                    {"label": "Enter", "icon": "enter", "hint": "Enter", "action": "keypress", "params": {"key": "Enter"}},
                    {"label": "Esc", "icon": "esc", "hint": "Esc", "action": "keypress", "params": {"key": "Escape"}}
                ],
                "dials": [
                    {"label": "Scroll V", "action": "scroll", "value": 0, "min": -100, "max": 100, "step": 1, "mode": "endless", "params": {"direction": "vertical"}},
                    {"label": "Volume", "action": "volume", "value": 50, "min": 0, "max": 100, "step": 2, "mode": "range", "params": {}}
                ]
            },
            # Layer 2: Media
            {
                "name": "Media",
                "keys": [
                    {"label": "Vol Up", "icon": "vol-up", "hint": "↑", "action": "media", "params": {"action": "volume_up"}},
                    {"label": "Mute", "icon": "mute", "hint": "M", "action": "media", "params": {"action": "mute"}},
                    {"label": "Vol Down", "icon": "vol-down", "hint": "↓", "action": "media", "params": {"action": "volume_down"}},
                    {"label": "Previous", "icon": "prev", "hint": "←", "action": "media", "params": {"action": "previous"}},
                    {"label": "Play/Pause", "icon": "play", "hint": "Space", "action": "media", "params": {"action": "play"}},
                    {"label": "Next", "icon": "next", "hint": "→", "action": "media", "params": {"action": "next"}},
                    {"label": "Switch Win", "icon": "window-switch", "hint": "Alt+Tab", "action": "shortcut", "params": {"combo": "Alt+Tab"}},
                    {"label": "Fullscreen", "icon": "fullscreen", "hint": "F11", "action": "keypress", "params": {"key": "F11"}},
                    {"label": "Minimize", "icon": "minimize", "hint": "Win+Down", "action": "shortcut", "params": {"combo": "Super+Down"}},
                    {"label": "Unassigned", "icon": "default", "hint": "", "action": "none", "params": {}},
                    {"label": "Enter", "icon": "enter", "hint": "Enter", "action": "keypress", "params": {"key": "Enter"}},
                    {"label": "Esc", "icon": "esc", "hint": "Esc", "action": "keypress", "params": {"key": "Escape"}}
                ],
                "dials": [
                    {"label": "Volume", "action": "volume", "value": 50, "min": 0, "max": 100, "step": 2, "mode": "range", "params": {}},
                    {"label": "Seek", "action": "custom", "value": 0, "min": -100, "max": 100, "step": 1, "mode": "endless", "params": {"command": "seek"}}
                ]
            },
            # Layer 3: Coding / Vim
            {
                "name": "Coding / Vim",
                "keys": [
                    {"label": "Copy", "icon": "copy", "hint": "Ctrl+C", "action": "shortcut", "params": {"combo": "Ctrl+C"}},
                    {"label": "Paste", "icon": "paste", "hint": "Ctrl+V", "action": "shortcut", "params": {"combo": "Ctrl+V"}},
                    {"label": "Space+S+A", "icon": "macro", "hint": "SPC S A", "action": "macro", "params": {"macroId": "vim_space_s_a"}},
                    {"label": "First Line", "icon": "vim-top", "hint": "gg", "action": "keypress", "params": {"key": "g"}},
                    {"label": "Last Line", "icon": "vim-bottom", "hint": "G", "action": "keypress", "params": {"key": "G"}},
                    {"label": "Save & Quit", "icon": "vim-wq", "hint": ":wq⏎", "action": "macro", "params": {"macroId": "vim_wq"}},
                    {"label": "Switch Win", "icon": "window-switch", "hint": "Alt+Tab", "action": "shortcut", "params": {"combo": "Alt+Tab"}},
                    {"label": "!", "icon": "exclaim", "hint": "!", "action": "keypress", "params": {"key": "!"}},
                    {"label": "$", "icon": "dollar", "hint": "$", "action": "keypress", "params": {"key": "$"}},
                    {"label": "&", "icon": "ampersand", "hint": "&", "action": "keypress", "params": {"key": "&"}},
                    {"label": "Enter", "icon": "enter", "hint": "Enter", "action": "keypress", "params": {"key": "Enter"}},
                    {"label": "Esc", "icon": "esc", "hint": "Esc", "action": "keypress", "params": {"key": "Escape"}}
                ],
                "dials": [
                    {"label": "Scroll V", "action": "scroll", "value": 0, "min": -100, "max": 100, "step": 1, "mode": "endless", "params": {"direction": "vertical"}},
                    {"label": "Cursor H", "action": "scroll", "value": 0, "min": -100, "max": 100, "step": 1, "mode": "endless", "params": {"direction": "horizontal"}}
                ]
            },
            # Layer 4: Canva
            {
                "name": "Canva",
                "keys": [
                    {"label": "Copy", "icon": "copy", "hint": "Ctrl+C", "action": "shortcut", "params": {"combo": "Ctrl+C"}},
                    {"label": "Paste", "icon": "paste", "hint": "Ctrl+V", "action": "shortcut", "params": {"combo": "Ctrl+V"}},
                    {"label": "Select All", "icon": "select", "hint": "Ctrl+A", "action": "shortcut", "params": {"combo": "Ctrl+A"}},
                    {"label": "Undo", "icon": "undo", "hint": "Ctrl+Z", "action": "shortcut", "params": {"combo": "Ctrl+Z"}},
                    {"label": "Rectangle", "icon": "rectangle", "hint": "R", "action": "keypress", "params": {"key": "r"}},
                    {"label": "Line", "icon": "line", "hint": "L", "action": "keypress", "params": {"key": "l"}},
                    {"label": "Switch Win", "icon": "window-switch", "hint": "Alt+Tab", "action": "shortcut", "params": {"combo": "Alt+Tab"}},
                    {"label": "Send Back", "icon": "send-back", "hint": "Ctrl+[", "action": "shortcut", "params": {"combo": "Ctrl+["}},
                    {"label": "Bring Fwd", "icon": "bring-forward", "hint": "Ctrl+]", "action": "shortcut", "params": {"combo": "Ctrl+]"}},
                    {"label": "Reopen Tab", "icon": "tab-reopen", "hint": "Ctrl+Shift+T", "action": "shortcut", "params": {"combo": "Ctrl+Shift+T"}},
                    {"label": "Enter", "icon": "enter", "hint": "Enter", "action": "keypress", "params": {"key": "Enter"}},
                    {"label": "Esc", "icon": "esc", "hint": "Esc", "action": "keypress", "params": {"key": "Escape"}}
                ],
                "dials": [
                    {"label": "Zoom", "action": "zoom", "value": 100, "min": 25, "max": 400, "step": 5, "mode": "range", "params": {}},
                    {"label": "Rotate", "action": "custom", "value": 0, "min": -180, "max": 180, "step": 1, "mode": "endless", "params": {"command": "rotate"}}
                ]
            }
        ]
    }


def main():
    print(f"DeskPad Server starting on http://{HOST}:{PORT}")
    print(f"Session type: {SESSION_TYPE or 'unknown'}")
    print(f"Available tools: {[k for k, v in TOOLS.items() if v]}")
    if IS_WAYLAND:
        print("WARNING: Running on Wayland - xdotool may not work for keyboard/mouse actions")
        print("         Consider using an X11 session for full functionality")

    # Ensure config exists
    load_layout()

    # Add MIME types for PWA
    mimetypes.add_type("application/manifest+json", ".webmanifest")
    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("text/css", ".css")

    server = ThreadingHTTPServer((HOST, PORT), DeskPadHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()