package com.vayavyalabs.deskpad

/**
 * US-layout HID mapping for the Bluetooth device.
 *
 * [key] maps key names (the same names the companion server accepts, e.g.
 * "Enter", "F5", "a", "!") to a pair of (keyboard modifiers, HID keycode).
 * [char] maps printable characters the same way.
 *
 * Keycodes are from the HID Usage Tables (Generic Desktop / Keyboard page).
 */
object KeyLayout {
    // Keyboard-report modifier bits
    const val SHIFT = 0x01
    const val CTRL = 0x02
    const val ALT = 0x04
    const val META = 0x08

    /** Special (non-printable) key names -> HID usage codes. */
    private val SPECIAL: Map<String, Int> = buildMap {
        put("enter", 0x28)
        put("return", 0x28)
        put("escape", 0x29)
        put("esc", 0x29)
        put("backspace", 0x2A)
        put("tab", 0x2B)
        put("space", 0x2C)
        put("capslock", 0x39)
        put("f1", 0x3A); put("f2", 0x3B); put("f3", 0x3C); put("f4", 0x3D)
        put("f5", 0x3E); put("f6", 0x3F); put("f7", 0x40); put("f8", 0x41)
        put("f9", 0x42); put("f10", 0x43); put("f11", 0x44); put("f12", 0x45)
        put("f13", 0x66); put("f14", 0x67); put("f15", 0x68); put("f16", 0x69)
        put("f17", 0x6A); put("f18", 0x6B); put("f19", 0x6C); put("f20", 0x6D)
        put("f21", 0x6E); put("f22", 0x6F); put("f23", 0x70); put("f24", 0x71)
        put("printscreen", 0x46)
        put("prtsc", 0x46)
        put("prtscn", 0x46)
        put("scrolllock", 0x47)
        put("pause", 0x48)
        put("insert", 0x49)
        put("home", 0x4A)
        put("pageup", 0x4B)
        put("pgup", 0x4B)
        put("delete", 0x4C)
        put("del", 0x4C)
        put("end", 0x4D)
        put("pagedown", 0x4E)
        put("pgdn", 0x4E)
        put("left", 0x4F)
        put("right", 0x50)
        put("down", 0x51)
        put("up", 0x52)
        put("numlock", 0x53)
        put("kpslash", 0x54)
        put("kpmultiply", 0x55)
        put("kpdivide", 0x56)
        put("kpminus", 0x57)
        put("kpenter", 0x58)
        put("kpplus", 0x59)
        put("kp1", 0x5A); put("kp2", 0x5B); put("kp3", 0x5C); put("kp4", 0x5D)
        put("kp5", 0x5E); put("kp6", 0x5F); put("kp7", 0x60); put("kp8", 0x61)
        put("kp9", 0x62); put("kp0", 0x63)
        // Menu / apps key (application key)
        put("menu", 0x65)
        put("apps", 0x65)
    }

    /**
     * Printable single characters (US layout) -> (shift?, keycode).
     * Covers everything a macropad reasonably types: alphanumerics and
     * common symbols.
     */
    private val CHARS: Map<Char, Pair<Int, Int>> = buildMap {
        for (i in 0..25) put(('a' + i).toChar(), 0 to (0x04 + i))
        for (i in 0..9) put(('0' + i).toChar(), 0 to (0x1E + i))
        // Row 1 (shifted digits)
        put('!', SHIFT to 0x1E); put('@', SHIFT to 0x1F); put('#', SHIFT to 0x20)
        put('$', SHIFT to 0x21); put('%', SHIFT to 0x22); put('^', SHIFT to 0x23)
        put('&', SHIFT to 0x24); put('*', SHIFT to 0x25); put('(', SHIFT to 0x26)
        put(')', SHIFT to 0x27)
        // Row 2 (shifted symbols)
        put('_', SHIFT to 0x2D); put('+', SHIFT to 0x2E); put('{', SHIFT to 0x2F)
        put('}', SHIFT to 0x30); put('|', SHIFT to 0x31); put(':', SHIFT to 0x33)
        put('"', SHIFT to 0x34); put('<', SHIFT to 0x36); put('>', SHIFT to 0x37)
        put('?', SHIFT to 0x38); put('~', SHIFT to 0x35)
        // Unshifted symbols
        put('-', 0 to 0x2D); put('=', 0 to 0x2E); put('[', 0 to 0x2F)
        put(']', 0 to 0x30); put('\\', 0 to 0x31); put(';', 0 to 0x33)
        put('\'', 0 to 0x34); put('`', 0 to 0x35); put(',', 0 to 0x36)
        put('.', 0 to 0x37); put('/', 0 to 0x38)
        put(' ', 0 to 0x2C)
    }

    /**
     * Resolve a key name to (modifiers, keycode).
     * Accepts names like "Enter", "F5", "a", "!" and returns null when
     * the key cannot be expressed in this HID profile.
     */
    fun key(name: String): Pair<Int, Int>? {
        if (name.isEmpty()) return null
        if (name.length == 1) return char(name[0])
        return SPECIAL[name.lowercase()].let { it?.let { p -> 0 to p } }
    }

    /** Resolve a printable character to (shift?, keycode), or null. */
    fun char(c: Char): Pair<Int, Int>? = CHARS[c]
}
