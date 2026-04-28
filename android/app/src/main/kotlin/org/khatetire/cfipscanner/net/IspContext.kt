package org.khatetire.cfipscanner.net

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * Resolves the device's apparent egress IP, ASN/ISP organisation, and
 * country. Tries `speed.cloudflare.com/meta` first (returns a structured
 * JSON with `asn`, `asOrganization`, `country`), then falls back to the
 * lightweight `cloudflare.com/cdn-cgi/trace` endpoint which only carries
 * IP + colo (no ISP). Result is cached process-wide for [TTL_MS].
 *
 * Sensitive: caller must NOT log [Info.ip] or surface it in plain UI.
 */
object IspContext {

    data class Info(
        val ip: String = "",
        val asn: String = "",
        val country: String = "",
        val isp: String = "",
        val location: String = "",
    )

    private const val TAG = "IspContext"
    private const val URL_META = "https://speed.cloudflare.com/meta"
    private const val URL_TRACE = "https://www.cloudflare.com/cdn-cgi/trace"
    private const val TTL_MS = 10 * 60 * 1000L // 10 minutes

    @Volatile private var cached: Info? = null
    @Volatile private var cachedAt: Long = 0

    private val json = Json { ignoreUnknownKeys = true }

    private val directClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .build()
    }

    private val proxiedClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .proxy(java.net.Proxy(
                java.net.Proxy.Type.HTTP,
                java.net.InetSocketAddress("127.0.0.1", 10809)
            ))
            .build()
    }

    /** Pick proxy client when VPN is up so the request resolves DNS remotely. */
    private fun client(): OkHttpClient {
        val state = org.khatetire.cfipscanner.vpn.VpnStateHolder.status.value.state
        return if (state == org.khatetire.cfipscanner.vpn.VpnStatus.State.CONNECTED) proxiedClient
        else directClient
    }

    suspend fun current(forceRefresh: Boolean = false): Info = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        cached?.let { c ->
            if (!forceRefresh && now - cachedAt < TTL_MS) return@withContext c
        }
        val info = fetchMeta() ?: fetchTrace() ?: cached ?: Info()
        cached = info
        cachedAt = now
        Log.i(TAG, "resolved cc=${info.country} asn=${info.asn} isp=${info.isp.take(40)}")
        info
    }

    private fun fetchMeta(): Info? {
        return try {
            client().newCall(Request.Builder().url(URL_META).get().build()).execute().use { resp ->
                if (!resp.isSuccessful) return null
                val body = resp.body?.string().orEmpty()
                if (body.isBlank()) return null
                val obj: JsonObject = json.parseToJsonElement(body).jsonObject
                val asnNum = (obj["asn"] as? JsonPrimitive)?.content.orEmpty()
                Info(
                    ip = (obj["clientIp"] as? JsonPrimitive)?.content.orEmpty(),
                    country = (obj["country"] as? JsonPrimitive)?.content.orEmpty(),
                    location = (obj["country"] as? JsonPrimitive)?.content.orEmpty(),
                    asn = if (asnNum.isNotEmpty()) "AS$asnNum" else "",
                    isp = (obj["asOrganization"] as? JsonPrimitive)?.content.orEmpty(),
                )
            }
        } catch (t: Throwable) {
            Log.w(TAG, "meta fetch failed: ${t.message}")
            null
        }
    }

    private fun fetchTrace(): Info? {
        return try {
            client().newCall(Request.Builder().url(URL_TRACE).get().build()).execute().use { resp ->
                if (!resp.isSuccessful) return null
                val body = resp.body?.string().orEmpty()
                val map = body.lineSequence()
                    .mapNotNull {
                        val i = it.indexOf('=')
                        if (i > 0) it.substring(0, i) to it.substring(i + 1) else null
                    }
                    .toMap()
                Info(
                    ip = map["ip"].orEmpty(),
                    country = map["loc"].orEmpty(),
                    location = map["loc"].orEmpty(),
                    isp = "", // unknown via trace
                    asn = "",
                )
            }
        } catch (t: Throwable) {
            Log.w(TAG, "trace fetch failed: ${t.message}")
            null
        }
    }
}
