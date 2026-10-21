# DeskPad HTTP API Protocol

The DeskPad frontend communicates with the Python companion service over HTTP.
All endpoints are prefixed with `/api/`.

## Base URL

```
http://127.0.0.1:8765/api
```

## Endpoints

### GET /status

Check server health and available tools.

**Response:**
```json
{
  "status": "ok",
  "session": "x11",
  "tools": {
    "xdotool": true,
    "pactl": true,
    "playerctl": true,
    "brightnessctl": false,
    "xrandr": true,
    "notify-send": true
  }
}
```

### GET /config

Get current layer configuration.

**Response:**
```json
{
  "version": 1,
  "layers": [
    {
      "name": "General",
      "keys": [...],
      "dials": [...]
    },
    ...
  ]
}
```

### POST /config

Save layer configuration.

**Request:**
```json
{
  "version": 1,
  "layers": [...]
}
```

**Response:**
```json
{"status": "saved"}
```

### GET /layers

Get layers array only (lighter than full config).

### POST /action

Execute a macro key action.

**Request:**
```json
{
  "type": "shortcut",
  "params": {"combo": "Ctrl+C"},
  "layer": 0,
  "keyIndex": 0
}
```

**Action Types:**

| Type | Params |
|------|--------|
| `none` | — |
| `keypress` | `key` |
| `shortcut` | `combo` |
| `text` | `text` |
| `media` | `action` (play/next/prev/stop/mute/volume_up/volume_down) |
| `mouse` | `action` (left/right/middle/scrollup/scrolldown) |
| `app` | `appId` |
| `shell` | `cmdId` |
| `layer` | `target` (0-3) |
| `macro` | `macroId` |

**Response:**
```json
{
  "status": "ok",
  "result": {"action": "shortcut", "combo": "Ctrl+C"}
}
```

### POST /dial

Execute a dial/knob action.

**Request:**
```json
{
  "dialIndex": 0,
  "type": "volume",
  "delta": 2,
  "value": 52,
  "params": {},
  "layer": 0
}
```

**Dial Types:**

| Type | Params |
|------|--------|
| `none` | — |
| `volume` | — |
| `brightness` | — |
| `scroll` | `direction` (vertical/horizontal) |
| `zoom` | — |
| `custom` | `command` |

**Response:**
```json
{
  "status": "ok",
  "result": {"action": "volume", "delta": 2, "volume": 52}
}
```

### POST /layer

Notify server of layer change (for logging/state sync).

**Request:**
```json
{"layer": 1}
```

**Response:**
```json
{"status": "ok", "layer": 1}
```

## Error Responses

All endpoints may return:
```json
{"error": "Description of error"}
```
With appropriate HTTP status code (400, 404, 500).

## CORS

All responses include:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

## Notes

- Server binds to `127.0.0.1` only
- ADB reverse forwarding makes this accessible from Android tablet as `http://127.0.0.1:8765`
- No authentication — local USB connection only
- Config persisted to `config/layout.json`