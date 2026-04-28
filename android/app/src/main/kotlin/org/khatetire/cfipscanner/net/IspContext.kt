package org.khatetire.cfipscanner.net

import android.content.Context
import android.telephony.TelephonyManager
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
    // ip-api.com fallback — same source the desktop scanner uses, queried
    // by-IP via a known-clean anycast (208.95.112.1) with Host header so it
    // works even when DNS for ip-api.com is poisoned.
    private const val URL_IPAPI = "http://208.95.112.1/json"
    private const val TTL_MS = 10 * 60 * 1000L // 10 minutes

    @Volatile private var cached: Info? = null
    @Volatile private var cachedAt: Long = 0
    @Volatile private var appCtx: Context? = null

    /** App should call this once at startup so the ISP probe can also pull
     *  the SIM operator name on cellular for a richer label. Optional — the
     *  CF / ip-api lookups still work without it. */
    fun attach(ctx: Context) { appCtx = ctx.applicationContext }

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
        // Multi-source ISP detection: CF /meta gives ASN+org reliably when
        // it's reachable; ip-api.com fills the org/ISP gap when CF only
        // returns IP+colo via the trace fallback; the SIM carrier name is
        // merged on top so the user sees "MCI" not just "AS44244" on data.
        var info = fetchMeta() ?: fetchTrace() ?: Info()
        if (info.isp.isBlank() || info.asn.isBlank()) {
            fetchIpApi(info.ip)?.let { info = mergeNonBlank(info, it) }
        }
        info = mergeNonBlank(info, simCarrier())
        cached = info
        cachedAt = now
        Log.i(TAG, "resolved cc=${info.country} asn=${info.asn} isp=${info.isp.take(40)}")
        info
    }

    private fun mergeNonBlank(base: Info, overlay: Info): Info = base.copy(
        ip = base.ip.ifBlank { overlay.ip },
        asn = base.asn.ifBlank { overlay.asn },
        country = base.country.ifBlank { overlay.country },
        isp = base.isp.ifBlank { overlay.isp },
        location = base.location.ifBlank { overlay.location },
    )

    private fun fetchIpApi(ip: String): Info? {
        return try {
            val url = if (ip.isNotBlank()) "$URL_IPAPI/$ip?fields=country,countryCode,city,isp,as,query"
                      else "$URL_IPAPI?fields=country,countryCode,city,isp,as,query"
            val req = Request.Builder().url(url).header("Host", "ip-api.com").get().build()
            client().newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return null
                val body = resp.body?.string().orEmpty()
                if (body.isBlank()) return null
                val obj = json.parseToJsonElement(body).jsonObject
                val asField = (obj["as"] as? JsonPrimitive)?.content.orEmpty() // "AS44244 MCI ..."
                val asn = asField.substringBefore(' ', "").takeIf { it.startsWith("AS") }.orEmpty()
                Info(
                    ip = (obj["query"] as? JsonPrimitive)?.content.orEmpty(),
                    country = (obj["countryCode"] as? JsonPrimitive)?.content.orEmpty(),
                    location = (obj["city"] as? JsonPrimitive)?.content.orEmpty(),
                    asn = asn,
                    isp = (obj["isp"] as? JsonPrimitive)?.content.orEmpty(),
                )
            }
        } catch (t: Throwable) {
            Log.w(TAG, "ipapi fetch failed: ${t.message}")
            null
        }
    }

    private fun simCarrier(): Info {
        val ctx = appCtx ?: return Info()
        return runCatching {
            val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
                ?: return@runCatching Info()
            // Only meaningful when a SIM is present and registered.
            if (tm.simState != TelephonyManager.SIM_STATE_READY) return@runCatching Info()
            val name = tm.networkOperatorName.orEmpty()
            val mcc = tm.networkOperator.orEmpty().take(3)
            // We don't trust this for ASN, but the operator name is a great
            // ISP hint for cellular and the country (MCC) is rock solid.
            val country = when (mcc) {
                "432" -> "IR"; "262" -> "DE"; "234", "235" -> "GB"; "310", "311", "312" -> "US"
                "250" -> "RU"; "286" -> "TR"; "404", "405" -> "IN"; "460" -> "CN"
                else -> ""
            }
            Info(isp = name, country = country)
        }.getOrDefault(Info())
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
