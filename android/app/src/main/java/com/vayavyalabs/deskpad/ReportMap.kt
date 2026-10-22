package com.vayavyalabs.deskpad

/**
 * HID report map for the composite DeskPad device:
 *
 *   Report ID 1 — keyboard (standard boot format, 6 keys + modifiers)
 *   Report ID 2 — consumer control (media keys: play, volume, seek, …)
 *   Report ID 3 — mouse (buttons, relative x/y, wheel)
 *
 * This is the same kind of composite report map real BLE macropads
 * (QMK/VIA) expose, and it is understood by the HID-over-GATT stacks on
 * Linux (bluez), Windows and macOS.
 */
object ReportMap {

    fun hex(vararg b: Int): ByteArray = ByteArray(b.size) { b[it].toByte() }

    val BYTES: ByteArray = hex(
        // ================= Keyboard (Report ID 1) =================
        0x05, 0x01, //   Usage Page (Generic Desktop)
        0x09, 0x06, //   Usage (Keyboard)
        0xA1, 0x01, //   Collection (Application)
        0x85, 0x01, //   Report ID (1)
        0x05, 0x07, //   Usage Page (Keyboard/Keypad)
        0x19, 0x00, //   Usage Minimum (0)
        0x29, 0xFF, //   Usage Maximum (255)
        0x15, 0x00, //   Logical Minimum (0)
        0x25, 0x01, //   Logical Maximum (1)
        0x75, 0x01, //   Report Size (1)
        0x95, 0x08, //   Report Count (8)
        0x81, 0x02, //   Input (Data, Variable, Absolute)      -- modifier byte
        0x75, 0x01, //   Report Size (1)
        0x95, 0x01, //   Report Count (1)
        0x81, 0x01, //   Input (Constant)                      -- reserved byte
        0x75, 0x01, //   Report Size (1)
        0x95, 0x05, //   Report Count (5)
        0x81, 0x01, //   Input (Constant)                      -- 5 reserved bits
        0x75, 0x08, //   Report Size (8)
        0x95, 0x06, //   Report Count (6)
        0x81, 0x00, //   Input (Data, Array)                   -- 6 keycodes
        0xC0,       //   End Collection

        // ================ Consumer control (Report ID 2) ================
        0x05, 0x0C, //   Usage Page (Consumer)
        0x09, 0x01, //   Usage (Consumer Control)
        0xA1, 0x01, //   Collection (Application)
        0x85, 0x02, //   Report ID (2)
        0x15, 0x00, //   Logical Minimum (0)
        0x26, 0xFF, 0x03, // Logical Maximum (1023)
        0x75, 0x10, //   Report Size (16)
        0x95, 0x01, //   Report Count (1)
        0x81, 0x00, //   Input (Data, Array)                   -- consumer usage
        0x15, 0x00, //   Logical Minimum (0)
        0x25, 0x01, //   Logical Maximum (1)
        0x75, 0x01, //   Report Size (1)
        0x95, 0x08, //   Report Count (8)
        0x81, 0x02, //   Input (Data, Variable, Absolute)      -- meta bytes
        0xC0,       //   End Collection

        // ======================= Mouse (Report ID 3) =====================
        0x05, 0x01, //   Usage Page (Generic Desktop)
        0x09, 0x02, //   Usage (Mouse)
        0xA1, 0x01, //   Collection (Application)
        0x85, 0x03, //   Report ID (3)
        0x09, 0x01, //   Usage (Pointer)
        0xA1, 0x00, //   Collection (Physical)
        0x05, 0x09, //   Usage Page (Button)
        0x19, 0x01, //   Usage Minimum (1)
        0x29, 0x05, //   Usage Maximum (5)
        0x15, 0x00, //   Logical Minimum (0)
        0x25, 0x01, //   Logical Maximum (1)
        0x75, 0x01, //   Report Size (1)
        0x95, 0x05, //   Report Count (5)
        0x81, 0x02, //   Input (Data, Variable, Absolute)      -- buttons
        0x75, 0x03, //   Report Size (3)
        0x95, 0x01, //   Report Count (1)
        0x81, 0x01, //   Input (Constant)                      -- padding
        0x05, 0x01, //   Usage Page (Generic Desktop)
        0x09, 0x30, //   Usage (X)
        0x09, 0x31, //   Usage (Y)
        0x09, 0x38, //   Usage (Wheel)
        0x15, 0x81, //   Logical Minimum (-127)
        0x25, 0x7F, //   Logical Maximum (127)
        0x75, 0x08, //   Report Size (8)
        0x95, 0x03, //   Report Count (3)
        0x81, 0x06, //   Input (Data, Variable, Relative)      -- x, y, wheel
        0xC0,       //   End Collection
        0xC0        //   End Collection
    )
}
