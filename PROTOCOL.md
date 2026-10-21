# Macropad serial protocol

The simulator talks to a microcontroller over a serial port (Web Serial, in
Chrome or Edge). The idea:

- The **browser** holds the configuration (labels, layers, what each key does).
- The **device** has the real USB HID interface. It performs the key presses,
  mouse actions and so on, and can also report its own physical keys and knobs.

Everything is plain text, **one command per line**, terminated by `\n`
(a `\r\n` from the device is also accepted). Serial settings: 8N1, baud rate
chosen in Configure > Device (default 115200).

All numbers are **0-based** (key 0 is the first key, layer 0 is "Layer 1").

## Text escaping

A command must fit on one line, so in free-text fields the host escapes:

| Character  | Sent as |
|------------|---------|
| `\`        | `\\`    |
| newline    | `\n`    |
| carriage return | `\r` |

The firmware should reverse this when it receives a `TEXT` command.

## Host -> device

| Line | Meaning |
|------|---------|
| `HELLO macropad 1` | Sent right after connecting. `1` is the protocol version. |
| `LAYER <n>` | The active layer is now `n` (0-3). Sent on every layer change, so the device can update LEDs or a display. |
| `KEY <name>` | Tap one key, e.g. `KEY Enter`, `KEY F5`, `KEY a`. |
| `SC <combo>` | Tap a shortcut, e.g. `SC Ctrl+C`, `SC Ctrl+Shift+Esc`. Modifiers are held, the key is tapped, then everything is released. |
| `TEXT <text>` | Type the (escaped) text. |
| `MEDIA <name>` | One of `play`, `next`, `prev`, `stop`, `mute`, `volup`, `voldown`. |
| `MOUSE <name>` | One of `left`, `right`, `middle`, `scrollup`, `scrolldown`. |
| `KNOB <i> <action> <delta> <value> [param]` | Knob `i` was turned. `action` is `volume`, `brightness`, `scroll`, `zoom` or `custom`. `delta` is the signed change, `value` the new value. `param` is the rest of the line (may contain spaces, may be missing). |

Macros are expanded by the host: a macro such as
`Ctrl+C, wait:100, Ctrl+V` becomes `SC Ctrl+C`, a 100 ms pause on the host, then
`SC Ctrl+V`. The device only ever sees single `KEY` / `SC` lines.

Examples:

```
HELLO macropad 1
LAYER 0
SC Ctrl+C
TEXT int main(void) {\n    return 0;\n}
KNOB 0 volume 1 51
KNOB 1 custom -5 95 my command
```

## Device -> host

Optional. If the device has its own keys and knobs, it can send these and the
on-screen pad reacts exactly as if it had been touched (and the browser then
sends the matching action commands back).

| Line | Meaning |
|------|---------|
| `HELLO <anything>` | Reply to the handshake, shown in the log. Not required. |
| `ERR <anything>` | Error text, shown in the log. |
| `KEYDOWN <0-11>` / `KEYUP <0-11>` | A custom key was pressed / released. |
| `LKEYDOWN <0-3>` / `LKEYUP <0-3>` | A layer key was pressed / released. |
| `KNOBTURN <0-1> <clicks>` | A knob was turned by a signed number of clicks (e.g. `KNOBTURN 0 -2`). Limited to +/-50 per line. |
| `LAYER <0-3>` | Ask the host to switch layer. The host does **not** echo this back. |

Any other line is shown in the action log as `Device: ...`.

Important for the firmware: never reply to a host command with an event that
would trigger the same command again (for example, answering `LAYER 2` with
`LAYER 2`), or the two sides will bounce messages forever. Only send events
for **physical** things the user did.

## Settings (Configure > Device)

- **Send key and knob actions to the device**: turns the host -> device
  action lines on or off. The handshake and layer sync on connect are always sent.
- **Accept key and knob events from the device**: turns device -> host
  events off. `HELLO` and `ERR` lines are still logged.
- **Reconnect automatically**: opens a port you already allowed, without the
  picker, when the page loads or the device is plugged back in. If more than
  one allowed port exists, you are asked instead.
