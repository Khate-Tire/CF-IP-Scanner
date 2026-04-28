package org.khatetire.cfipscanner.history

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.khatetire.cfipscanner.vpn.VpnStateHolder
import org.khatetire.cfipscanner.vpn.VpnStatus
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * Subscribes to [VpnStateHolder] state transitions and persists one
 * [SessionEntity] per CONNECTED→ended cycle. The active session id is
 * held in memory; on the closing transition the row is finalised with
 * the latest telemetry snapshot.
 *
 * Idempotent: [start] is safe to call multiple times.
 */
object SessionRecorder {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var activeId: Long = -1L
    private var started = false
    private var peakInBps: Long = 0L

    fun start(ctx: Context) {
        if (started) return
        started = true
        val dao = SessionDb.get(ctx).sessions()
        scope.launch {
            VpnStateHolder.status
                .distinctUntilChanged { a, b -> a.state == b.state }
                .collect { s ->
                    when (s.state) {
                        VpnStatus.State.CONNECTED -> if (activeId < 0) {
                            peakInBps = 0L
                            activeId = dao.insert(
                                SessionEntity(
                                    startMs = System.currentTimeMillis(),
                                    cleanIp = s.cleanIp,
                                    slot = s.serverSlot,
                                )
                            )
                        }
                        VpnStatus.State.IDLE,
                        VpnStatus.State.FAILED,
                        VpnStatus.State.DISCONNECTING -> if (activeId >= 0) {
                            val now = VpnStateHolder.status.value
                            dao.finalize(
                                id = activeId,
                                endMs = System.currentTimeMillis(),
                                cleanIp = now.cleanIp.ifBlank { s.cleanIp },
                                bytesIn = now.bytesIn,
                                bytesOut = now.bytesOut,
                                peak = peakInBps,
                                reason = s.state.name,
                            )
                            activeId = -1L
                        }
                        else -> Unit
                    }
                }
        }
        // Track peak download rate for the live session in parallel.
        scope.launch {
            VpnStateHolder.status.collect { s ->
                if (activeId >= 0 && s.rateInBps > peakInBps) peakInBps = s.rateInBps
            }
        }
    }
}
