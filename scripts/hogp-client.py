#!/usr/bin/env python3
"""
DeskPad HOGP client — the Linux host side for the DeskPad BLE macropad.

Why this exists: Ubuntu's bluez package does not ship BlueZ's HID-over-GATT
(hid) plugin, so the stack pairs and connects to the tablet but never turns
it into a keyboard. This daemon plays the host role directly:

  1. connects to the tablet as a GATT client (bleak / org.bluez D-Bus)
  2. completes the HID handshake: read HID info + report map, set
     consumer-initiated protocol mode, subscribe to the input report
  3. decodes keyboard / consumer / mouse reports and injects them as
     real input events via evdev (UInput)

It auto-reconnects and re-runs the handshake whenever the link drops.

Usage:
  python3 scripts/hogp-client.py [--mac AA:BB:CC:DD:EE:FF] [--name DeskPad]
"""

import argparse
import asyncio
import subprocess
import sys
import time

try:
    from bleak import BleakClient
except ImportError:
    sys.exit("bleak is required:  pip3 install --user bleak")

import evdev.ecodes as e
from evdev import UInput

DEVICE_NAME = "DeskPad"

# ---------------------------------------------------------------------------
# HID usage tables (HID Usage Tables 1.12) -> Linux input event codes
# ---------------------------------------------------------------------------

KEY_MAP = {
    0x04: e.KEY_A, 0x05: e.KEY_B, 0x06: e.KEY_C, 0x07: e.KEY_D, 0x08: e.KEY_E,
    0x09: e.KEY_F, 0x0A: e.KEY_G, 0x0B: e.KEY_H, 0x0C: e.KEY_I, 0x0D: e.KEY_J,
    0x0E: e.KEY_K, 0x0F: e.KEY_L, 0x10: e.KEY_M, 0x11: e.KEY_N, 0x12: e.KEY_O,
    0x13: e.KEY_P, 0x14: e.KEY_Q, 0x15: e.KEY_R, 0x16: e.KEY_S, 0x17: e.KEY_T,
    0x18: e.KEY_U, 0x19: e.KEY_V, 0x1A: e.KEY_W, 0x1B: e.KEY_X, 0x1C: e.KEY_Y,
    0x1D: e.KEY_Z,
    0x1E: e.KEY_1, 0x1F: e.KEY_2, 0x20: e.KEY_3, 0x21: e.KEY_4, 0x22: e.KEY_5,
    0x23: e.KEY_6, 0x24: e.KEY_7, 0x25: e.KEY_8, 0x26: e.KEY_9, 0x27: e.KEY_0,
    0x28: e.KEY_ENTER, 0x29: e.KEY_ESC, 0x2A: e.KEY_BACKSPACE, 0x2B: e.KEY_TAB,
    0x2C: e.KEY_SPACE,
    0x2D: e.KEY_MINUS, 0x2E: e.KEY_EQUAL, 0x2F: e.KEY_LEFTBRACE,
    0x30: e.KEY_RIGHTBRACE, 0x31: e.KEY_BACKSLASH, 0x33: e.KEY_SEMICOLON,
    0x34: e.KEY_APOSTROPHE, 0x35: e.KEY_GRAVE, 0x36: e.KEY_COMMA,
    0x37: e.KEY_DOT, 0x38: e.KEY_SLASH, 0x39: e.KEY_CAPSLOCK,
    0x3A: e.KEY_F1, 0x3B: e.KEY_F2, 0x3C: e.KEY_F3, 0x3D: e.KEY_F4,
    0x3E: e.KEY_F5, 0x3F: e.KEY_F6, 0x40: e.KEY_F7, 0x41: e.KEY_F8,
    0x42: e.KEY_F9, 0x43: e.KEY_F10, 0x44: e.KEY_F11, 0x45: e.KEY_F12,
    0x46: e.KEY_SYSRQ, 0x47: e.KEY_SCROLLLOCK, 0x48: e.KEY_PAUSE,
    0x49: e.KEY_INSERT, 0x4A: e.KEY_HOME, 0x4B: e.KEY_PAGEUP,
    0x4C: e.KEY_DELETE, 0x4D: e.KEY_END, 0x4E: e.KEY_PAGEDOWN,
    0x4F: e.KEY_LEFT, 0x50: e.KEY_RIGHT, 0x51: e.KEY_DOWN, 0x52: e.KEY_UP,
    0x53: e.KEY_NUMLOCK, 0x54: e.KEY_KPSLASH, 0x55: e.KEY_KPASTERISK,
    0x56: e.KEY_KPMINUS, 0x57: e.KEY_KPPLUS, 0x58: e.KEY_KPENTER,
    0x59: e.KEY_KP1, 0x5A: e.KEY_KP2, 0x5B: e.KEY_KP3, 0x5C: e.KEY_KP4,
    0x5D: e.KEY_KP5, 0x5E: e.KEY_KP6, 0x5F: e.KEY_KP7, 0x60: e.KEY_KP8,
    0x61: e.KEY_KP9, 0x62: e.KEY_KP0, 0x63: e.KEY_KPDOT, 0x65: e.KEY_MENU,
}

# HID keyboard modifier bits (report byte 1) -> Linux modifier keys
MOD_MAP = [
    (0x01, e.KEY_LEFTSHIFT),
    (0x02, e.KEY_LEFTCTRL),
    (0x04, e.KEY_LEFTALT),
    (0x08, e.KEY_LEFTMETA),
]

# Consumer control page usages -> Linux keys
CONSUMER_MAP = {
    0xCD: e.KEY_PLAYPAUSE,
    0xB5: e.KEY_NEXTSONG,
    0xB6: e.KEY_PREVIOUSSONG,
    0xB7: e.KEY_STOPCD,
    0xE2: e.KEY_MUTE,
    0xE9: e.KEY_VOLUMEUP,
    0xEA: e.KEY_VOLUMEDOWN,
}

MOUSE_BUTTONS = [
    (0x01, e.BTN_LEFT),
    (0x02, e.BTN_RIGHT),
    (0x04, e.BTN_MIDDLE),
]


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def signed(b: int) -> int:
    return b - 256 if b > 127 else b


# ---------------------------------------------------------------------------
# Input injection
# ---------------------------------------------------------------------------

class Pad:
    def __init__(self) -> None:
        keys = list(KEY_MAP.values()) + [m for _, m in MOD_MAP]
        self.kbd = UInput({e.EV_KEY: sorted(set(keys))}, name="DeskPad Keyboard")
        self.mouse = UInput(
            {
                e.EV_KEY: [e.BTN_LEFT, e.BTN_RIGHT, e.BTN_MIDDLE],
                e.EV_REL: [e.REL_X, e.REL_Y, e.REL_WHEEL],
            },
            name="DeskPad Mouse",
        )
        self.kbd_pressed = set()
        self.mouse_btns = set()

    def keyboard(self, mods: int, keycodes) -> None:
        want = {linux for bit, linux in MOD_MAP if mods & bit}
        want |= {KEY_MAP[k] for k in keycodes if k in KEY_MAP}
        for k in self.kbd_pressed - want:
            self.kbd.write(e.EV_KEY, k, 0)
        for k in want - self.kbd_pressed:
            self.kbd.write(e.EV_KEY, k, 1)
        self.kbd.syn()
        self.kbd_pressed = want

    def consumer(self, usage: int) -> None:
        key = CONSUMER_MAP.get(usage)
        if key is None:
            return
        self.kbd.write(e.EV_KEY, key, 1)
        self.kbd.syn()
        self.kbd.write(e.EV_KEY, key, 0)
        self.kbd.syn()

    def mouse(self, buttons: int, x: int, y: int, wheel: int) -> None:
        want = {linux for bit, linux in MOUSE_BUTTONS if buttons & bit}
        for k in self.mouse_btns - want:
            self.mouse.write(e.EV_KEY, k, 0)
        for k in want - self.mouse_btns:
            self.mouse.write(e.EV_KEY, k, 1)
        if x:
            self.mouse.write(e.EV_REL, e.REL_X, x)
        if y:
            self.mouse.write(e.EV_REL, e.REL_Y, y)
        if wheel:
            self.mouse.write(e.EV_REL, e.REL_WHEEL, wheel)
        self.mouse.syn()
        self.mouse_btns = want

    def close(self) -> None:
        self.kbd.close()
        self.mouse.close()


# ---------------------------------------------------------------------------
# GATT client
# ---------------------------------------------------------------------------

HID_SVC = "1812"
HID_INFO = "2a4a"
REPORT_MAP = "2a4b"
PROTOCOL_MODE = "2a4e"
INPUT_REPORT = "2a22"


def release_link(mac: str) -> None:
    """BlueZ may be holding the GATT link (the tablet serves one client at a
    time); disconnect it first. Best effort."""
    try:
        subprocess.run(
            ["bluetoothctl", "--timeout", "5", "disconnect", mac],
            capture_output=True, timeout=8,
        )
    except Exception:
        pass


async def run_client(mac: str) -> None:
    pad = Pad()
    log(f"connecting to {mac} …")
    client = BleakClient(mac, timeout=25)
    try:
        await client.connect()
        log("GATT connected")

        try:
            hid_info = await client.read_gatt_char(HID_INFO)
        except Exception:
            # Almost always: a stale/empty service cache on this host
            # (BlueZ cached a mid-rebuild empty DB earlier) or the pad
            # app is not running on the tablet.
            raise RuntimeError(
                "HID service not found — on the PC: forget 'DeskPad' and re-pair; "
                "on the tablet: force-close and reopen DeskPad"
            )
        log(f"HID info: {bytes(hid_info).hex(' ')} (bcdHID {hid_info[0] | hid_info[1] << 8:#04x})")

        report_map = await client.read_gatt_char(REPORT_MAP)
        log(f"report map: {len(report_map)} bytes OK")

        # Consumer-initiated protocol: reports carry report IDs.
        await client.write_gatt_char(PROTOCOL_MODE, b"\x01", response=False)
        log("protocol mode: consumer-initiated")

        def on_report(_uuid: str, data: bytearray) -> None:
            if not data:
                return
            rid = data[0]
            try:
                if rid == 1:
                    pad.keyboard(data[1], data[3:9])
                    log(f"keyboard: mods={data[1]:#04x} keys={list(data[3:9])}")
                elif rid == 2:
                    usage = data[1] | (data[2] << 8)
                    log(f"consumer: usage={usage:#04x}")
                    pad.consumer(usage)
                elif rid == 3:
                    pad.mouse(data[1], signed(data[2]), signed(data[3]), signed(data[4]))
                    log(f"mouse: btn={data[1]} dx={signed(data[2])} dy={signed(data[3])} wheel={signed(data[4])}")
                else:
                    log(f"unknown report id {rid}")
            except Exception as ex:
                log(f"inject error: {ex}")

        if not client.start_notify(INPUT_REPORT, on_report):
            raise RuntimeError("could not subscribe to input report (CCCD write failed)")
        log("input report subscribed — DeskPad is LIVE. Press keys on the tablet!")

        await client.disconnection_wait()
        log("disconnected")
    finally:
        # Always release the link — the tablet serves one GATT client at a
        # time, and a stale client would block every future attempt.
        try:
            await asyncio.wait_for(client.disconnect(), timeout=5)
        except Exception:
            pass
        pad.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="DeskPad HOGP client")
    ap.add_argument("--mac", help="tablet MAC (default: discover by name)")
    ap.add_argument("--name", default=DEVICE_NAME)
    args = ap.parse_args()

    mac = args.mac
    if not mac:
        from bleak import BleakScanner

        # Filter by the HID service UUID: the pad's app GATT server
        # advertises 0x1812, but the tablet's adapter-level discoverable
        # advertisement (same name, no services) must not match.
        async def _find():
            found = {}

            def cb(dev, adv):
                name = (adv.local_name or "").lower()
                if args.name.lower() in name:
                    found[dev.address] = dev

            scanner = BleakScanner(with_services=["1812"], detection_callback=cb)
            await scanner.start()
            try:
                await asyncio.sleep(12)
            finally:
                await scanner.stop()
            return next(iter(found.values()), None)

        dev = asyncio.run(_find())
        if not dev:
            sys.exit(
                f"could not find '{args.name}' advertising the HID service — "
                "is the DeskPad app open and its pill showing 'pair DeskPad…'?\n"
                "Re-run with --mac AA:BB:CC:DD:EE:FF to force an address"
            )
        mac = dev.address
        log(f"found {args.name} at {mac} (HID service advertised)")

    while True:
        try:
            release_link(mac)
            asyncio.run(run_client(mac))
        except KeyboardInterrupt:
            log("bye")
            return
        except Exception as ex:
            log(f"error: {type(ex).__name__}: {ex}")
        log("reconnecting in 4 s …")
        time.sleep(4)


if __name__ == "__main__":
    main()
