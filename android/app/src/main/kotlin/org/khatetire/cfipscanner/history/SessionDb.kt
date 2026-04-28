package org.khatetire.cfipscanner.history

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import android.content.Context
import kotlinx.coroutines.flow.Flow

/**
 * One row per VPN session. [endMs] is null while the session is live; it is
 * filled in when the service transitions out of CONNECTED. Telemetry fields
 * snapshot the final values at disconnect time.
 */
@Entity(tableName = "sessions")
data class SessionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0L,
    @ColumnInfo(name = "start_ms") val startMs: Long,
    @ColumnInfo(name = "end_ms")   val endMs: Long? = null,
    @ColumnInfo(name = "clean_ip") val cleanIp: String = "",
    @ColumnInfo(name = "slot")     val slot: String = "",
    @ColumnInfo(name = "bytes_in") val bytesIn: Long = 0L,
    @ColumnInfo(name = "bytes_out") val bytesOut: Long = 0L,
    @ColumnInfo(name = "peak_in_bps") val peakInBps: Long = 0L,
    @ColumnInfo(name = "reason")   val reason: String = "",
)

@Dao
interface SessionDao {
    @Insert
    suspend fun insert(s: SessionEntity): Long

    @Query("UPDATE sessions SET end_ms = :endMs, clean_ip = :cleanIp, " +
        "bytes_in = :bytesIn, bytes_out = :bytesOut, peak_in_bps = :peak, " +
        "reason = :reason WHERE id = :id")
    suspend fun finalize(
        id: Long, endMs: Long, cleanIp: String,
        bytesIn: Long, bytesOut: Long, peak: Long, reason: String,
    )

    @Query("SELECT * FROM sessions ORDER BY start_ms DESC LIMIT 200")
    fun recent(): Flow<List<SessionEntity>>

    @Query("DELETE FROM sessions")
    suspend fun clear()
}

@Database(entities = [SessionEntity::class], version = 1, exportSchema = false)
abstract class SessionDb : RoomDatabase() {
    abstract fun sessions(): SessionDao

    companion object {
        @Volatile private var instance: SessionDb? = null

        fun get(ctx: Context): SessionDb = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                ctx.applicationContext, SessionDb::class.java, "session_history.db"
            ).build().also { instance = it }
        }
    }
}
