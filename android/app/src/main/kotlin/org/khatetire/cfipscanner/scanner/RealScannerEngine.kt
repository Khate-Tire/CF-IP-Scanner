package org.khatetire.cfipscanner.scanner

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.khatetire.cfipscanner.data.IpPoolStore
import org.khatetire.cfipscanner.net.DbClient
import org.khatetire.cfipscanner.net.IpQualityProbe
import org.khatetire.cfipscanner.net.IspContext
import org.khatetire.cfipscanner.ui.ScanResultRow
import org.khatetire.cfipscanner.ui.ScanStateHolder
import java.net.InetSocketAddress
import java.net.Socket

/**
 * TCP-connect probe scanner. Pulls candidate IPs from [DbClient] (which
 * walks the 5-layer fallback ladder), then opens a socket to port 443 and
 * records the connect latency. Falls back to [MockScannerEngine] when
 * DbClient returns nothing (no DB configured + no cache).
 *
 * Honors [ScanProfile] parallelism + interval between batches.
 */
object RealScannerEngine {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null

    private const val PROBE_PORT = 443
    private const val CONNECT_TIMEOUT_MS = 2000L
    // Cheap TCP-handshake gate. Kept aligned with the quality probe's
    // upper ping bound (400ms): anything that handshakes within this
    // window is worth upgrading to a full quality measurement, anything
    // slower would have failed the quality probe anyway. The previous
    // 200ms gate was rejecting perfectly-good edges on jittery mobile
    // networks where one out of every ~5 handshakes spikes briefly.
    private const val CLEAN_THRESHOLD_MS = 400

    fun start(ctx: Context) {
        if (job?.isActive == true) return
        ScanStateHolder.applyProfile(ScanProfile.NORMAL)
        job = scope.launch {
            // Track the most recent batch of IPs so we can detect when the
            // per-ISP DB is exhausted (returns identical picks). When it is,
            // we switch to shard mode and contribute fresh coverage.
            var lastBatchSig: String = ""
            var staleCount = 0
            // Cache the DB pick for 30s so MAXIMUM (200ms loop) doesn't
            // re-race the 5-layer ladder on every iteration. The ladder
            // typically takes 100-500ms when L1 wins; under load it can
            // hit 8s and starve the actual scan probes.
            var cachedPicks: DbClient.Picks? = null
            var cachedAtMs = 0L
            val PICK_CACHE_MS = 30_000L
            while (isActive) {
                val profile = ScanStateHolder.state.value.profile
                if (profile == ScanProfile.PAUSED) {
                    delay(500); continue
                }
                val info = runCatching { IspContext.current() }.getOrDefault(IspContext.Info())
                val now = System.currentTimeMillis()
                val picks = if (cachedPicks != null && (now - cachedAtMs) < PICK_CACHE_MS) {
                    cachedPicks!!
                } else {
                    val fresh = DbClient.bestIps(ctx, limit = 30)
                    cachedPicks = fresh; cachedAtMs = now
                    ScanStateHolder.setDbLayer(fresh.layer.tag, fresh.latencyMs)
                    fresh
                }
                val sig = picks.rawIps.sorted().joinToString(",")
                val sameAsLast = sig == lastBatchSig && sig.isNotEmpty()
                staleCount = if (sameAsLast) staleCount + 1 else 0
                lastBatchSig = sig

                // Always include user custom IPs first (highest priority).
                val customIps = org.khatetire.cfipscanner.scanner.CustomIpRangeParser
                    .parse(org.khatetire.cfipscanner.settings.AppSettings.current().customIpRanges)

                val useShard = picks.ips.isEmpty() && customIps.isEmpty() || staleCount >= 2
                if (useShard) {
                    runShardCycle(ctx, profile, info)
                } else {
                    // Merge: custom IPs first, then DB picks, then top-up with
                    // gold-domain-resolved IPs when DB list is short.
                    val merged = LinkedHashSet<String>()
                    customIps.forEach { merged.add(it) }
                    picks.rawIps.forEach { merged.add(it) }
                    if (merged.size < 20) {
                        val gold = runCatching { GoldDomains.ips(ctx) }.getOrDefault(emptyList())
                        gold.take(30 - merged.size).forEach { merged.add(it) }
                    }
                    runDbCycle(ctx, profile, info, merged.toList())
                }
                val intervalMs = profile.interval.inWholeMilliseconds
                if (intervalMs > 0 && intervalMs != Long.MAX_VALUE) delay(intervalMs)
            }
        }
    }

    /** Probe a batch of DB-supplied IPs and contribute results back. */
    private suspend fun runDbCycle(
        ctx: Context, profile: ScanProfile, info: IspContext.Info, ips: List<String>,
    ) {
        val parallelism = profile.parallelism.coerceAtLeast(1)
        // Full-quality probe (HTTP ping/jitter + small download/upload + colo)
        // is gated to WiFi only — on mobile data we fall back to TCP-only.
        val onWifi = ScanStateHolder.controller.signals.value.onWifi
        val results = probeAll(ctx, ips, parallelism, fullQuality = onWifi)
        contribute(ctx, info, results)
    }

    /** Claim a /24 from the worker, scan all 256 IPs, contribute results,
     *  release the lease. If no shard is available we just sleep briefly
     *  and let the outer loop retry — the loop never exits. */
    private suspend fun runShardCycle(
        ctx: Context, profile: ScanProfile, info: IspContext.Info,
    ) {
        val claim = DbClient.claimShard(ctx)
        if (claim == null) {
            ScanStateHolder.setDbLayer("SHARD_WAIT", 0)
            delay(60_000); return
        }
        ScanStateHolder.setDbLayer("SHARD ${claim.shard}", 0)
        val ips = expandSlash24(claim.shard)
        val parallelism = profile.parallelism.coerceAtLeast(1)
        // Shard cycle = 256 IPs, never run full-quality (would burn ~150MB).
        val results = probeAll(ctx, ips, parallelism, fullQuality = false)
        val okCount = results.count { it.second.clean }
        contribute(ctx, info, results)
        runCatching { DbClient.completeShard(ctx, claim.shard, okCount, results.size) }
    }

    private suspend fun probeAll(
        ctx: Context, ips: List<String>, parallelism: Int, fullQuality: Boolean,
    ): List<Triple<String, ScanResultRow, IpQualityProbe.Quality?>> = coroutineScope {
        // Bug fix (v2.3.1): the previous implementation chunked by [parallelism]
        // and ran each chunk SERIALLY via awaitAll(). Each chunk waited for
        // its slowest probe (often the full 2s timeout) before the next chunk
        // started, capping throughput at ~6 IPs/s for parallelism=12. We now
        // launch ALL probes concurrently, gated by a semaphore, so the loop
        // runs at the configured parallelism continuously without per-chunk
        // straggler stalls.
        val sem = kotlinx.coroutines.sync.Semaphore(parallelism.coerceAtLeast(1))
        val deferreds = ips.map { ip ->
            async {
                sem.acquire()
                try { probeOne(ctx, ip, fullQuality) }
                finally { sem.release() }
            }
        }
        val out = ArrayList<Triple<String, ScanResultRow, IpQualityProbe.Quality?>>(ips.size)
        for (d in deferreds) {
            if (!isActive) break
            val triple = d.await()
            ScanStateHolder.pushResult(triple.second)
            out += triple
        }
        out
    }

    private suspend fun probeOne(
        ctx: Context, ip: String, fullQuality: Boolean,
    ): Triple<String, ScanResultRow, IpQualityProbe.Quality?> {
        // Always do the cheap TCP-connect first to filter dead IPs fast.
        val tcp = probe(ctx, ip)
        if (!fullQuality || !tcp.clean) {
            // TCP-only path. Demote `clean` for the user-visible badge so we
            // never show a ping-only IP as a working one — the user explicitly
            // asked for this. The IP can still be contributed (status="fail")
            // so the worker knows we tried.
            return Triple(ip, tcp.copy(clean = false), null)
        }
        // Upgrade to full HTTP quality probe (ping/jitter/dl/ul/colo).
        val q = runCatching { IpQualityProbe.probe(ip, ctx) }.getOrNull()
        if (q == null || !q.ok) {
            return Triple(ip, tcp.copy(clean = false), q)
        }
        // STRICT clean filter: only call an IP "clean" if the speed test
        // actually moved bytes in BOTH directions. A box that answers ping
        // but won't pass traffic is exactly the failure mode the user hit.
        val passedSpeed = q.downloadMbps > 0.0 && q.uploadMbps > 0.0
        val upgradedRow = tcp.copy(
            pingMs = q.pingMs,
            clean = passedSpeed && q.pingMs in 1..400,
            jitterMs = q.jitterMs,
            downloadMbps = q.downloadMbps,
            uploadMbps = q.uploadMbps,
            datacenter = q.datacenter,
        )
        return Triple(ip, upgradedRow, q)
    }

    private suspend fun contribute(
        ctx: Context, info: IspContext.Info,
        results: List<Triple<String, ScanResultRow, IpQualityProbe.Quality?>>,
    ) {
        if (results.isEmpty()) return
        runCatching {
            // Persist quality-verified IPs to the local pool BEFORE we even
            // try to talk to the worker — the local pool is the user's main
            // safety net when L1..L3 of the DB ladder are blocked.
            results.forEach { (ip, _, q) ->
                if (q != null && q.ok && q.downloadMbps > 0.0 && q.uploadMbps > 0.0) {
                    runCatching {
                        IpPoolStore.record(ctx, ip, PROBE_PORT, q, info.isp, info.country)
                    }
                }
            }
            val payload = results.map { (ip, row, q) ->
                // "ok" for the community ONLY if speed test actually passed.
                // A TCP-only or ping-only result is reported as "fail" so a
                // bad IP can never be promoted by partial data.
                val passedSpeed = q != null && q.ok &&
                    q.downloadMbps > 0.0 && q.uploadMbps > 0.0
                buildJsonObject {
                    put("ip", ip)
                    put("port", PROBE_PORT)
                    put("ping", q?.pingMs ?: row.pingMs)
                    put("status", if (passedSpeed) "ok" else "fail")
                    if (q != null && q.ok) {
                        put("jitter", q.jitterMs)
                        put("download", q.downloadMbps)
                        put("upload", q.uploadMbps)
                        if (q.datacenter.isNotBlank()) put("datacenter", q.datacenter)
                    }
                }
            }
            DbClient.submitScanResultsBatch(
                ctx = ctx,
                cc = info.country,
                isp = info.isp,
                appVersion = "0.1.0",
                results = payload,
            )
        }
    }

    /** "1.2.3.0/24" -> List of 256 dotted-quad strings. */
    private fun expandSlash24(cidr: String): List<String> {
        val base = cidr.substringBefore('/')
        val parts = base.split('.')
        if (parts.size != 4) return emptyList()
        val (a, b, c) = Triple(parts[0], parts[1], parts[2])
        return (0..255).map { "$a.$b.$c.$it" }
    }

    fun stop() {
        job?.cancel(); job = null
        MockScannerEngine.stop()
        ScanStateHolder.applyProfile(ScanProfile.PAUSED)
    }

    private suspend fun probe(ctx: Context, ip: String): ScanResultRow {
        val started = System.nanoTime()
        val ok = withTimeoutOrNull(CONNECT_TIMEOUT_MS) {
            runCatching {
                val underlying = org.khatetire.cfipscanner.vpn.SystemVpnDetector.underlyingNetwork(ctx)
                val socket = underlying?.socketFactory?.createSocket() ?: java.net.Socket()
                socket.use { s ->
                    s.connect(InetSocketAddress(ip, PROBE_PORT), CONNECT_TIMEOUT_MS.toInt())
                    s.isConnected
                }
            }.getOrDefault(false)
        } ?: false
        val ms = ((System.nanoTime() - started) / 1_000_000).toInt()
        return ScanResultRow(
            redactedIp = redact(ip),
            pingMs = if (ok) ms else -1,
            clean = ok && ms <= CLEAN_THRESHOLD_MS,
            timestampMs = System.currentTimeMillis(),
            fullIp = ip,
        )
    }

    /** Drop the last two octets so logs/UI never display full edge addresses. */
    private fun redact(ip: String): String {
        val parts = ip.split('.')
        return if (parts.size == 4) "${parts[0]}.${parts[1]}.*.*" else "***"
    }
}
