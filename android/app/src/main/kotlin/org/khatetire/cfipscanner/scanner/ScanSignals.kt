package org.khatetire.cfipscanner.scanner

/**
 * Live device + connection signals consumed by [ScanRateController]. Updated
 * by broadcast receivers (screen on/off), battery manager, ConnectivityManager,
 * and the VPN service.
 *
 * Defaults represent a "fresh launch, conservative assumption" baseline.
 */
data class ScanSignals(
    val vpnConnected: Boolean = false,
    val screenOn: Boolean = true,
    val charging: Boolean = false,
    val batteryPct: Int = 100,
    val onWifi: Boolean = false,
    val mobileScanAllowed: Boolean = false,
    val deviceHot: Boolean = false,
    val userDisabled: Boolean = false,
    val monthlyCapReached: Boolean = false,
)
