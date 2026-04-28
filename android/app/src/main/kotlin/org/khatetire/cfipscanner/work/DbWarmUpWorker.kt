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
import org.khatetire.cfipscanner.net.DbClient
import java.util.concurrent.TimeUnit

/**
 * Periodic background warm-up of the DB fallback ladder. Calls
 * [DbClient.bestIps] every ~15 minutes (the Android `PeriodicWorkRequest`
 * minimum) so that:
 *
 *   * the L7 [org.khatetire.cfipscanner.net.DbCache] snapshot stays fresh
 *     (this is the "local backup" of the community DB), and
 *   * the per-layer health badge in the UI reflects current reality before
 *     the user even opens the scanner.
 *
 * Constraints intentionally permissive (`NetworkType.CONNECTED`, no
 * charging requirement): this is a read-only call that costs ~5 KB and is
 * essential for the always-on connectivity guarantee.
 */
class DbWarmUpWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        return try {
            val picks = DbClient.bestIps(applicationContext, limit = 50)
            Log.i(TAG, "warm-up via ${picks.layer.tag} -> ${picks.ips.size} ips")
            // We never fail the worker — a transient failure should not be
            // logged as a WorkManager error; the next cycle will retry on
            // its own schedule.
            Result.success()
        } catch (t: Throwable) {
            Log.w(TAG, "warm-up failed: ${t.message}")
            Result.success()
        }
    }

    companion object {
        private const val TAG = "DbWarmUp"
    }
}

object DbWarmUpScheduler {
    private const val UNIQUE = "db_warm_up"

    fun apply(ctx: Context) {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val req = PeriodicWorkRequestBuilder<DbWarmUpWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(ctx.applicationContext)
            .enqueueUniquePeriodicWork(UNIQUE, ExistingPeriodicWorkPolicy.KEEP, req)
    }
}
