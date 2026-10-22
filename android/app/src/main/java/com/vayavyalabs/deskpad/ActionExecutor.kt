package com.vayavyalabs.deskpad

import org.json.JSONObject

/**
 * Translates DeskPad actions (the same vocabulary the companion server
 * understands) into HID report sequences sent over Bluetooth.
 *
 * Everything runs on the engine's single worker thread, so press/release
 * ordering is deterministic.
 *
 * What works over Bluetooth:
 *   keypress, shortcut, text, media, mouse, layer (local), macros
 * What needs the companion server (host-specific):
 *   app, shell, brightness dials, unknown dial commands
 */
class ActionExecutor(
    private val engine: HidEngine,
    private val onUnsupported: (String) -> Unit
) {

    private fun post(r: Runnable) = engine.handler.post(r)
    private fun postDelayed(ms: Int, r: Runnable) = engine.handler.postDelayed(r, ms.toLong())
    private fun after(ms: Int, r: () -> Unit) = postDelayed(ms) { r() }

    // ------------------------------------------------------------------
    // Key actions
    // ------------------------------------------------------------------

    fun action(json: String) {
        val obj = JSONObject(json)
        val type = obj.optString("type", "none")
        val params = obj.optJSONObject("params") ?: JSONObject()
        when (type) {
            "none" -> {}
            "keypress" -> keypress(params.optString("key", ""))
            "shortcut" -> shortcut(params.optString("combo", ""))
            "text" -> typeText(params.optString("text", ""))
            "media" -> media(params.optString("action", ""))
            "mouse" -> mouse(params.optString("action", ""))
            "layer" -> {} // handled locally by the web UI
            "macro" -> macro(params.optString("macroId", ""))
            "app" -> onUnsupported("Launching apps is server-only (needs the companion server)")
            "shell" -> onUnsupported("Shell commands are server-only (needs the companion server)")
            else -> onUnsupported("Unknown action type: $type")
        }
    }

    private fun keypress(name: String) {
        if (name.isEmpty()) return
        val (mods, code) = KeyLayout.key(name)
            ?: return onUnsupported("Key not available over Bluetooth: $name")
        keyTap(mods, code)
    }

    private fun shortcut(combo: String) {
        if (combo.isEmpty()) return
        var mods = 0
        var key: String? = null
        for (part in combo.split("+")) {
            val p = part.trim().lowercase()
            when {
                p == "ctrl" || p == "control" -> mods = mods or KeyLayout.CTRL
                p == "shift" -> mods = mods or KeyLayout.SHIFT
                p == "alt" || p == "option" -> mods = mods or KeyLayout.ALT
                p in setOf("super", "win", "meta", "cmd", "command") -> mods = mods or KeyLayout.META
                else -> key = part.trim()
            }
        }
        if (key.isNullOrEmpty()) {
            if (mods != 0) keyTap(mods, 0) // modifier-only tap
            else onUnsupported("Shortcut has no key: $combo")
            return
        }
        val (km, code) = KeyLayout.key(key)
            ?: return onUnsupported("Key not available over Bluetooth: $key")
        keyTap(mods or km, code)
    }

    private fun typeText(text: String) {
        if (text.isEmpty()) return
        for (ch in text) {
            val pair = KeyLayout.char(ch)
            if (pair == null) {
                onUnsupported("Cannot type '$ch' over Bluetooth (US layout only)")
                continue
            }
            keyTap(pair.first, pair.second)
        }
    }

    private fun media(action: String) {
        val usage = when (action.lowercase()) {
            "play", "pause", "playpause", "play-pause" -> 0xCD
            "next" -> 0xB5
            "previous", "prev" -> 0xB6
            "stop" -> 0xB7
            "mute" -> 0xE2
            "volume_up", "volup" -> 0xE9
            "volume_down", "voldown" -> 0xEA
            else -> return onUnsupported("Media action not available over Bluetooth: $action")
        }
        mediaTap(usage)
    }

    private fun mouse(action: String) {
        when (action.lowercase()) {
            "left" -> mouseClick(0b00001)
            "right" -> mouseClick(0b00010)
            "middle" -> mouseClick(0b00100)
            "scrollup" -> wheel(2)
            "scrolldown" -> wheel(-2)
            else -> onUnsupported("Mouse action not available over Bluetooth: $action")
        }
    }

    private fun macro(id: String) {
        when (id) {
            "vim_wq" -> {
                typeText(":wq")
                after(150) { keypress("Enter") }
            }
            "vim_space_s_a" -> {
                keypress("space")
                after(70) { keypress("s") }
                after(150) { keypress("a") }
            }
            "save_all" -> {
                shortcut("Ctrl+S")
                after(280) { shortcut("Ctrl+Shift+S") }
            }
            "select_word" -> {
                shortcut("Ctrl+Left")
                after(90) { shortcut("Ctrl+Shift+Right") }
            }
            "duplicate_line" -> {
                keypress("Home")
                after(70) { shortcut("Shift+End") }
                after(140) { shortcut("Ctrl+C") }
                after(210) { keypress("End") }
                after(280) { keypress("Enter") }
                after(350) { shortcut("Ctrl+V") }
            }
            "copy_file_path" -> {
                shortcut("Ctrl+L")
                after(90) { shortcut("Ctrl+C") }
            }
            "new_terminal_tab", "reopen_closed_tab" -> shortcut("Ctrl+Shift+T")
            "close_tab" -> shortcut("Ctrl+W")
            else -> onUnsupported("Unknown macro: $id (see actions/macros.py for known ids)")
        }
    }

    // ------------------------------------------------------------------
    // Dials
    // ------------------------------------------------------------------

    fun dial(json: String) {
        val obj = JSONObject(json)
        val type = obj.optString("type", "none")
        val delta = obj.optInt("delta", 0)
        val params = obj.optJSONObject("params") ?: JSONObject()
        when (type) {
            "none" -> {}
            "volume" -> volumeDial(delta)
            "scroll" -> scrollDial(delta, params.optString("direction", "vertical"))
            "zoom" -> zoomDial(delta)
            "brightness" -> onUnsupported("Brightness is host-specific — needs the companion server")
            "custom" -> customDial(params.optString("command", ""), delta)
            else -> onUnsupported("Unknown dial type: $type")
        }
    }

    private fun volumeDial(delta: Int) {
        if (delta == 0) return
        val up = delta > 0
        val repeats = delta.coerceIn(1, 8)
        repeat(repeats) { i ->
            after(40 * i) { mediaTap(if (up) 0xE9 else 0xEA) }
        }
    }

    private fun scrollDial(delta: Int, direction: String) {
        if (delta == 0) return
        val n = delta.coerceIn(1, 5)
        if (direction == "horizontal") {
            // Same workaround the server uses: Shift + left/right arrows
            val right = delta > 0
            repeat(n) { i ->
                after(40 * i) { keyTap(KeyLayout.SHIFT, if (right) 0x50 else 0x4F) }
            }
        } else {
            val d = delta.coerceIn(-8, 8)
            repeat(n) { i -> after(40 * i) { wheel(d) } }
        }
    }

    private fun zoomDial(delta: Int) {
        when {
            delta > 0 -> shortcut("Ctrl+=")
            delta < 0 -> shortcut("Ctrl+-")
            delta == 0 -> shortcut("Ctrl+0")
        }
    }

    private fun customDial(command: String, delta: Int) {
        when (command.lowercase()) {
            "seek" -> when {
                delta > 0 -> media("next")
                delta < 0 -> media("previous")
                else -> {}
            }
            "rotate" -> when {
                delta > 0 -> keypress("r")
                delta < 0 -> shortcut("Shift+R")
                else -> {}
            }
            "" -> {}
            else -> onUnsupported("Dial command '$command' is server-only (needs the companion server)")
        }
    }

    // ------------------------------------------------------------------
    // Report primitives (all serialized on the engine thread)
    // ------------------------------------------------------------------

    private fun keyTap(mods: Int, code: Int) {
        post { engine.send(engine.keyboard(mods, code)) }
        postDelayed(30) { engine.send(engine.keyboard(0)) }
    }

    private fun mediaTap(usage: Int) {
        post { engine.send(engine.consumer(usage)) }
        postDelayed(30) { engine.send(engine.consumer(0)) }
    }

    private fun mouseClick(button: Int) {
        post { engine.send(engine.mouse(button)) }
        postDelayed(30) { engine.send(engine.mouse(0)) }
    }

    private fun wheel(delta: Int) {
        post { engine.send(engine.mouse(0, 0, 0, delta)) }
    }
}
