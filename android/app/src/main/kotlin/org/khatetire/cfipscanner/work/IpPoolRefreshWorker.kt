package org.khatetire.cfipscanner.work

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.khatetire.cfipscanner.data.IpPoolStore
import org.khatetire.cfipscanner.net.IpQualityProbe
import org.khatetire.cfipscanner.settings.AppSettings
import java.util.concurrent.TimeUnit

/**
 * Periodically re-tests the top entries in the local IP pool ("circle
 * check" in the user's words). Demotes IPs that no longer pass the speed
 * gate so the connect picker always rotates toward the freshest validated
 * edge. Also prunes very stale rows so the table stays small.
 *
 * Constraints mirror [ScheduledScanWorker]: WiFi-only by default, never
 * runs on a low battery.
 */
class IpPoolRefreshWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        return try {
            IpPoolStore.prune(applicationContext)
            val due = IpPoolStore.stalest(applicationContext, limit = REFRESH_BATCH)
            if (due.isEmpty()) {
                Log.i(TAG, "no stale entries to refresh")
                return Result.success()
            }
            var refreshed = 0
            var failed = 0
            for (entry in due) {
                val q = runCatching { IpQualityProbe.probe(entry.ip) }.getOrNull()
                if (q != null && q.ok && q.downloadMbps > 0.0 && q.uploadMbps > 0.0) {
                    IpPoolStore.record(
                        ctx = applicationContext,
                        ip = entry.ip,
                        port = entry.port,
                        q = q,
                        isp = entry.isp,
                        cc = entry.cc,
                    )
                    refreshed++
                } else {
                    IpPoolStore.recordFailure(applicationContext, entry.ip)
                    failed++
                }
            }
            Log.i(TAG, "circle check: refreshed=$refreshed failed=$failed of ${due.size}")
            Result.success()
        } catch (t: Throwable) {
            Log.w(TAG, "circle check failed: ${t.message}")
            Result.retry()
        }
    }

    companion object {
        private const val TAG = "IpPoolRefresh"
        private const val REFRESH_BATCH = 10
    }
}

object IpPoolRefreshScheduler {

    private const val UNIQUE = "ip_pool_circle_check"

    fun apply(ctx: Context) {
        val wm = WorkManager.getInstance(ctx.applicationContext)
        // The circle check is gated on the same `scheduledScans` user toggle
        // as ScheduledScanWorker — a single setting controls all background
        // scanning to keep the surface area small.
        if (!AppSettings.current().scheduledScans) {
            wm.cancelUniqueWork(UNIQUE)
            return
        }
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(
                if (AppSettings.current().scanWifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED
            )
            .setRequiresCharging(AppSettings.current().scanChargingOnly)
            .setRequiresBatteryNotLow(true)
            .build()
        // 30 minutes is the platform minimum for periodic work; matches
        // IpPoolStore.REPROBE_AFTER_MS so every cycle finds something to do.
        val req = PeriodicWorkRequestBuilder<IpPoolRefreshWorker>(30, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()
        wm.enqueueUniquePeriodicWork(UNIQUE, ExistingPeriodicWorkPolicy.UPDATE, req)
    }
}
