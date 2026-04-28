package org.khatetire.cfipscanner.ui

import org.khatetire.cfipscanner.scanner.ScanProfile
import kotlin.math.max

/** Health of one of the 5 DB-fetch fallback layers (L1..L5). */
enum class DbLayerStatus { UNKNOWN, OK, FAIL }

data class DbLayerHealth(
    val tag: String,                       // "L1" .. "L5"
    val label: String,                     // "Direct" / "Worker" / "Fronted" / "Cache" / "Seed"
    val status: DbLayerStatus = DbLayerStatus.UNKNOWN,
    val latencyMs: Long = 0L,
    val lastCheckedAt: Long = 0L,
)

/**
 * UI-facing snapshot for the Scanner screen. Wired to mock data until the
 * real ScannerForegroundService lands in Phase 3.
 */
data class ScanUiState(
    val profile: ScanProfile = ScanProfile.PAUSED,
    val tested: Long = 0L,
    val clean: Long = 0L,
    val bestPingMs: Int = 0,
    val recent: List<ScanResultRow> = emptyList(),
    val running: Boolean = false,
    /** Last DB fetch layer ("L1".."L5" or "--"). Plumbed in Phase 2. */
    val dbLayer: String = "--",
    /** Round-trip latency of the last DB fetch in ms, 0 if cached / unknown. */
    val dbLatencyMs: Long = 0L,
    /** Per-layer health for the L1..L5 fallback chain. */
    val dbLayers: List<DbLayerHealth> = listOf(
        DbLayerHealth("L1", "Direct"),
        DbLayerHealth("L2", "Worker"),
        DbLayerHealth("L3", "Fronted"),
        DbLayerHealth("L4", "Cache"),
        DbLayerHealth("L5", "Seed"),
    ),
) {
    val cleanPct: Float get() = if (tested == 0L) 0f else (clean.toFloat() / max(1, tested))
    /** How many of the 5 layers responded OK on their most recent attempt. */
    val dbWorkingCount: Int get() = dbLayers.count { it.status == DbLayerStatus.OK }
    /** True when at least one layer (any of L1..L5) is currently OK. */
    val dbConnected: Boolean get() = dbWorkingCount > 0
}

data class ScanResultRow(
    /** Redacted form for display: e.g. "104.21.*.*" */
    val redactedIp: String,
    val pingMs: Int,
    val clean: Boolean,
    val timestampMs: Long,
    /** Full IP, used only for copy-to-clipboard. */
    val fullIp: String = "",
    /** Optional richer metrics (only populated by the HTTP quality probe). */
    val jitterMs: Int = -1,
    val downloadMbps: Double = 0.0,
    val uploadMbps: Double = 0.0,
    val datacenter: String = "",
)
