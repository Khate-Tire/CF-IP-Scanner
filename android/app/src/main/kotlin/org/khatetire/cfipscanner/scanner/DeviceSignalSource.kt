package org.khatetire.cfipscanner.scanner

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.BatteryManager
import android.os.PowerManager

/**
 * Wires a [ScanRateController] to live Android signals: screen on/off, battery
 * level, charging, network type. Call [start] from the scanner foreground
 * service and [stop] when the service is destroyed.
 *
 * Hot/thermal monitoring is a TODO (`PowerManager.getCurrentThermalStatus()`
 * needs API 29+ and a callback registration; tracked for Phase 3.5).
 */
class DeviceSignalSource(
    private val context: Context,
    private val controller: ScanRateController,
) {

    private var receiver: BroadcastReceiver? = null
    private var netCallback: ConnectivityManager.NetworkCallback? = null

    fun start() {
        registerScreenAndBattery()
        registerNetwork()
        // Seed initial values.
        primeBattery()
        primeScreen()
    }

    fun stop() {
        receiver?.let { runCatching { context.unregisterReceiver(it) } }
        receiver = null
        netCallback?.let {
            runCatching { context.getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) }
        }
        netCallback = null
    }

    // -------------------------------------------------------------------------
    // Screen + battery
    // -------------------------------------------------------------------------
    private fun registerScreenAndBattery() {
        val r = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, i: Intent?) {
                when (i?.action) {
                    Intent.ACTION_SCREEN_ON -> controller.setScreenOn(true)
                    Intent.ACTION_SCREEN_OFF -> controller.setScreenOn(false)
                    Intent.ACTION_POWER_CONNECTED -> controller.setCharging(true)
                    Intent.ACTION_POWER_DISCONNECTED -> controller.setCharging(false)
                    Intent.ACTION_BATTERY_CHANGED -> {
                        val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                        val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
                        if (level >= 0 && scale > 0) controller.setBattery(level * 100 / scale)
                        val status = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
                        controller.setCharging(
                            status == BatteryManager.BATTERY_STATUS_CHARGING ||
                                status == BatteryManager.BATTERY_STATUS_FULL
                        )
                    }
                }
            }
        }
        context.registerReceiver(r, IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_POWER_CONNECTED)
            addAction(Intent.ACTION_POWER_DISCONNECTED)
            addAction(Intent.ACTION_BATTERY_CHANGED)
        })
        receiver = r
    }

    private fun primeBattery() {
        val bm = context.getSystemService(BatteryManager::class.java) ?: return
        controller.setBattery(bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
        controller.setCharging(bm.isCharging)
    }

    private fun primeScreen() {
        val pm = context.getSystemService(PowerManager::class.java) ?: return
        controller.setScreenOn(pm.isInteractive)
    }

    // -------------------------------------------------------------------------
    // Network type — listens for the *default* network and reports WiFi vs not.
    // -------------------------------------------------------------------------
    private fun registerNetwork() {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = recheck(cm, network)
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                controller.setOnWifi(caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI))
            }
            override fun onLost(network: Network) = controller.setOnWifi(false)
        }
        val req = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        cm.registerNetworkCallback(req, cb)
        netCallback = cb
    }

    private fun recheck(cm: ConnectivityManager, network: Network) {
        val caps = cm.getNetworkCapabilities(network) ?: return
        controller.setOnWifi(caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI))
    }
}
