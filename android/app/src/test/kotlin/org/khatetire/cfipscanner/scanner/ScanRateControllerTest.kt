package org.khatetire.cfipscanner.scanner

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Pure-logic tests for [ScanRateController.decide]. No Android, no coroutines.
 */
class ScanRateControllerTest {

    private val base = ScanSignals(
        vpnConnected = false,
        screenOn = true,
        charging = false,
        batteryPct = 80,
        onWifi = true,
        mobileScanAllowed = false,
        deviceHot = false,
        userDisabled = false,
        monthlyCapReached = false,
    )

    @Test fun `disconnected on wifi is MAXIMUM`() {
        assertEquals(ScanProfile.MAXIMUM, ScanRateController.decide(base))
    }

    @Test fun `connected and screen on is MINIMAL`() {
        assertEquals(
            ScanProfile.MINIMAL,
            ScanRateController.decide(base.copy(vpnConnected = true, screenOn = true)),
        )
    }

    @Test fun `connected idle on battery is NORMAL`() {
        assertEquals(
            ScanProfile.NORMAL,
            ScanRateController.decide(base.copy(vpnConnected = true, screenOn = false)),
        )
    }

    @Test fun `connected idle on charger is BOOST`() {
        assertEquals(
            ScanProfile.BOOST,
            ScanRateController.decide(
                base.copy(vpnConnected = true, screenOn = false, charging = true)
            ),
        )
    }

    @Test fun `low battery off charger is PAUSED`() {
        assertEquals(
            ScanProfile.PAUSED,
            ScanRateController.decide(base.copy(batteryPct = 15, charging = false)),
        )
    }

    @Test fun `hot device is PAUSED`() {
        assertEquals(ScanProfile.PAUSED, ScanRateController.decide(base.copy(deviceHot = true)))
    }

    @Test fun `user disabled overrides everything`() {
        assertEquals(
            ScanProfile.PAUSED,
            ScanRateController.decide(base.copy(userDisabled = true, vpnConnected = false)),
        )
    }

    @Test fun `mobile-only without permission is PAUSED`() {
        assertEquals(
            ScanProfile.PAUSED,
            ScanRateController.decide(base.copy(onWifi = false, mobileScanAllowed = false)),
        )
    }

    @Test fun `mobile-only with permission allows scanning`() {
        assertEquals(
            ScanProfile.MAXIMUM,
            ScanRateController.decide(base.copy(onWifi = false, mobileScanAllowed = true)),
        )
    }

    @Test fun `monthly cap reached is PAUSED`() {
        assertEquals(
            ScanProfile.PAUSED,
            ScanRateController.decide(base.copy(monthlyCapReached = true)),
        )
    }
}
