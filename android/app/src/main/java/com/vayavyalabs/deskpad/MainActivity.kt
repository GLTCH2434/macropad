package com.vayavyalabs.deskpad

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothManager
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Toast

/**
 * DeskPad native shell: hosts the PWA UI in a WebView and provides the
 * `window.DeskPad` bridge. When the bridge is present, the web UI sends
 * actions here instead of to the companion server, and they are emitted
 * as Bluetooth HID reports — the tablet behaves like a BLE keyboard.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private var hid: Hid? = null
    private val main = Handler(Looper.getMainLooper())
    private var lastToastAt = 0L
    private var originalBtName: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = WebView(this)
        webView.setBackgroundColor(Color.parseColor("#0b0d12"))
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            textZoom = 100
        }
        setContentView(webView)

        // JS -> native bridge: window.DeskPad
        val bridge = object {
            @JavascriptInterface fun action(json: String) = hid?.action(json)
            @JavascriptInterface fun dial(json: String) = hid?.dial(json)
            @JavascriptInterface fun status(): String =
                hid?.statusJson() ?: """{"state":"stopped","name":"DeskPad","ready":false}"""
            @JavascriptInterface fun toast(message: String) =
                main.post { safeToast(message) }
        }
        webView.addJavascriptInterface(bridge, "DeskPad")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(cm: ConsoleMessage): Boolean {
                Log.d("DeskPadWeb", "${cm.message()} (${cm.sourceId()}:${cm.lineNumber()})")
                return true
            }
        }

        // The web app ships in assets — no network needed at all.
        webView.loadUrl("file:///android_asset/index.html")
        setupBtName()
        setupHid()
    }

    /**
     * Advertise as "DeskPad" so hosts see a sensible name in their
     * Bluetooth settings. Restores the tablet's original BT name on exit.
     */
    private fun setupBtName() {
        try {
            val mgr = getSystemService(BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = mgr.adapter ?: return
            originalBtName = adapter.name
            if (adapter.name != HidEngine.DEVICE_NAME) {
                val ok = adapter.setName(HidEngine.DEVICE_NAME)
                if (!ok) Log.w("DeskPad", "Could not set BT name to DeskPad")
            }
        } catch (e: Exception) {
            Log.w("DeskPad", "BT name setup failed", e)
        }
    }

    override fun onResume() {
        super.onResume()
        immersive()
        hid?.start()
    }

    // On Android 12+ the runtime prompt (esp. BLUETOOTH_ADVERTISE) can
    // still be unanswered when the delayed start() fires — retry once the
    // decision lands.
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1) hid?.start()
    }

    override fun onDestroy() {
        hid?.stop()
        restoreBtName()
        webView.destroy()
        super.onDestroy()
    }

    private fun restoreBtName() {
        val name = originalBtName ?: return
        try {
            val mgr = getSystemService(BLUETOOTH_SERVICE) as BluetoothManager
            mgr.adapter?.setName(name)
        } catch (e: Exception) {
            Log.w("DeskPad", "BT name restore failed", e)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Back closes the Configure dialog first, then exits.
        webView.evaluateJavascript(
            "(function(){var m=document.getElementById('config-modal');" +
                "return (m && !m.hidden) ? 'open' : 'closed';})()"
        ) { open ->
            if (open == "open") {
                webView.evaluateJavascript("if (typeof closeConfig==='function') closeConfig();", null)
            } else {
                finishAffinity()
            }
        }
    }

    private fun setupHid() {
        if (Build.VERSION.SDK_INT >= 31) {
            val needed = listOf(
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE
            ).filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
            if (needed.isNotEmpty()) requestPermissions(needed.toTypedArray(), 1)
        }
        hid = Hid(
            this,
            onUnsupported = { msg -> main.post { safeToast(msg) } },
            onStatus = { json -> main.post { pushStatusToWeb(json) } }
        )
        // Small delay so the page (and its DeskPad.onStatus hook) exists.
        main.postDelayed({
            hid?.start()
            pushStatusToWeb(hid?.statusJson() ?: "{}")
        }, 600)
    }

    private fun safeToast(msg: String) {
        val now = System.currentTimeMillis()
        if (now - lastToastAt < 1500) return
        lastToastAt = now
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    private fun pushStatusToWeb(json: String) {
        // json is a small object literal built in statusJson(); safe to inline.
        webView.evaluateJavascript(
            "window.DeskPad && typeof window.DeskPad.onStatus === 'function' && window.DeskPad.onStatus($json);",
            null
        )
    }

    private fun immersive() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            )
    }
}
