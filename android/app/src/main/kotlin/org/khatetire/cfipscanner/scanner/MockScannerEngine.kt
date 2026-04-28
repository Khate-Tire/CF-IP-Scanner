package org.khatetire.cfipscanner.scanner

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.khatetire.cfipscanner.ui.ScanResultRow
import org.khatetire.cfipscanner.ui.ScanStateHolder
import kotlin.random.Random

/**
 * Mock background scanner that emits plausible [ScanResultRow]s into
 * [ScanStateHolder] while the user toggles "Start scanner". The Phase 3
 * `ScannerForegroundService` will replace this with real probing.
 */
object MockScannerEngine {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var job: Job? = null

    private val cidrs = listOf("104.21", "172.67", "188.114", "162.159", "104.16")

    fun start() {
        if (job?.isActive == true) return
        ScanStateHolder.applyProfile(ScanProfile.NORMAL)
        job = scope.launch {
            while (isActive) {
                val cidr = cidrs.random()
                val row = ScanResultRow(
                    redactedIp = "$cidr.*.*",
                    pingMs = Random.nextInt(20, 320),
                    clean = Random.nextDouble() < 0.4,
                    timestampMs = System.currentTimeMillis(),
                )
                ScanStateHolder.pushResult(row)
                delay(800L + Random.nextLong(0, 600))
            }
        }
    }

    fun stop() {
        job?.cancel(); job = null
        ScanStateHolder.applyProfile(ScanProfile.PAUSED)
    }
}
