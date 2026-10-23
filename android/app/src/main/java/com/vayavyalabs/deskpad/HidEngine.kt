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
    /** Last advertising failure (null = healthy). Shown in the pill. */
    @Volatile private var advError: String? = null
    @Volatile private var advRetries = 0

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
                        // Services are left untouched (clear+re-add has been
                        // observed to drop the HID service on this build);
                        // a reconnected host simply needs advertising back.
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

    // NOTE: a null server is fatal for HID — the app would keep
    // advertising (advertiser is independent) while every host connection
    // lands on the ANDROID SYSTEM GATT server (Generic Access + Device
    // Info, demands pairing, no HID service). We must therefore log and
    // expose the open failure instead of swallowing it.
    private var gattServer: BluetoothGattServer? = null
    @Volatile private var gattsError: String? = null
    @Volatile private var serverRetries = 0

    /** Open the GATT server (idempotent, retryable). */
    private fun openServer() {
        if (gattServer != null) return
        val a = adapter
        if (a == null) {
            gattsError = "no-bt-adapter"
            pushStatus()
            return
        }
        try {
            val s = bluetoothManager.openGattServer(appContext, serverCallback)
            if (s != null) {
                gattServer = s
                gattsError = null
                serverRetries = 0
                // On some Android builds addService silently fails when
                // called immediately after open (server not ready yet).
                // Give it a beat, then register + VERIFY + retry.
                handler.postDelayed({ registerServices(0) }, 500)
            } else {
                gattsError = "openGattServer-returned-null"
                Log.w("DeskPadHID", "openGattServer returned null")
            }
        } catch (e: Exception) {
            gattsError = (e.javaClass.simpleName +
                (e.message?.let { ": " + it } ?: "")).replace("\"", "'")
            Log.e("DeskPadHID", "openGattServer failed", e)
        }
        pushStatus()
    }

    private val advertiser = adapter?.getBluetoothLeAdvertiser()

    private val advCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            advertising = true
            advError = null
            advRetries = 0
            Log.d("DeskPadHID", "advertising up")
            pushStatus()
        }

        override fun onStartFailure(errorCode: Int) {
            advertising = false
            advError = errorCode.toString()
            Log.w("DeskPadHID", "advertising failed: code=$errorCode (retry #$advRetries)")
            pushStatus()
            // Self-heal: one failure (stale advertiser state after an app
            // restart / reinstall, link still tearing down, "too many
            // advertisers") used to leave the pad idle forever. Keep
            // trying with backoff until the advertiser is up.
            if (bluetoothOn) {
                val delay = (1000L * (advRetries + 1)).coerceAtMost(8000L)
                handler.postDelayed({
                    advRetries++
                    startAdvertising()
                }, delay)
            }
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
        openServer()
        appContext.registerReceiver(btReceiver, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED))
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    fun start() {
        // Keep trying to open the GATT server: the stack may not be
        // ready at first launch (boot, BT just enabled, state left over
        // from a previous instance). Each app resume gives it another
        // chance.
        if (gattServer == null && serverRetries < 20) {
            serverRetries++
            handler.postDelayed({ openServer() }, (500L * serverRetries).coerceAtMost(5000L))
        }
        if (bluetoothOn) startAdvertising()
        else pushStatus()
    }

    fun stop() {
        stopAdvertising()
        try {
            appContext.unregisterReceiver(btReceiver)
        } catch (_: Exception) { }
        if (gattServer != null) {
            try {
                gattServer?.close()
            } catch (_: Exception) { }
            gattServer = null
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
        val adv = (advError ?: "ok").replace("\"", "'")
        val gatts = gattsError ?: "ok"
        return "{\"state\":\"$state\",\"name\":\"$name\",\"ready\":$ready,\"step\":\"$hostStep\",\"adv\":\"$adv\",\"gatts\":\"$gatts\"}"
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

    /**
     * Set of service UUIDs the server currently holds, via getServices().
     * On this Android 11 build getService(uuid) returned null for services
     * that were in fact registered, which made the pad spin on
     * "re-registering" forever; the host-side DB dump is the ground truth
     * and getServices() matches it better than getService(uuid) does.
     */
    private fun registeredUuids(): Set<UUID> {
        val server = gattServer ?: return emptySet()
        return try {
            server.getServices().mapTo(HashSet()) { it.uuid }
        } catch (e: Exception) {
            Log.w("DeskPadHID", "getServices threw: ${e.javaClass.simpleName}: ${e.message}")
            emptySet()
        }
    }

    /**
     * Register the services. addService failures are surfaced in the pill
     * (previously they only went to logcat, which the user cannot see);
     * retries with backoff until the HID service is verifiably present.
     */
    private fun registerServices(retries: Int = 0) {
        val server = gattServer ?: return
        val present = registeredUuids()
        if (UUID_HID in present && UUID_DEVICE_INFO in present) {
            gattsError = null
            pushStatus()
            return
        }
        // Add only what is missing — never clearServices (observed on this
        // build: clear + re-add drops one of the two services).
        if (UUID_HID !in present) {
            try {
                server.addService(buildHidService())
            } catch (e: Exception) {
                gattsError = ("add-hid " + e.javaClass.simpleName +
                    (e.message?.let { ": " + it } ?: "")).replace("\"", "'").take(80)
                Log.w("DeskPadHID", "addService(HID) threw: $gattsError")
                pushStatus()
                return
            }
        }
        if (UUID_DEVICE_INFO !in present) {
            try {
                server.addService(buildDeviceInfoService())
            } catch (e: Exception) {
                Log.w("DeskPadHID", "addService(DeviceInfo) threw: ${e.message}")
            }
        }
        val presentNow = registeredUuids()
        if (UUID_HID in presentNow) {
            gattsError = null
            Log.d("DeskPadHID", "HID service present (retry $retries)")
        } else if (retries < 8) {
            gattsError = "re-registering($retries)"
            Log.w("DeskPadHID", "HID not registered after addService (retry $retries; ${presentNow.size} svc)")
            handler.postDelayed({ registerServices(retries + 1) }, 1500)
        } else {
            gattsError = "services-not-registered"
            Log.w("DeskPadHID", "HID never registered after 8 retries")
        }
        pushStatus()
    }

    private fun buildHidService(): BluetoothGattService {
        val permRead = BluetoothGattCharacteristic.PERMISSION_READ
        val permWrite = BluetoothGattCharacteristic.PERMISSION_WRITE
        val propRead = BluetoothGattCharacteristic.PROPERTY_READ
        val propWrite = BluetoothGattCharacteristic.PROPERTY_WRITE
        val propNotify = BluetoothGattCharacteristic.PROPERTY_NOTIFY

        val hid = BluetoothGattService(UUID_HID, BluetoothGattService.SERVICE_TYPE_PRIMARY)

        // CRITICAL: the BluetoothGattCharacteristic constructor is
        // (uuid, PROPERTIES, PERMISSIONS) — properties FIRST. An earlier
        // build passed them swapped, which put permission bits into the
        // properties mask (0x0006 = an invalid property combination) and
        // the stack silently refused the entire HID service while the
        // read-only Device Info service (swap invisible) registered fine.
        // HID information: bcdHID 1.11, country 0x00, flags 0x00 (no virtual cable)
        hid.addCharacteristic(char(
            UUID_HID_INFO, propRead, permRead, byteArrayOf(0x11, 0x01, 0x00, 0x00)
        ))
        // Report map: composite keyboard + consumer + mouse
        hid.addCharacteristic(char(
            UUID_REPORT_MAP, propRead, permRead, ReportMap.BYTES
        ))
        // Protocol mode: 1 = consumer-initiated (reports carry report IDs)
        hid.addCharacteristic(char(
            UUID_PROTOCOL_MODE,
            propRead or propWrite,
            permRead or permWrite,
            byteArrayOf(0x01)
        ))
        // Input report (NOTIFY) — the reports we send to the host.
        // Carries a valid all-zero keyboard report so a read never
        // sees a null value (some Android versions mishandle that).
        val input = char(
            UUID_INPUT_REPORT,
            propRead or propNotify,
            permRead,
            keyboard(0)
        )
        input.addDescriptor(BluetoothGattDescriptor(UUID_CCCD, permWrite))
        inputCharacteristic = input
        hid.addCharacteristic(input)
        return hid
    }

    private fun buildDeviceInfoService(): BluetoothGattService {
        val deviceInfo = BluetoothGattService(UUID_DEVICE_INFO, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        // PnP ID LTV: len 0x0C, vendor source 0x02, vendor 0x1234, product 0x0001,
        // version 0x0100, sub-type 1, sub-id 1, sub-ver 1
        deviceInfo.addCharacteristic(char(
            UUID_PNP,
            BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ,
            byteArrayOf(0x0C, 0x02, 0x34, 0x12, 0x01, 0x00, 0x00, 0x01, 0x01, 0x01, 0x01)
        ))
        return deviceInfo
    }

    private fun char(
        uuid: UUID,
        properties: Int,
        permissions: Int,
        value: ByteArray
    ): BluetoothGattCharacteristic {
        // Constructor order is (uuid, PROPERTIES, PERMISSIONS).
        val c = BluetoothGattCharacteristic(uuid, properties, permissions)
        if (value.isNotEmpty()) c.value = value
        return c
    }

    // ------------------------------------------------------------------
    // Advertising
    // ------------------------------------------------------------------

    private fun startAdvertising() {
        val adv = advertiser
        if (adv == null) {
            advError = "no-advertiser"
            pushStatus()
            return
        }
        handler.post {
            if (advertising) return@post
            // Clear zombie state before starting: force-killed instances
            // can leave the stack's advertiser slot occupied, which makes
            // the next startAdvertising fail with ALREADY_STARTED /
            // TOO_MANY_ADVERTISERS. A stop first is a no-op when we are
            // not actually advertising.
            try {
                adv.stopAdvertising(advCallback)
            } catch (_: Exception) { }
            advertising = false
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
            } catch (e: Exception) {
                // A THROWN startAdvertising (denied runtime permission on
                // API 31+, stack busy) was previously swallowed here and the
                // pad sat idle forever. Surface it and retry, exactly like a
                // callback failure does.
                if (advertising) return@post // "already advertising" — fine.
                Log.w("DeskPadHID", "startAdvertising threw: ${e.javaClass.simpleName}: ${e.message}")
                advError = e.javaClass.simpleName
                pushStatus()
                if (bluetoothOn) {
                    val delay = (1000L * (advRetries + 1)).coerceAtMost(8000L)
                    advRetries++
                    handler.postDelayed({ startAdvertising() }, delay)
                }
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
