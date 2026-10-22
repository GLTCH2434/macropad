package com.vayavyalabs.deskpad

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelUuid
import android.util.Log
import java.util.UUID

/**
 * Makes the tablet a Bluetooth HID peripheral (HID-over-GATT, HOGP) —
 * a composite device with a keyboard, a media (consumer) page and a mouse.
 *
 * Any host (Linux, Windows, macOS) that can pair with a BLE keyboard can
 * pair with this: the tablet advertises as an HID device, the host
 * connects and subscribes to the input report, and we send reports as the
 * user presses the macropad keys.
 *
 * All report sending is serialized on a single [HandlerThread] so event
 * order (press -> release) is always preserved.
 */
class HidEngine(context: Context, private val statusListener: (String) -> Unit) {

    companion object {
        const val DEVICE_NAME = "DeskPad"

        val UUID_HID = UUID.fromString("00001812-0000-1000-8000-00805f9b34fb")
        val UUID_HID_INFO = UUID.fromString("00002a4a-0000-1000-8000-00805f9b34fb")
        val UUID_REPORT_MAP = UUID.fromString("00002a4b-0000-1000-8000-00805f9b34fb")
        val UUID_PROTOCOL_MODE = UUID.fromString("00002a4e-0000-1000-8000-00805f9b34fb")
        val UUID_INPUT_REPORT = UUID.fromString("00002a22-0000-1000-8000-00805f9b34fb")
        val UUID_DEVICE_INFO = UUID.fromString("0000180a-0000-1000-8000-00805f9b34fb")
        val UUID_PNP = UUID.fromString("00002a50-0000-1000-8000-00805f9b34fb")
        val UUID_CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        /** Report IDs (consumer-initiated protocol — required for a composite device). */
        const val REPORT_KEYBOARD = 1
        const val REPORT_CONSUMER = 2
        const val REPORT_MOUSE = 3
    }

    private val appContext = context.applicationContext
    private val bluetoothManager =
        appContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val adapter = bluetoothManager.adapter

    @Volatile private var device: BluetoothDevice? = null
    @Volatile private var notificationsOn = false
    @Volatile private var advertising = false
    @Volatile private var bluetoothOn = adapter?.isEnabled == true
    @Volatile private var inputCharacteristic: BluetoothGattCharacteristic? = null
    /** Furthest HID handshake step the host has reached (diagnostic). */
    @Volatile private var hostStep = "none"

    private val workerThread = HandlerThread("deskpad-hid").apply { start() }
    val handler = Handler(workerThread.looper)

    // Callback must be declared before the server that receives it.
    private val serverCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(dev: BluetoothDevice, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    device = dev
                    notificationsOn = false
                    hostStep = "connected"
                    Log.d("DeskPadHID", "host connected: ${dev.address} (status=$status)")
                    stopAdvertising()
                    pushStatus()
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.d("DeskPadHID", "host disconnected (step was: $hostStep)")
                    device = null
                    notificationsOn = false
                    hostStep = "none"
                    // Re-arm after a short settle (Android 11 refuses the
                    // next connection if we re-advertise immediately), but
                    // NEVER tear down services while a host may be
                    // reconnecting: a host that catches the server
                    // mid-rebuild sees an empty GATT database and caches
                    // it (BlueZ does exactly this), which permanently
                    // breaks the HID handshake for that device. If a host
                    // is connected again by then, services are intact —
                    // just re-advertise.
                    handler.postDelayed({
                        if (!bluetoothOn) return@postDelayed
                        if (device == null) {
                            try {
                                gattServer?.clearServices()
                                buildServices()
                            } catch (e: Exception) {
                                Log.w("DeskPadHID", "re-arm failed: ${e.message}")
                            }
                        }
                        startAdvertising()
                    }, 300)
                    pushStatus()
                }
            }
        }

        override fun onCharacteristicReadRequest(
            dev: BluetoothDevice,
            requestId: Int,
            offset: Int,
            chr: BluetoothGattCharacteristic
        ) {
            // Support Read Blob (offset) reads: respond with the slice
            // from the requested offset, never the full value again —
            // a host doing offset reads (low-MTU fallback) must see the
            // tail, and a shorter-than-chunk tail terminates the read.
            // A characteristic we never assigned a value to reads back
            // as empty rather than null.
            val full = chr.value ?: ByteArray(0)
            val value =
                if (offset > 0 && offset < full.size) full.copyOfRange(offset, full.size) else full
            when (chr.uuid) {
                UUID_HID_INFO -> hostStep = "reading hid-info"
                UUID_REPORT_MAP -> hostStep = "reading report-map"
                UUID_INPUT_REPORT -> hostStep = hostStep // informational read
                else -> {}
            }
            Log.d(
                "DeskPadHID",
                "read ${chr.uuid} offset=$offset len=${full.size} -> ${value.size} bytes"
            )
            try {
                gattServer?.sendResponse(dev, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
            } catch (e: Exception) {
                // Host went away mid-request; the disconnect path recovers.
                Log.w("DeskPadHID", "sendResponse failed: ${e.message}")
            }
            pushStatus()
        }

        override fun onCharacteristicWriteRequest(
            dev: BluetoothDevice,
            requestId: Int,
            chr: BluetoothGattCharacteristic,
            prepared: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray
        ) {
            if (chr.uuid == UUID_PROTOCOL_MODE) {
                chr.value = value
                device = dev
                hostStep = "protocol-mode set"
                Log.d("DeskPadHID", "protocol mode written: ${value.toList()}")
                pushStatus()
            } else {
                Log.d("DeskPadHID", "write ${chr.uuid} len=${value.size}")
            }
            if (responseNeeded) {
                gattServer?.sendResponse(dev, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
            }
        }

        override fun onDescriptorWriteRequest(
            dev: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            prepared: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray
        ) {
            // A write to the input report's CCCD means the host has
            // subscribed to notifications — that's our "ready" signal.
            if (descriptor.uuid == UUID_CCCD) {
                notificationsOn = value.size >= 2 &&
                    ((value[0].toInt() and 0xFF) or (value[1].toInt() and 0xFF)) != 0
                hostStep = if (notificationsOn) "subscribed" else "notify disabled"
                Log.d("DeskPadHID", "CCCD write -> notificationsOn=$notificationsOn")
                pushStatus()
            }
            if (responseNeeded) {
                gattServer?.sendResponse(dev, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
            }
        }
    }

    // `lazy` breaks the mutual reference with serverCallback (whose
    // callbacks read `gattServer`), which the type checker rejects inline.
    @Volatile private var serverOpen = false
    private val gattServer: BluetoothGattServer? by lazy {
        adapter?.let {
            try {
                serverOpen = true
                bluetoothManager.openGattServer(appContext, serverCallback)
            } catch (_: Exception) {
                null
            }
        }
    }

    private val advertiser = adapter?.getBluetoothLeAdvertiser()

    private val advCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            advertising = true
            pushStatus()
        }

        override fun onStartFailure(errorCode: Int) {
            advertising = false
            pushStatus()
        }
    }

    /**
     * Re-advertise when Bluetooth is switched on after launch (e.g. the
     * user opens the pad first, then flips BT on) — without this the pad
     * sits silent until the app is restarted.
     */
    private val btReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
            val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
            bluetoothOn = state == BluetoothAdapter.STATE_ON
            if (bluetoothOn) startAdvertising() else pushStatus()
        }
    }

    init {
        buildServices()
        appContext.registerReceiver(btReceiver, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED))
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    fun start() {
        if (bluetoothOn) startAdvertising()
        else pushStatus()
    }

    fun stop() {
        stopAdvertising()
        try {
            appContext.unregisterReceiver(btReceiver)
        } catch (_: Exception) { }
        if (serverOpen) {
            try {
                gattServer?.close()
            } catch (_: Exception) { }
            serverOpen = false
        }
        workerThread.quitSafely()
    }

    /** Snapshot for the web UI, e.g. {"state":"advertising","ready":false}. */
    fun statusJson(): String {
        val d = device
        val ready = d != null && notificationsOn
        val state = when {
            ready -> "ready"
            d != null -> "connected"
            advertising -> "advertising"
            bluetoothOn -> "idle"
            else -> "bluetooth-off"
        }
        val name = (d?.name ?: DEVICE_NAME).replace("\\", "\\\\").replace("\"", "\\\"")
        return "{\"state\":\"$state\",\"name\":\"$name\",\"ready\":$ready,\"step\":\"$hostStep\"}"
    }

    fun isReady(): Boolean = device != null && notificationsOn

    // ------------------------------------------------------------------
    // HID report builders
    // ------------------------------------------------------------------

    /** Standard boot-format keyboard report: [id, mods, 0, k1..k6]. */
    fun keyboard(modifiers: Int, vararg keycodes: Int): ByteArray {
        val keys = keycodes.take(6)
        val out = ByteArray(3 + keys.size)
        out[0] = REPORT_KEYBOARD.toByte()
        out[1] = modifiers.toByte()
        out[2] = 0
        keys.forEachIndexed { i, k -> out[3 + i] = k.toByte() }
        return out
    }

    /** Consumer-page report (media keys): [id, usage_lo, usage_hi]. */
    fun consumer(usage: Int): ByteArray =
        byteArrayOf(REPORT_CONSUMER.toByte(), (usage and 0xFF).toByte(), (usage ushr 8).toByte())

    /** Mouse report: [id, buttons, x, y, wheel] (relative). */
    fun mouse(buttons: Int, x: Int = 0, y: Int = 0, wheel: Int = 0): ByteArray =
        byteArrayOf(REPORT_MOUSE.toByte(), buttons.toByte(), x.toByte(), y.toByte(), wheel.toByte())

    /** Send a report to the connected host (no-op when not ready). */
    fun send(report: ByteArray) {
        val d = device
        val server = gattServer
        val chr = inputCharacteristic
        if (d == null || server == null || chr == null || !notificationsOn) {
            Log.w("DeskPadHID", "send dropped (not ready): device=${d != null} notify=$notificationsOn step=$hostStep")
            return
        }
        handler.post {
            try {
                server.notifyCharacteristicChanged(d, chr, false, report)
                Log.d("DeskPadHID", "sent report: ${report.toList()}")
            } catch (e: Exception) {
                // Host went away mid-send; the disconnect callback recovers.
                Log.w("DeskPadHID", "notify failed: ${e.message}")
            }
        }
    }

    // ------------------------------------------------------------------
    // GATT server setup
    // ------------------------------------------------------------------

    private fun buildServices() {
        val server = gattServer ?: return
        server.clearServices()
        val permRead = BluetoothGattCharacteristic.PERMISSION_READ
        val permWrite = BluetoothGattCharacteristic.PERMISSION_WRITE
        val propRead = BluetoothGattCharacteristic.PROPERTY_READ
        val propWrite = BluetoothGattCharacteristic.PROPERTY_WRITE
        val propNotify = BluetoothGattCharacteristic.PROPERTY_NOTIFY

        // --- HID service -------------------------------------------------
        val hid = BluetoothGattService(UUID_HID, BluetoothGattService.SERVICE_TYPE_PRIMARY)

        // HID information: bcdHID 1.11, country 0x00, flags 0x00 (no virtual cable)
        hid.addCharacteristic(char(
            UUID_HID_INFO, permRead, propRead, byteArrayOf(0x11, 0x01, 0x00, 0x00)
        ))
        // Report map: composite keyboard + consumer + mouse
        hid.addCharacteristic(char(
            UUID_REPORT_MAP, permRead, propRead, ReportMap.BYTES
        ))
        // Protocol mode: 1 = consumer-initiated (reports carry report IDs)
        hid.addCharacteristic(char(
            UUID_PROTOCOL_MODE,
            permRead or permWrite,
            propRead or propWrite,
            byteArrayOf(0x01)
        ))
        // Input report (NOTIFY) — the reports we send to the host.
        // Carries a valid all-zero keyboard report so a read never
        // sees a null value (some Android versions mishandle that).
        val input = char(
            UUID_INPUT_REPORT,
            permRead,
            propRead or propNotify,
            keyboard(0)
        )
        input.addDescriptor(BluetoothGattDescriptor(UUID_CCCD, 0))
        inputCharacteristic = input
        hid.addCharacteristic(input)

        server.addService(hid)

        // --- Device information service -----------------------------------
        val deviceInfo = BluetoothGattService(UUID_DEVICE_INFO, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        // PnP ID LTV: len 0x0C, vendor source 0x02, vendor 0x1234, product 0x0001,
        // version 0x0100, sub-type 1, sub-id 1, sub-ver 1
        deviceInfo.addCharacteristic(char(
            UUID_PNP, permRead, propRead,
            byteArrayOf(0x0C, 0x02, 0x34, 0x12, 0x01, 0x00, 0x00, 0x01, 0x01, 0x01, 0x01)
        ))
        server.addService(deviceInfo)
    }

    private fun char(
        uuid: UUID,
        permissions: Int,
        properties: Int,
        value: ByteArray
    ): BluetoothGattCharacteristic {
        val c = BluetoothGattCharacteristic(uuid, permissions, properties)
        if (value.isNotEmpty()) c.value = value
        return c
    }

    // ------------------------------------------------------------------
    // Advertising
    // ------------------------------------------------------------------

    private fun startAdvertising() {
        val adv = advertiser
        if (adv == null) {
            pushStatus()
            return
        }
        handler.post {
            if (advertising) return@post
            val settings = AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .setTimeout(0) // advertise until stopped
                .build()
            // HID service UUID in the advertisement so hosts recognize us
            // as a BLE keyboard; the adapter's name is included too.
            val data = AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .addServiceUuid(ParcelUuid(UUID_HID))
                .build()
            val scanResponse = AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .addServiceUuid(ParcelUuid(UUID_HID))
                .build()
            try {
                adv.startAdvertising(settings, data, scanResponse, advCallback)
                // onStartSuccess/onStartFailure flip `advertising`.
            } catch (_: SecurityException) {
                pushStatus()
            } catch (_: IllegalStateException) {
                // Already advertising.
            }
        }
    }

    private fun stopAdvertising() {
        val adv = advertiser
        if (adv == null || !advertising) return
        try {
            adv.stopAdvertising(advCallback)
        } catch (_: Exception) {
        }
        advertising = false
    }

    // ------------------------------------------------------------------
    // Status
    // ------------------------------------------------------------------

    private fun pushStatus() {
        statusListener(statusJson())
    }
}
