package org.khatetire.cfipscanner.ui

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.khatetire.cfipscanner.scanner.ScanProfile
import org.khatetire.cfipscanner.scanner.ScanRateController
import org.khatetire.cfipscanner.scanner.ScanSignals

/**
 * Singleton bridge between the (future) background scanner service and the
 * Compose UI. Until Phase 3 wires the real scanner, the UI reads live values
 * from this holder and the holder is updated by [ScanRateController]
 * decisions and (eventually) scanner result callbacks.
 */
object ScanStateHolder {
    private val _state = MutableStateFlow(ScanUiState())
    val state: StateFlow<ScanUiState> = _state.asStateFlow()

    val controller = ScanRateController(initial = ScanSignals(onWifi = true))

    init {
        // Mirror profile changes into the UI snapshot.
        // We cannot collect here without a CoroutineScope; the holder simply
        // exposes the controller's profile flow alongside its own state, and
        // composables combine them in the Scanner screen.
    }

    fun setRunning(running: Boolean) {
        _state.value = _state.value.copy(running = running)
    }

    fun applyProfile(profile: ScanProfile) {
        _state.value = _state.value.copy(profile = profile)
    }

    fun setDbLayer(layer: String, latencyMs: Long) {
        _state.value = _state.value.copy(dbLayer = layer, dbLatencyMs = latencyMs)
    }

    /**
     * Record the outcome of a single DB-layer attempt (L1..L5).
     * If [ok] is true, also marks this layer as the "active" one in
     * [ScanUiState.dbLayer] / [ScanUiState.dbLatencyMs] so the UI badge
     * shows which path actually delivered data.
     */
    fun markDbLayer(tag: String, ok: Boolean, latencyMs: Long) {
        val cur = _state.value
        val newLayers = cur.dbLayers.map {
            if (it.tag == tag) it.copy(
                status = if (ok) DbLayerStatus.OK else DbLayerStatus.FAIL,
                latencyMs = latencyMs,
                lastCheckedAt = System.currentTimeMillis(),
            ) else it
        }
        _state.value = cur.copy(
            dbLayers = newLayers,
            dbLayer = if (ok) tag else cur.dbLayer,
            dbLatencyMs = if (ok) latencyMs else cur.dbLatencyMs,
        )
    }

    fun pushResult(row: ScanResultRow) {
        val cur = _state.value
        val nextRecent = (listOf(row) + cur.recent).take(20)
        val nextClean = if (row.clean) cur.clean + 1 else cur.clean
        val nextBest = when {
            !row.clean -> cur.bestPingMs
            cur.bestPingMs == 0 -> row.pingMs
            else -> minOf(cur.bestPingMs, row.pingMs)
        }
        _state.value = cur.copy(
            tested = cur.tested + 1,
            clean = nextClean,
            bestPingMs = nextBest,
            recent = nextRecent,
        )
    }

    fun reset() { _state.value = ScanUiState() }
}
