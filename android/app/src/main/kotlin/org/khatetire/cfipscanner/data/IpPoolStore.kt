package org.khatetire.cfipscanner.data

import android.content.Context
import android.util.Log
import org.khatetire.cfipscanner.net.IpQualityProbe

/**
 * Domain wrapper around [IpPoolDb] used by the scanner engine, the connect
 * picker and the periodic "circle check" worker. All entry points are
 * suspending so callers can stay on `Dispatchers.IO`.
 *
 * The pool is intentionally append-only with upsert merging: each new probe
 * for an IP rolls its rolling stats forward (sample count, ok count, score)
 * so a flaky IP slowly demotes itself without us needing a separate aging
 * table.
 */
object IpPoolStore {

    private const val TAG = "IpPoolStore"

    /** Pool entries older than this are not eligible for "best IP" picking. */
    const val FRESH_WINDOW_MS = 24L * 60 * 60 * 1000L

    /** The periodic refresh worker re-probes entries older than this. */
    const val REPROBE_AFTER_MS = 30L * 60 * 1000L

    /** Hard retention — anything older is pruned to keep the table small. */
    const val PRUNE_AFTER_MS = 7L * 24 * 60 * 60 * 1000L

    /** Cap pool size; pruning + the natural `top N` queries handle the rest. */
    const val MAX_POOL_SIZE = 200

    /**
     * Record one quality probe result. Only IPs that actually passed both a
     * download AND upload measurement are stored — this is enforced here so
     * any caller that forgets the filter cannot pollute the pool with
     * "ping-only" rows the user already complained about.
     */
    suspend fun record(
        ctx: Context,
        ip: String,
        port: Int,
        q: IpQualityProbe.Quality,
        isp: String = "",
        cc: String = "",
    ) {
        if (!q.ok) return
        if (q.downloadMbps <= 0.0 || q.uploadMbps <= 0.0) return
        val dao = IpPoolDb.get(ctx).ipPool()
        val now = System.currentTimeMillis()
        val existing = dao.get(ip)
        val samples = (existing?.samples ?: 0) + 1
        val okSamples = (existing?.okSamples ?: 0) + 1
        val merged = IpPoolEntity(
            ip = ip,
            port = port,
            pingMs = blendInt(existing?.pingMs, q.pingMs),
            jitterMs = blendInt(existing?.jitterMs, q.jitterMs),
            downloadMbps = blendDouble(existing?.downloadMbps, q.downloadMbps),
            uploadMbps = blendDouble(existing?.uploadMbps, q.uploadMbps),
            datacenter = q.datacenter.ifBlank { existing?.datacenter.orEmpty() },
            lastSeenMs = now,
            samples = samples,
            okSamples = okSamples,
            score = score(q),
            isp = isp.ifBlank { existing?.isp.orEmpty() },
            cc = cc.ifBlank { existing?.cc.orEmpty() },
        )
        dao.upsert(merged)
    }

    /** Record a re-probe FAILURE — we keep the row but bump samples and
     *  decay its score so the next pick prefers a fresher candidate. */
    suspend fun recordFailure(ctx: Context, ip: String) {
        val dao = IpPoolDb.get(ctx).ipPool()
        val existing = dao.get(ip) ?: return
        val samples = existing.samples + 1
        val decayed = (existing.score * 0.6).coerceAtLeast(0.0)
        dao.upsert(
            existing.copy(
                samples = samples,
                score = decayed,
                lastSeenMs = System.currentTimeMillis(),
            )
        )
    }

    /** Best-known IP for the connect picker, or null if the pool is empty
     *  or its freshest row is older than [FRESH_WINDOW_MS]. */
    suspend fun bestIp(ctx: Context): String? {
        val now = System.currentTimeMillis()
        val rows = IpPoolDb.get(ctx).ipPool().top(limit = 1, freshAfterMs = now - FRESH_WINDOW_MS)
        return rows.firstOrNull()?.ip
    }

    /** Top-N IPs ordered by score; used by the connect controller and the
     *  refresh worker. */
    suspend fun top(ctx: Context, limit: Int): List<IpPoolEntity> {
        val now = System.currentTimeMillis()
        return IpPoolDb.get(ctx).ipPool().top(limit, freshAfterMs = now - FRESH_WINDOW_MS)
    }

    /** Entries due for a re-probe (used by the periodic worker). */
    suspend fun stalest(ctx: Context, limit: Int): List<IpPoolEntity> {
        val now = System.currentTimeMillis()
        return IpPoolDb.get(ctx).ipPool().stalest(limit, olderThanMs = now - REPROBE_AFTER_MS)
    }

    /** Reactive count for badges (kept simple for now). */
    suspend fun count(ctx: Context): Int = IpPoolDb.get(ctx).ipPool().count()

    /** Hard prune — drop anything older than [PRUNE_AFTER_MS]. */
    suspend fun prune(ctx: Context) {
        val cutoff = System.currentTimeMillis() - PRUNE_AFTER_MS
        val dropped = IpPoolDb.get(ctx).ipPool().pruneOlderThan(cutoff)
        if (dropped > 0) Log.i(TAG, "pruned $dropped stale entries")
    }

    private fun score(q: IpQualityProbe.Quality): Double {
        if (q.downloadMbps <= 0.0 || q.uploadMbps <= 0.0) return 0.0
        val pingPart = (150.0 - q.pingMs.coerceAtLeast(0)).coerceAtLeast(0.0)
        val jitterPart = q.jitterMs.coerceAtLeast(0) * 0.5
        return q.downloadMbps * 2.0 + q.uploadMbps * 1.5 + pingPart - jitterPart
    }

    /** Exponentially-weighted blend so a one-off bad sample doesn't dominate. */
    private fun blendDouble(prev: Double?, fresh: Double): Double =
        if (prev == null || prev <= 0.0) fresh else (prev * 0.6 + fresh * 0.4)

    private fun blendInt(prev: Int?, fresh: Int): Int =
        if (prev == null || prev <= 0) fresh else (prev * 0.6 + fresh * 0.4).toInt()
}
