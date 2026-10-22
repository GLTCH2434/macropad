package com.vayavyalabs.deskpad

import android.content.Context

/**
 * Facade used by the JS bridge: receives action/dial calls from the web
 * UI and turns them into HID reports, with throttled "not connected"
 * feedback so a dead pad doesn't look silently broken.
 */
class Hid(
    context: Context,
    private val onUnsupported: (String) -> Unit,
    onStatus: (String) -> Unit
) {
    private val engine = HidEngine(context.applicationContext, onStatus)
    private val executor = ActionExecutor(engine, onUnsupported)
    @Volatile private var lastNotReadyToast = 0L

    fun start() = engine.start()
    fun stop() = engine.stop()
    fun statusJson(): String = engine.statusJson()

    fun action(json: String) {
        if (!engine.isReady()) {
            notReadyFeedback()
            return
        }
        executor.action(json)
    }

    fun dial(json: String) {
        if (!engine.isReady()) {
            notReadyFeedback()
            return
        }
        executor.dial(json)
    }

    private fun notReadyFeedback() {
        val now = System.currentTimeMillis()
        if (now - lastNotReadyToast < 2500) return
        lastNotReadyToast = now
        onUnsupported("No host connected — pair 'DeskPad' with your computer over Bluetooth")
    }
}
