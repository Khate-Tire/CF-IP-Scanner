package org.khatetire.cfipscanner.scanner

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Pure state-machine that maps current device + connection [ScanSignals] to a
 * [ScanProfile]. Designed for **deterministic, unit-testable** behaviour — no
 * Android imports, no coroutines beyond a [StateFlow] holder.
 *
 * Decision priority (top wins):
 *  1. Hard stops      → PAUSED
 *  2. No usable net   → PAUSED
 *  3. Disconnected    → MAXIMUM (find an IP fast)
 *  4. Connected + screen on (foreground use) → MINIMAL
 *  5. Connected + idle + charging → BOOST
 *  6. Connected + idle (battery) → NORMAL
 *
 * Hysteresis: callers should debounce `screenOn` flips with a short timer
 * (e.g., 5 s) to avoid thrashing when the user briefly checks the screen.
 */
class ScanRateController(initial: ScanSignals = ScanSignals()) {

    private val _signals = MutableStateFlow(initial)
    val signals: StateFlow<ScanSignals> = _signals.asStateFlow()

    private val _profile = MutableStateFlow(decide(initial))
    val profile: StateFlow<ScanProfile> = _profile.asStateFlow()

    fun update(transform: (ScanSignals) -> ScanSignals) {
        val next = transform(_signals.value)
        _signals.value = next
        _profile.value = decide(next)
    }

    fun setVpnConnected(connected: Boolean) = update { it.copy(vpnConnected = connected) }
    fun setScreenOn(on: Boolean) = update { it.copy(screenOn = on) }
    fun setCharging(charging: Boolean) = update { it.copy(charging = charging) }
    fun setBattery(pct: Int) = update { it.copy(batteryPct = pct.coerceIn(0, 100)) }
    fun setOnWifi(wifi: Boolean) = update { it.copy(onWifi = wifi) }
    fun setMobileAllowed(allowed: Boolean) = update { it.copy(mobileScanAllowed = allowed) }
    fun setHot(hot: Boolean) = update { it.copy(deviceHot = hot) }
    fun setUserDisabled(disabled: Boolean) = update { it.copy(userDisabled = disabled) }
    fun setCapReached(reached: Boolean) = update { it.copy(monthlyCapReached = reached) }

    companion object {
        /** Pure function — easy to unit-test. */
        fun decide(s: ScanSignals): ScanProfile {
            // 1. Hard stops.
            if (s.userDisabled || s.monthlyCapReached || s.deviceHot) return ScanProfile.PAUSED
            if (!s.charging && s.batteryPct < 20) return ScanProfile.PAUSED

            // 2. No usable network for scanning.
            val haveScanNet = s.onWifi || s.mobileScanAllowed
            if (!haveScanNet) return ScanProfile.PAUSED

            // 3. Pre-connect: race to find a clean IP.
            if (!s.vpnConnected) return ScanProfile.MAXIMUM

            // 4. User actively using the phone — stay quiet.
            if (s.screenOn) return ScanProfile.MINIMAL

            // 5. Idle + plugged in.
            if (s.charging) return ScanProfile.BOOST

            // 6. Idle on battery.
            return ScanProfile.NORMAL
        }
    }
}
