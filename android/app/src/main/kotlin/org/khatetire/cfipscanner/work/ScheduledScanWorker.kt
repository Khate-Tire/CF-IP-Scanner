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
import kotlinx.coroutines.withTimeoutOrNull
import org.khatetire.cfipscanner.net.DbClient
import org.khatetire.cfipscanner.settings.AppSettings
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.TimeUnit

/**
 * Periodic background worker that refreshes the on-device clean-IP cache
 * by pulling a small batch from [DbClient] and probing TCP/443 latency.
 * Throttled to WiFi (and optionally charging) so it never burns mobile data.
 *
 * The actual write-back to the DB is handled inside [DbClient.bestIps]'s
 * cache layer, so this worker is intentionally a thin shell — it just keeps
 * the cache warm between user-initiated sessions.
 */
class ScheduledScanWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        return try {
            val picks = DbClient.bestIps(applicationContext, limit = 12)
            val ips = picks.rawIps.take(12)
            var ok = 0
            for (ip in ips) {
                val ms = withTimeoutOrNull(2_000L) { measure(ip) }
                if (ms != null && ms < 250) ok++
            }
            Log.i(TAG, "scheduled scan: ${ips.size} probes, $ok clean")
            Result.success()
        } catch (t: Throwable) {
            Log.w(TAG, "scheduled scan failed: ${t.message}")
            Result.retry()
        }
    }

    private fun measure(ip: String): Long {
        val t0 = System.currentTimeMillis()
        Socket().use { it.connect(InetSocketAddress(ip, 443), 1_500) }
        return System.currentTimeMillis() - t0
    }

    companion object { private const val TAG = "ScheduledScan" }
}

object ScanScheduler {

    private const val UNIQUE = "scheduled_clean_ip_scan"

    fun apply(ctx: Context) {
        val wm = WorkManager.getInstance(ctx.applicationContext)
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
        val req = PeriodicWorkRequestBuilder<ScheduledScanWorker>(6, TimeUnit.HOURS)
            .setConstraints(constraints)
            .build()
        wm.enqueueUniquePeriodicWork(UNIQUE, ExistingPeriodicWorkPolicy.UPDATE, req)
    }
}
