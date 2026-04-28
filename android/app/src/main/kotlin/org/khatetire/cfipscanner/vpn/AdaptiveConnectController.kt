package org.khatetire.cfipscanner.vpn

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import org.khatetire.cfipscanner.bootstrap.BootstrapLoader
import org.khatetire.cfipscanner.model.VlessConfig
import org.khatetire.cfipscanner.net.DbClient
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.coroutines.coroutineContext

/**
 * Picks the best edge IP at connect time and continuously hunts for a
 * faster one in the background. Uses a TCP-443 RTT probe (cheap, ~5KB)
 * since the VPN service is excluded from its own tunnel — direct probes
 * accurately reflect what the user would see if we hot-swapped to that IP.
 *
 * Win condition for a hot-swap: candidate median RTT must beat current
 * median RTT by at least [SWAP_DELTA_MS] for [SWAP_CONSECUTIVE_WINS]
 * consecutive probe cycles. This avoids flapping on noisy mobile networks.
 */
object AdaptiveConnectController {

    private const val TAG = "AdaptiveConnect"
    private const val PROBE_PORT = 443
    private const val PROBE_TIMEOUT_MS = 1500
    private const val PROBE_TARGETS = 5
    private const val PROBE_REPEATS = 3
    private const val PROBE_INTERVAL_MS = 30_000L
    private const val SWAP_DELTA_MS = 25
    private const val SWAP_CONSECUTIVE_WINS = 2

    /**
     * Returns a [VlessConfig] whose `host` is the lowest-RTT candidate
     * that successfully completed a TCP-443 handshake. Falls back to the
     * bootstrap entry as-is if no candidate is reachable.
     */
    suspend fun bestNow(ctx: Context, slot: Int): VlessConfig? = withContext(Dispatchers.IO) {
        val bootstrap = BootstrapLoader.load(ctx)
        if (bootstrap.isEmpty()) {
            Log.w(TAG, "bootstrap empty — cannot pick config")
            return@withContext null
        }
        val effectiveSlot = slot.coerceIn(0, bootstrap.lastIndex)
        val base = bootstrap[effectiveSlot]

        val picks = runCatching { DbClient.bestIps(ctx, limit = PROBE_TARGETS) }.getOrNull()
        val candidates = picks?.rawIps?.take(PROBE_TARGETS).orEmpty()
        if (candidates.isEmpty()) {
            Log.i(TAG, "no DB candidates — using bootstrap host as-is")
            return@withContext base
        }
        val ranked = rankByRtt(candidates)
        val best = ranked.firstOrNull { it.second != Int.MAX_VALUE }?.first
        if (best == null) {
            Log.w(TAG, "all candidates unreachable — using bootstrap host")
            return@withContext base
        }
        Log.i(TAG, "pick=$best rtt=${ranked.first().second}ms (from ${candidates.size} candidates)")
        base.copy(host = best)
    }

    /**
     * Long-running probe loop. Reports [onSwap] when a candidate beats the
     * current host by [SWAP_DELTA_MS] for [SWAP_CONSECUTIVE_WINS] cycles.
     * Caller is responsible for performing the actual swap (Xray restart).
     */
    suspend fun improvementLoop(
        ctx: Context,
        currentRef: () -> VlessConfig?,
        onSwap: suspend (VlessConfig) -> Unit,
    ) {
        var winsByIp = mutableMapOf<String, Int>()
        while (coroutineContext.isActive) {
            delay(PROBE_INTERVAL_MS)
            val current = currentRef() ?: continue
            val picks = runCatching { DbClient.bestIps(ctx, limit = PROBE_TARGETS) }.getOrNull()
            val candidates = picks?.rawIps?.filter { it != current.host }?.take(PROBE_TARGETS).orEmpty()
            if (candidates.isEmpty()) continue

            val curRtt = medianRtt(current.host)
            val ranked = rankByRtt(candidates)
            val (bestIp, bestRtt) = ranked.first()
            if (curRtt == Int.MAX_VALUE || bestRtt == Int.MAX_VALUE) {
                winsByIp.clear(); continue
            }

            if (bestRtt + SWAP_DELTA_MS < curRtt) {
                val w = (winsByIp[bestIp] ?: 0) + 1
                winsByIp = mutableMapOf(bestIp to w) // reset others
                Log.i(TAG, "candidate $bestIp rtt=$bestRtt vs cur=$curRtt (win $w/$SWAP_CONSECUTIVE_WINS)")
                if (w >= SWAP_CONSECUTIVE_WINS) {
                    Log.i(TAG, "hot-swap: $current.host -> $bestIp")
                    onSwap(current.copy(host = bestIp))
                    winsByIp.clear()
                }
            } else {
                winsByIp.clear()
            }
        }
    }

    private suspend fun rankByRtt(ips: List<String>): List<Pair<String, Int>> = coroutineScope {
        ips.map { ip -> async(Dispatchers.IO) { ip to medianRtt(ip) } }
            .map { it.await() }
            .sortedBy { it.second }
    }

    private fun medianRtt(ip: String): Int {
        val samples = IntArray(PROBE_REPEATS) { tcpRttMs(ip) }
        val good = samples.filter { it != Int.MAX_VALUE }.sorted()
        if (good.isEmpty()) return Int.MAX_VALUE
        return good[good.size / 2]
    }

    private fun tcpRttMs(ip: String): Int {
        val s = Socket()
        return try {
            val started = System.nanoTime()
            s.connect(InetSocketAddress(ip, PROBE_PORT), PROBE_TIMEOUT_MS)
            ((System.nanoTime() - started) / 1_000_000).toInt()
        } catch (_: Throwable) {
            Int.MAX_VALUE
        } finally {
            try { s.close() } catch (_: Throwable) {}
        }
    }
}
