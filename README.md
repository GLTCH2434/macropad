# DeskPad — USB-Connected Linux Macropad Web App

Turn your Android tablet into a touchscreen macro pad for Linux. Controls your desktop over USB using ADB port forwarding.

## Features

- **4 independent layers** with 12 macro keys each (3×4 grid)
- **2 configurable dials per layer** with independent settings
- **Touch-friendly** rotary dial controls with drag/scroll/keyboard input
- **PWA support** — install to Android home screen for app-like experience
- **No cloud** — runs entirely on your local network via USB
- **Extensible action system** — keyboard, media, mouse, apps, shell commands, macros

## Requirements

### Linux Host (Ubuntu 22.04+)
- Python 3.10+
- `xdotool` (for keyboard/mouse/zoom on X11)
- `pactl` / `pulseaudio-utils` (for volume)
- `playerctl` (for media keys)
- `brightnessctl` or `xrandr` (for brightness)
- `adb` (Android Debug Bridge)

### Android Tablet
- Android 8.0+ with USB debugging
- Chrome or Chromium-based browser
- USB data cable (not charge-only)

## Quick Start

### 1. Install dependencies on Linux

```bash
sudo apt update
sudo apt install -y python3 python3-pip \
    xdotool pulseaudio-utils playerctl brightnessctl \
    adb git
```

### 2. Clone and setup

```bash
git clone <this-repo> deskpad
cd deskpad
pip3 install -r requirements.txt
```

### 3. Start the server

```bash
python3 server.py
```

Server runs on `http://127.0.0.1:8765`

### 4. Connect Android tablet

```bash
# On Linux, with tablet connected via USB:
adb devices                    # Authorize on tablet if prompted
adb reverse tcp:8765 tcp:8765  # Forward port
```

### 5. Open on tablet

Open Chrome on tablet and navigate to:
```
http://127.0.0.1:8765
```

### 6. Install as PWA

In Chrome menu (⋮) → **Install app** / **Add to Home screen**

Now you have a fullscreen macropad app!

## Usage

### Layers
- **L1 General** — Terminal, files, browser, clipboard, shortcuts
- **L2 Coding** — VS Code, Git, build, test, debug
- **L3 Design** — Canva, Figma, Gimp, Inkscape, design shortcuts
- **L4 Media** — Play/pause, next/prev, volume, seek

Tap layer tabs (L1–L4) to switch. Each layer remembers its own dial settings.

### Dials
- **Drag** on dial to adjust (vertical + horizontal both work)
- **Mouse wheel** over dial for fine control
- **Arrow keys** when dial is focused (accessibility)
- Settings: action type, range, step, mode (range/endless)

### Configure
Tap **Configure** (top right) to customize:
- **Macro Keys** — label, icon, hint, action, parameters per key per layer
- **Layer Keys** — layer switch targets
- **Dials** — action, label, range, step, mode, parameters per dial per layer
- **Connection** — status and setup instructions

### Desktop Testing
On Linux desktop, use keyboard shortcuts:
- Keys `1 2 3 q w e a s d z x c` → macro keys 1–12
- Keys `7 8 9 0` → layer tabs L1–L4
- Arrow keys on focused dial → adjust

## Architecture

```
┌─────────────────┐     USB/ADB      ┌──────────────────┐
│  Android Tablet │◄────────────────►│   Linux Host     │
│  (Chrome PWA)   │   Port 8765      │  (Python Server) │
└─────────────────┘                  └──────────────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
              ┌───────────┐          ┌───────────┐          ┌───────────┐
              │ xdotool   │          │  pactl    │          │ playerctl │
              │(keyboard/ │          │ (volume)  │          │ (media)   │
              │ mouse/zoom)            │           │          │           │
              └───────────┘          └───────────┘          └───────────┘
```

## Configuration

### Per-layer dial independence
Each layer stores its own dial configuration. Switching layers preserves the previous layer's dial values and loads the target layer's saved state.

### Action types

| Type | Description | Parameters |
|------|-------------|------------|
| `none` | No action | — |
| `keypress` | Single key tap | `key`: "Enter", "F5", "a" |
| `shortcut` | Modifier combo | `combo`: "Ctrl+C", "Ctrl+Shift+Z" |
| `text` | Type text | `text`: "Hello world" |
| `media` | Media control | `action`: "play", "next", "prev", "stop", "mute", "volume_up", "volume_down" |
| `mouse` | Mouse action | `action`: "left", "right", "middle", "scrollup", "scrolldown" |
| `app` | Launch app | `appId`: "terminal", "code", "browser", "files", "settings" |
| `shell` | Run command | `cmdId`: "git_status", "git_add", "git_commit", etc. |
| `layer` | Switch layer | `target`: 0–3 |
| `macro` | Run macro | `macroId`: "duplicate_line", "select_word", "save_all" |

### Dial actions

| Type | Description | Parameters |
|------|-------------|------------|
| `volume` | System volume | — |
| `brightness` | Screen brightness | — |
| `scroll` | Mouse wheel | `direction`: "vertical" or "horizontal" |
| `zoom` | App zoom (Ctrl++/Ctrl+-) | — |
| `custom` | Custom command | `command`: command ID |

### Adding custom apps/commands/macros

Edit `config/layout.json` or use the Configure UI. The server loads this file on startup.

Example custom app:
```json
{"appId": "discord", "action": "app", "params": {"appId": "discord"}}
```

Register in `actions/apps.py`:
```python
apps.register_app("discord", ["discord"])
```

Example custom macro:
```json
{"action": "macro", "params": {"macroId": "my_macro"}}
```

Register in `actions/macros.py`:
```python
macros.register_macro("my_macro", [
    {"type": "shortcut", "params": {"combo": "Ctrl+Shift+P"}},
    {"type": "wait", "params": {"ms": 100}},
    {"type": "text", "params": {"text": "My snippet"}},
])
```

## Wayland vs X11

**Important**: `xdotool` only works on X11 sessions. On Wayland (Ubuntu 22.04 default), keyboard/mouse/zoom actions will fail.

Options:
1. **Use X11 session** — Log out, click gear icon, select "Ubuntu on Xorg"
2. **Use alternatives** — For Wayland, consider `ydotool` (requires root) or portal APIs
3. **Hybrid** — Media, volume, brightness work on both

The server detects session type and warns at startup.

## Troubleshooting

### "xdotool: command not found"
```bash
sudo apt install xdotool
```

### "Cannot open display" / xdotool fails
- You're on Wayland. Switch to X11 session or install `ydotool`.
- Or run server with `DISPLAY=:0` if headless.

### "playerctl: No players found"
- Start a media player (Spotify, VLC, Firefox with video)
- Or install `playerctl` and ensure MPRIS is enabled

### "pactl: Connection refused"
```bash
pulseaudio --start
# or
systemctl --user restart pipewire-pulse
```

### Tablet can't connect
- Verify `adb devices` shows your tablet
- Check `adb reverse tcp:8765 tcp:8765` succeeded
- Try `http://<PC-LAN-IP>:8765` if USB forwarding fails (requires firewall allow)

### PWA won't install
- Must serve over HTTPS or localhost
- ADB forwarding makes it appear as localhost
- Chrome requires user interaction before install prompt

### Dial not saving
- Configure → Dials → verify settings → Done
- Check browser console for API errors
- Config saved to `config/layout.json` on server

## Systemd Service (Optional)

```ini
# /etc/systemd/user/deskpad.service
[Unit]
Description=DeskPad Macropad Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/USER/deskpad
ExecStart=/usr/bin/python3 server.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now deskpad
loginctl enable-linger $USER  # Keep running after logout
```

## Project Structure

```
deskpad/
├── index.html          # Main PWA entry
├── app.js              # Frontend logic
├── styles.css          # Dark theme UI
├── manifest.json       # PWA manifest
├── service-worker.js   # Offline caching
├── server.py           # Python HTTP server
├── requirements.txt    # Python deps (minimal)
├── config/
│   └── layout.json     # Layer/key/dial config
├── actions/            # Action handlers
│   ├── keyboard.py     # xdotool key/combo/text
│   ├── media.py        # playerctl media keys
│   ├── mouse.py        # xdotool mouse
│   ├── volume.py       # pactl volume/mute
│   ├── brightness.py   # brightnessctl/xrandr
│   ├── scroll.py       # xdotool scroll
│   ├── zoom.py         # xdotool zoom
│   ├── apps.py         # App launch + shell allowlist
│   └── macros.py       # Macro sequences
├── icons/              # PWA icons (SVG + PNG)
├── scripts/
│   └── generate_icons.py
└── README.md
```

## Security

- Server binds to `127.0.0.1` only (not LAN)
- No arbitrary shell execution — allowlist only
- No sudo required for normal operation
- ADB forwarding is local to USB connection
- No telemetry, no logs to UI

## License

MIT — Use freely for personal or commercial projects.

## Acknowledgments

Inspired by hardware macropads and the macropad-simulator project.
Built for the Linux desktop enthusiast who wants a custom control surface.