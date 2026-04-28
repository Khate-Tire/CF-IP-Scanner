package org.khatetire.cfipscanner.data

import android.content.Context
import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/**
 * One row per Cloudflare edge IP that this device has personally measured
 * with a full quality probe (TCP + ping/jitter + actual down/up speeds).
 *
 * Rows are upserted from [org.khatetire.cfipscanner.scanner.RealScannerEngine]
 * and re-tested periodically by [org.khatetire.cfipscanner.work.IpPoolRefreshWorker]
 * — that is the user-requested "circle check" that keeps the pool fresh so
 * the connect picker can always choose a recently-validated edge.
 *
 * Score formula (higher = better):
 *   download * 2  +  upload * 1.5  +  max(150 - ping, 0)  -  jitter * 0.5
 *
 * Only IPs that passed BOTH download and upload speed checks are inserted —
 * "ping-only" candidates are filtered out at the engine level so they can
 * never appear here.
 */
@Entity(tableName = "ip_pool")
data class IpPoolEntity(
    @PrimaryKey val ip: String,
    @ColumnInfo(name = "port")          val port: Int = 443,
    @ColumnInfo(name = "ping_ms")       val pingMs: Int = 0,
    @ColumnInfo(name = "jitter_ms")     val jitterMs: Int = 0,
    @ColumnInfo(name = "download_mbps") val downloadMbps: Double = 0.0,
    @ColumnInfo(name = "upload_mbps")   val uploadMbps: Double = 0.0,
    @ColumnInfo(name = "datacenter")    val datacenter: String = "",
    @ColumnInfo(name = "last_seen_ms")  val lastSeenMs: Long = 0L,
    @ColumnInfo(name = "samples")       val samples: Int = 0,
    @ColumnInfo(name = "ok_samples")    val okSamples: Int = 0,
    @ColumnInfo(name = "score")         val score: Double = 0.0,
    @ColumnInfo(name = "isp")           val isp: String = "",
    @ColumnInfo(name = "cc")            val cc: String = "",
)

@Dao
interface IpPoolDao {
    @Upsert
    suspend fun upsert(row: IpPoolEntity)

    @Query("SELECT * FROM ip_pool WHERE ip = :ip LIMIT 1")
    suspend fun get(ip: String): IpPoolEntity?

    /** Top-N by score, restricted to entries that have a positive download
     *  and upload (defensive — the writer already guarantees this). */
    @Query("""
        SELECT * FROM ip_pool
        WHERE download_mbps > 0 AND upload_mbps > 0
          AND last_seen_ms > :freshAfterMs
        ORDER BY score DESC, last_seen_ms DESC
        LIMIT :limit
    """)
    suspend fun top(limit: Int, freshAfterMs: Long): List<IpPoolEntity>

    /** Reactive variant for UI badges. */
    @Query("""
        SELECT * FROM ip_pool
        WHERE download_mbps > 0 AND upload_mbps > 0
        ORDER BY score DESC, last_seen_ms DESC
        LIMIT :limit
    """)
    fun topFlow(limit: Int): Flow<List<IpPoolEntity>>

    /** Top-N entries that are due for a re-probe — used by the periodic
     *  "circle check" worker. */
    @Query("""
        SELECT * FROM ip_pool
        WHERE last_seen_ms < :olderThanMs
        ORDER BY score DESC
        LIMIT :limit
    """)
    suspend fun stalest(limit: Int, olderThanMs: Long): List<IpPoolEntity>

    @Query("SELECT COUNT(*) FROM ip_pool")
    suspend fun count(): Int

    @Query("DELETE FROM ip_pool WHERE last_seen_ms < :before")
    suspend fun pruneOlderThan(before: Long): Int

    @Query("DELETE FROM ip_pool")
    suspend fun clear()
}

@Database(entities = [IpPoolEntity::class], version = 1, exportSchema = false)
abstract class IpPoolDb : RoomDatabase() {
    abstract fun ipPool(): IpPoolDao

    companion object {
        @Volatile private var instance: IpPoolDb? = null

        fun get(ctx: Context): IpPoolDb = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                ctx.applicationContext, IpPoolDb::class.java, "ip_pool.db"
            ).build().also { instance = it }
        }
    }
}
