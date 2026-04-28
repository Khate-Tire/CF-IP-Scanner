package org.khatetire.cfipscanner.net

import android.content.Context
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.File

/**
 * On-device cache of last-known-good IPs (Layer 4 of [DbClient] fallback).
 * Stores at most [MAX_ENTRIES] IPs and expires after [MAX_AGE_MS].
 *
 * Not security-sensitive — Cloudflare edge IPs are public anycast addresses.
 */
object DbCache {

    private const val FILE = "antigravity_dbcache.json"
    private const val MAX_ENTRIES = 50
    private const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000L // 7 days

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

    fun save(ctx: Context, ips: List<String>) = synchronized(this) {
        val trimmed = ips.distinct().take(MAX_ENTRIES)
        if (trimmed.isEmpty()) return
        val f = File(ctx.cacheDir, FILE)
        try {
            val obj = buildJsonObject {
                put("savedAt", JsonPrimitive(System.currentTimeMillis()))
                put("ips", JsonArray(trimmed.map { JsonPrimitive(it) }))
            }
            f.writeText(obj.toString())
        } catch (_: Throwable) {
            // best-effort cache; ignore write failures
        }
    }
}
