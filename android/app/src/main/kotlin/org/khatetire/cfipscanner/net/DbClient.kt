package org.khatetire.cfipscanner.net

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.khatetire.cfipscanner.BuildConfig
import org.khatetire.cfipscanner.util.AnonymousId
import java.net.InetAddress
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Five-layer fallback client for the public `/v1/...` API on the community
 * Worker. Layers (in order):
 *
 *   L1: Direct HTTPS to the canonical worker host.
 *   L2: Worker via subdomain rotation (`workerFallbackHosts`).
 *   L3: Worker via clean-IP override + SNI fronting (custom Dns + Host header).
 *   L4: On-device cache from [DbCache] (24-hour TTL).
 *   L5: Bundled cold-start IP seed (from [BuildConfig.BOOTSTRAP_CLEAN_IPS]).
 *
 * Every layer that succeeds also refreshes the cache. The selected layer is
 * returned in [Picks.layer] so the UI can show the small "DB · L2 · 87ms"
 * badge described in the plan.
 *
 * Auth: anonymous `X-Device-Id` derived from [AnonymousId] (sha256 hex),
 * never tied to any account. The legacy `X-API-Key` header (admin desktop
 * key) is still sent when [BuildConfig.DB_PROXY_API_KEY] is set, so the
 * worker can be deployed in either mode.
 */
object DbClient {

    private const val TAG = "DbClient"

    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }

    @Volatile private var cachedDeviceId: String? = null

    private val plainClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(6, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            // ProxySelector: try the local Xray HTTP inbound first (remote DNS),
            // then fall back to a direct connection. This rescues L1/L2 from
            // local ISPs that block DNS for *.workers.dev.
            .proxySelector(object : java.net.ProxySelector() {
                override fun select(uri: java.net.URI): List<java.net.Proxy> = listOf(
                    java.net.Proxy(
                        java.net.Proxy.Type.HTTP,
                        java.net.InetSocketAddress("127.0.0.1", 10809)
                    ),
                    java.net.Proxy.NO_PROXY
                )
                override fun connectFailed(
                    uri: java.net.URI,
                    sa: java.net.SocketAddress,
                    ioe: java.io.IOException,
                ) {}
            })
            .build()
    }

    /** Default Cloudflare anycast IPs used as a permanent L5 safety net when
     *  no clean-IP list was baked into [BuildConfig.BOOTSTRAP_CLEAN_IPS]. */
    private val DEFAULT_SEED_IPS = listOf(
        "104.16.132.229",
        "104.17.43.81",
        "104.18.36.214",
        "104.19.42.10",
        "104.20.46.55",
        "104.21.45.62",
        "172.67.171.55",
        "172.67.184.49",
        "172.67.214.155",
        "188.114.96.7",
        "188.114.97.7",
        "162.159.135.233",
    )

    /** Per-host failure backoff so we cool off broken layers briefly. */
    private val recentFailures = HashMap<String, Long>()
    private const val FAILURE_BACKOFF_MS = 60_000L

    // ---- public model ----------------------------------------------------

    enum class Layer(val tag: String) {
        L1_DIRECT("L1"),
        L2_WORKER("L2"),
        L3_FRONTED("L3"),
        L4_CACHE("L4"),
        L5_SEED("L5"),
        NONE("--"),
    }

    data class Pick(
        val ip: String,
        val avgPing: Double? = null,
        val avgDownload: Double? = null,
        val successRate: Double? = null,
        val score: Double? = null,
        val tier: String = "",
        val shareable: Boolean = false,
    )

    data class Picks(
        val ips: List<Pick>,
        val layer: Layer,
        val latencyMs: Long,
    ) {
        val rawIps: List<String> get() = ips.map { it.ip }
        val isEmpty: Boolean get() = ips.isEmpty()
    }

    data class VersionInfo(
        val versionCode: Int,
        val versionName: String,
        val minSupportedVersionCode: Int,
        val apkUrl: String,
        val sha256: String?,
        val changelog: String,
        val forceUpdate: Boolean,
    )

    // ---- entry points ----------------------------------------------------

    /** Returns up to [limit] best IPs by walking L1..L5 in order. */
    suspend fun bestIps(ctx: Context, limit: Int = 30): Picks = withContext(Dispatchers.IO) {
        val info = runCatching { IspContext.current() }.getOrDefault(IspContext.Info())
        val cc = info.country
        val isp = info.isp
        val asn = info.asn
        val deviceId = deviceId(ctx)

        for (layer in arrayOf(Layer.L1_DIRECT, Layer.L2_WORKER, Layer.L3_FRONTED)) {
            val started = System.nanoTime()
            val picks = runCatching { fetchBestIpsViaLayer(layer, deviceId, cc, isp, asn, limit) }
                .onFailure { Log.w(TAG, "${layer.tag} bestIps failed: ${it.message}") }
                .getOrNull()
            val ms = (System.nanoTime() - started) / 1_000_000
            if (!picks.isNullOrEmpty()) {
                DbCache.save(ctx, picks.map { it.ip })
                Log.i(TAG, "bestIps: ${layer.tag} returned ${picks.size} ips in ${ms}ms")
                org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(layer.tag, ok = true, latencyMs = ms)
                return@withContext Picks(picks, layer, ms)
            } else {
                org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(layer.tag, ok = false, latencyMs = ms)
            }
        }

        val cached = DbCache.load(ctx)
        if (cached.isNotEmpty()) {
            org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(Layer.L4_CACHE.tag, ok = true, latencyMs = 0)
            return@withContext Picks(cached.map { Pick(it) }, Layer.L4_CACHE, 0)
        } else {
            org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(Layer.L4_CACHE.tag, ok = false, latencyMs = 0)
        }

        val seed = bundledSeedIps()
        if (seed.isNotEmpty()) {
            org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(Layer.L5_SEED.tag, ok = true, latencyMs = 0)
            return@withContext Picks(seed.map { Pick(it) }, Layer.L5_SEED, 0)
        } else {
            org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(Layer.L5_SEED.tag, ok = false, latencyMs = 0)
        }

        Picks(emptyList(), Layer.NONE, 0)
    }

    /** POST a single contribution result. Best-effort; returns false on full failure. */
    suspend fun submitScanResult(ctx: Context, body: JsonObject): Boolean =
        withContext(Dispatchers.IO) { postV1(ctx, "/scan-result", body) != null }

    /** POST a batch of contribution results. */
    suspend fun submitScanResultsBatch(
        ctx: Context,
        cc: String,
        isp: String,
        appVersion: String,
        results: List<JsonObject>,
    ): Boolean = withContext(Dispatchers.IO) {
        if (results.isEmpty()) return@withContext true
        val payload = buildJsonObject {
            put("cc", cc); put("isp", isp); put("app_version", appVersion)
            put("results", buildJsonArray { results.forEach { add(it) } })
        }
        postV1(ctx, "/scan-results-batch", payload) != null
    }

    /** Result of a successful shard claim. */
    data class ShardClaim(val shard: String, val leaseExpiresAt: String, val leaseMinutes: Int)

    /** Claim the next un-scanned CF /24. Returns null when no shard is available
     *  (caller should sleep and retry, or fall back to local random scanning). */
    suspend fun claimShard(ctx: Context): ShardClaim? = withContext(Dispatchers.IO) {
        val resp = postV1(ctx, "/scan-shard/claim", buildJsonObject {}) ?: return@withContext null
        val ok = (resp["ok"] as? JsonPrimitive)?.content?.toBooleanStrictOrNull() ?: false
        if (!ok) return@withContext null
        val shard = (resp["shard"] as? JsonPrimitive)?.content ?: return@withContext null
        val exp = (resp["lease_expires_at"] as? JsonPrimitive)?.content.orEmpty()
        val mins = (resp["lease_minutes"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 30
        ShardClaim(shard, exp, mins)
    }

    /** Release the lease on a claimed shard and report scan summary. */
    suspend fun completeShard(
        ctx: Context, shard: String, okCount: Int, totalCount: Int,
    ): Boolean = withContext(Dispatchers.IO) {
        val payload = buildJsonObject {
            put("shard", shard); put("ok_count", okCount); put("total_count", totalCount)
        }
        postV1(ctx, "/scan-shard/complete", payload) != null
    }

    /** Fetch curated SNI bank for the user's region. */
    suspend fun sniBank(ctx: Context, cc: String): List<String> = withContext(Dispatchers.IO) {
        val obj = getV1(ctx, "/sni-bank", mapOf("cc" to cc)) ?: return@withContext emptyList()
        (obj["snis"] as? JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull() } ?: emptyList()
    }

    /** Fetch latest in-app version metadata. */
    suspend fun latestVersion(ctx: Context): VersionInfo? = withContext(Dispatchers.IO) {
        val obj = getV1(ctx, "/version", emptyMap()) ?: return@withContext null
        runCatching {
            VersionInfo(
                versionCode = (obj["versionCode"] as? JsonPrimitive)?.content?.toInt() ?: 0,
                versionName = (obj["versionName"] as? JsonPrimitive)?.content.orEmpty(),
                minSupportedVersionCode = (obj["minSupportedVersionCode"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0,
                apkUrl = (obj["apkUrl"] as? JsonPrimitive)?.content.orEmpty(),
                sha256 = (obj["sha256"] as? JsonPrimitive)?.content,
                changelog = (obj["changelog"] as? JsonPrimitive)?.content.orEmpty(),
                forceUpdate = (obj["forceUpdate"] as? JsonPrimitive)?.content?.toBooleanStrictOrNull() ?: false,
            )
        }.getOrNull()
    }

    // ---- per-layer fetchers ---------------------------------------------

    private fun fetchBestIpsViaLayer(
        layer: Layer,
        deviceId: String,
        cc: String,
        isp: String,
        asn: String,
        limit: Int,
    ): List<Pick> {
        val host = pickHost(layer) ?: return emptyList()
        // L3 bypasses DNS by using a hardcoded clean IP, so it must NOT inherit
        // the cooldown that L1 set on the same hostname.
        if (layer != Layer.L3_FRONTED && isCoolingOff(host)) {
            Log.d(TAG, "${layer.tag} host $host cooling off, skipping")
            return emptyList()
        }

        val client = clientForLayer(layer)
        val urlBuilder = HttpUrl.Builder()
            .scheme("https").host(host).addPathSegments("v1/best-ips")
            .addQueryParameter("limit", limit.toString())
        if (cc.isNotBlank()) urlBuilder.addQueryParameter("cc", cc)
        if (isp.isNotBlank()) urlBuilder.addQueryParameter("isp", isp)
        if (asn.isNotBlank()) urlBuilder.addQueryParameter("asn", asn)

        val req = Request.Builder()
            .url(urlBuilder.build())
            .header("X-Device-Id", deviceId)
            .also { addLegacyApiKey(it) }
            .get()
            .build()

        return try {
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    markFailure(host)
                    Log.w(TAG, "${layer.tag} GET /v1/best-ips -> HTTP ${resp.code}")
                    return emptyList()
                }
                clearFailure(host)
                parseBestIpsResponse(resp)
            }
        } catch (t: Throwable) {
            markFailure(host)
            Log.w(TAG, "${layer.tag} GET /v1/best-ips failed: ${t.message}")
            emptyList()
        }
    }

    private fun parseBestIpsResponse(resp: Response): List<Pick> {
        val text = resp.body?.string().orEmpty()
        if (text.isEmpty()) return emptyList()
        val obj = json.parseToJsonElement(text).jsonObject
        val arr = obj["results"] as? JsonArray ?: return emptyList()
        return arr.mapNotNull { it as? JsonObject }.mapNotNull { o ->
            val ip = o["ip"]?.jsonPrimitive?.contentOrNull() ?: return@mapNotNull null
            Pick(
                ip = ip,
                avgPing = (o["avg_ping"] as? JsonPrimitive)?.content?.toDoubleOrNull(),
                avgDownload = (o["avg_download"] as? JsonPrimitive)?.content?.toDoubleOrNull(),
                successRate = (o["success_rate"] as? JsonPrimitive)?.content?.toDoubleOrNull(),
                score = (o["score"] as? JsonPrimitive)?.content?.toDoubleOrNull(),
                tier = (o["tier"] as? JsonPrimitive)?.content.orEmpty(),
                shareable = (o["shareable"] as? JsonPrimitive)?.content?.toBooleanStrictOrNull() ?: false,
            )
        }
    }

    // ---- POST/GET helpers (walk L1->L3 automatically) -------------------

    private fun postV1(ctx: Context, path: String, body: JsonObject): JsonObject? {
        val deviceId = deviceId(ctx)
        for (layer in arrayOf(Layer.L1_DIRECT, Layer.L2_WORKER, Layer.L3_FRONTED)) {
            val host = pickHost(layer) ?: continue
            if (layer != Layer.L3_FRONTED && isCoolingOff(host)) continue
            val client = clientForLayer(layer)
            val url = HttpUrl.Builder().scheme("https").host(host)
                .addPathSegments("v1${path.trimStart('/')}")
                .build()
            val req = Request.Builder()
                .url(url)
                .header("X-Device-Id", deviceId)
                .header("Content-Type", "application/json")
                .also { addLegacyApiKey(it) }
                .post(json.encodeToString(JsonObject.serializer(), body).toRequestBody(JSON_MEDIA))
                .build()
            try {
                client.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) {
                        markFailure(host)
                        Log.w(TAG, "${layer.tag} POST /v1$path -> HTTP ${resp.code}")
                        return@use
                    }
                    clearFailure(host)
                    val text = resp.body?.string().orEmpty()
                    return if (text.isEmpty()) buildJsonObject {} else json.parseToJsonElement(text).jsonObject
                }
            } catch (t: Throwable) {
                markFailure(host)
                Log.w(TAG, "${layer.tag} POST /v1$path failed: ${t.message}")
            }
        }
        return null
    }

    private fun getV1(ctx: Context, path: String, params: Map<String, String>): JsonObject? {
        val deviceId = deviceId(ctx)
        for (layer in arrayOf(Layer.L1_DIRECT, Layer.L2_WORKER, Layer.L3_FRONTED)) {
            val host = pickHost(layer) ?: continue
            if (layer != Layer.L3_FRONTED && isCoolingOff(host)) continue
            val client = clientForLayer(layer)
            val urlBuilder = HttpUrl.Builder().scheme("https").host(host)
                .addPathSegments("v1${path.trimStart('/')}")
            params.forEach { (k, v) -> if (v.isNotBlank()) urlBuilder.addQueryParameter(k, v) }
            val req = Request.Builder()
                .url(urlBuilder.build())
                .header("X-Device-Id", deviceId)
                .also { addLegacyApiKey(it) }
                .get()
                .build()
            try {
                client.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) {
                        markFailure(host)
                        return@use
                    }
                    clearFailure(host)
                    val text = resp.body?.string().orEmpty()
                    return if (text.isEmpty()) buildJsonObject {} else json.parseToJsonElement(text).jsonObject
                }
            } catch (t: Throwable) {
                markFailure(host)
            }
        }
        return null
    }

    // ---- layer plumbing --------------------------------------------------

    private fun pickHost(layer: Layer): String? {
        val canonical = canonicalHost() ?: return null
        return when (layer) {
            Layer.L1_DIRECT -> canonical
            Layer.L2_WORKER -> rotationHosts().firstOrNull { it != canonical } ?: canonical
            Layer.L3_FRONTED -> canonical
            else -> null
        }
    }

    private fun canonicalHost(): String? {
        val raw = BuildConfig.DB_PROXY_URL.takeIf { it.isNotBlank() } ?: return null
        return runCatching { raw.toHttpUrl().host }.getOrNull()
    }

    private fun rotationHosts(): List<String> {
        val canonical = canonicalHost()
        val extras = BuildConfig.WORKER_FALLBACK_HOSTS
            .split(',')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        return (listOfNotNull(canonical) + extras).distinct()
    }

    private fun cleanIps(): List<String> {
        val baked = BuildConfig.BOOTSTRAP_CLEAN_IPS
            .split(',')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        // If no clean IPs were baked at build time, fall back to a known-good
        // anycast list so L3 fronting and L5 seed always have something.
        return if (baked.isNotEmpty()) baked else DEFAULT_SEED_IPS
    }

    private fun bundledSeedIps(): List<String> = cleanIps()

    private fun clientForLayer(layer: Layer): OkHttpClient {
        if (layer != Layer.L3_FRONTED) return plainClient
        // L3: override DNS so the worker host resolves to a known-clean
        // Cloudflare anycast IP. SNI is left as-is so the TLS handshake still
        // matches the worker cert (worker hosts use Cloudflare-issued certs).
        val cleans = cleanIps()
        if (cleans.isEmpty()) return plainClient
        val frontedDns = object : Dns {
            override fun lookup(hostname: String): List<InetAddress> =
                cleans.mapNotNull { ip ->
                    runCatching { InetAddress.getByAddress(hostname, parseIp(ip)) }.getOrNull()
                }.ifEmpty { Dns.SYSTEM.lookup(hostname) }
        }
        return plainClient.newBuilder()
            .dns(frontedDns)
            .build()
    }

    private fun parseIp(ip: String): ByteArray {
        val parts = ip.split('.')
        require(parts.size == 4) { "not ipv4: $ip" }
        return ByteArray(4) { parts[it].toInt().toByte() }
    }

    private fun addLegacyApiKey(builder: Request.Builder) {
        if (BuildConfig.DB_PROXY_API_KEY.isNotBlank()) {
            builder.header("X-API-Key", BuildConfig.DB_PROXY_API_KEY)
        }
    }

    // ---- failure backoff -------------------------------------------------

    private fun markFailure(host: String) = synchronized(recentFailures) {
        recentFailures[host] = System.currentTimeMillis()
    }

    private fun clearFailure(host: String) = synchronized(recentFailures) {
        recentFailures.remove(host)
    }

    private fun isCoolingOff(host: String): Boolean = synchronized(recentFailures) {
        val ts = recentFailures[host] ?: return false
        val cooling = System.currentTimeMillis() - ts < FAILURE_BACKOFF_MS
        if (!cooling) recentFailures.remove(host)
        cooling
    }

    // ---- device identity -------------------------------------------------

    private fun deviceId(ctx: Context): String {
        cachedDeviceId?.let { return it }
        val raw = AnonymousId.get(ctx)
        val sha = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
        val hex = buildString(sha.size * 2) {
            for (b in sha) {
                val i = b.toInt() and 0xff
                append(HEX[i ushr 4]); append(HEX[i and 0x0f])
            }
        }
        cachedDeviceId = hex
        return hex
    }

    private val HEX = "0123456789abcdef".toCharArray()

    private fun JsonPrimitive.contentOrNull(): String? =
        runCatching { content }.getOrNull()?.takeIf { it.isNotBlank() && it != "null" }
}
