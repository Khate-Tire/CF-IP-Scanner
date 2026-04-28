package org.khatetire.cfipscanner.net

import android.content.Context
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.File

/**
 * Rich on-device snapshot of last-known-good IPs (Layer 7 of [DbClient]
 * fallback). Holds the full ranking metadata returned by the worker so an
 * offline session can still rank/sort IPs locally — this file IS the
 * "local backup of the database" that survives extended outages.
 *
 * Stores at most [MAX_ENTRIES] rows and expires after [MAX_AGE_MS]. The
 * legacy "ips" field is still written so older callers keep working.
 */
object DbCache {

    private const val FILE = "antigravity_dbcache.json"
    private const val MAX_ENTRIES = 200
    private const val MAX_AGE_MS = 14L * 24 * 60 * 60 * 1000L // 14 days

    private val json = Json { ignoreUnknownKeys = true }

    fun load(ctx: Context): List<String> = synchronized(this) {
        val f = File(ctx.cacheDir, FILE)
        if (!f.exists()) return emptyList()
        return try {
            val obj = json.parseToJsonElement(f.readText()).jsonObject
            val savedAt = obj["savedAt"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L
            if (System.currentTimeMillis() - savedAt > MAX_AGE_MS) emptyList()
            else (obj["ips"] as? JsonArray)?.mapNotNull { it.jsonPrimitive.content } ?: emptyList()
        } catch (_: Throwable) {
            emptyList()
        }
    }

    /** Loads the rich Pick rows. Falls back to bare IPs (with no metadata)
     *  if only the legacy "ips" array is present. */
    fun loadPicks(ctx: Context): List<DbClient.Pick> = synchronized(this) {
        val f = File(ctx.cacheDir, FILE)
        if (!f.exists()) return emptyList()
        return try {
            val obj = json.parseToJsonElement(f.readText()).jsonObject
            val savedAt = obj["savedAt"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L
            if (System.currentTimeMillis() - savedAt > MAX_AGE_MS) return emptyList()
            val arr = obj["picks"] as? JsonArray
            if (arr != null && arr.isNotEmpty()) {
                arr.mapNotNull { it as? JsonObject }.mapNotNull { o ->
                    val ip = (o["ip"] as? JsonPrimitive)?.content ?: return@mapNotNull null
                    DbClient.Pick(
                        ip = ip,
                        avgPing = (o["avg_ping"] as? JsonPrimitive)?.content?.toDoubleOrNull(),
                        avgDownload = (o["avg_download"] as? JsonPrimitive)?.content?.toDoubleOrNull(),
                        successRate = (o["success_rate"] as? JsonPrimitive)?.content?.toDoubleOrNull(),
                        score = (o["score"] as? JsonPrimitive)?.content?.toDoubleOrNull(),
                        tier = (o["tier"] as? JsonPrimitive)?.content.orEmpty(),
                        shareable = (o["shareable"] as? JsonPrimitive)?.content?.toBooleanStrictOrNull() ?: false,
                    )
                }
            } else {
                (obj["ips"] as? JsonArray).orEmpty()
                    .mapNotNull { (it as? JsonPrimitive)?.content }
                    .map { DbClient.Pick(it) }
            }
        } catch (_: Throwable) {
            emptyList()
        }
    }

    fun save(ctx: Context, ips: List<String>) {
        savePicks(ctx, ips.distinct().take(MAX_ENTRIES).map { DbClient.Pick(it) })
    }

    /** Persist the full rich snapshot. */
    fun savePicks(ctx: Context, picks: List<DbClient.Pick>) = synchronized(this) {
        val trimmed = picks.distinctBy { it.ip }.take(MAX_ENTRIES)
        if (trimmed.isEmpty()) return
        val f = File(ctx.cacheDir, FILE)
        try {
            val obj = buildJsonObject {
                put("savedAt", JsonPrimitive(System.currentTimeMillis()))
                put("ips", JsonArray(trimmed.map { JsonPrimitive(it.ip) }))
                put("picks", buildJsonArray {
                    for (p in trimmed) add(buildJsonObject {
                        put("ip", JsonPrimitive(p.ip))
                        p.avgPing?.let { put("avg_ping", JsonPrimitive(it)) }
                        p.avgDownload?.let { put("avg_download", JsonPrimitive(it)) }
                        p.successRate?.let { put("success_rate", JsonPrimitive(it)) }
                        p.score?.let { put("score", JsonPrimitive(it)) }
                        if (p.tier.isNotEmpty()) put("tier", JsonPrimitive(p.tier))
                        if (p.shareable) put("shareable", JsonPrimitive(true))
                    })
                })
            }
            f.writeText(obj.toString())
        } catch (_: Throwable) {
            // best-effort cache; ignore write failures
        }
    }
}
