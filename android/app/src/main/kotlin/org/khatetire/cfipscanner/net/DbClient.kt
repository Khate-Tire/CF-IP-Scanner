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
 * Eight-layer always-on fallback client for the public `/v1/...` API on the
 * community Worker. The ladder is intentionally over-engineered so that the
 * device stays "connected to the DB" under almost any blocking scenario:
 *
 *   L1: Direct HTTPS to the canonical worker host.
 *   L2: Worker via subdomain rotation (`workerFallbackHosts`).
 *   L3: Worker via clean-IP override + SNI fronting (custom Dns + Host header).
 *   L4: DoH-resolved direct — [DohResolver] asks 1.1.1.1 over HTTPS for the
 *       worker's A records, bypassing ISP DNS poisoning, then connects to
 *       the resolved IPs with the original hostname (TLS validates fine).
 *   L5: Static snapshot mirror on `cdn.jsdelivr.net` (refreshed by CI from
 *       the worker every 30 min). jsDelivr is reachable on practically any
 *       network because it doubles as an asset CDN for huge OSS projects.
 *   L6: Local IP pool DB ([data.IpPoolStore]) — IPs this device has scanned
 *       and verified itself. 100% offline.
 *   L7: Rich on-device snapshot cache ([DbCache]) — the actual local backup
 *       of the community DB; persists scores+tier metadata for 14 days.
 *   L8: Bundled cold-start IP seed (from [BuildConfig.BOOTSTRAP_CLEAN_IPS]).
 *
 * Every successful layer refreshes the L7 cache, so the local backup stays
 * warm for as long as ANY upstream worked recently. The selected layer is
 * returned in [Picks.layer] so the UI can render "DB · L4 · 87ms".
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
            .build()
    }

    private val proxiedClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(6, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .proxy(java.net.Proxy(
                java.net.Proxy.Type.HTTP,
                java.net.InetSocketAddress("127.0.0.1", 10809)
            ))
            .build()
    }

    /** Active client: when *our* Xray VPN is connected, route through its
     *  HTTP inbound so DNS for *.workers.dev is resolved remotely. When an
     *  *external* VPN is active (Hiddify, NekoBox, system Always-on, etc.)
     *  the OS already tunnels our traffic, so we use the plain client and
     *  let the OS do the work — trying to bind 127.0.0.1:10809 in that case
     *  would just fail because Xray isn't running. */
    private fun activeClient(ctx: Context? = null): OkHttpClient {
        val state = org.khatetire.cfipscanner.vpn.VpnStateHolder.status.value.state
        if (state == org.khatetire.cfipscanner.vpn.VpnStatus.State.CONNECTED) return proxiedClient
        // External VPN → plain client (the OS tunnels everything anyway).
        // Pure direct → also plain client.
        return plainClient
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

    /** Hardcoded fallback worker host used when [BuildConfig.DB_PROXY_URL]
     *  is unset (e.g. dev builds without `db.properties`). The community
     *  worker accepts anonymous reads on `/v1/best-ips`, so L1–L4 still
     *  yield clean IPs without a baked-in API key. */
    private const val DEFAULT_CANONICAL_HOST = "cf-ip-scanner-db-proxy.amn46.workers.dev"

    /** Per-host failure backoff so we cool off broken layers briefly. */
    private val recentFailures = HashMap<String, Long>()
    private const val FAILURE_BACKOFF_MS = 60_000L

    // ---- public model ----------------------------------------------------

    enum class Layer(val tag: String) {
        L1_DIRECT("L1"),
        L2_WORKER("L2"),
        L3_FRONTED("L3"),
        L4_DOH("L4"),
        L5_MIRROR("L5"),
        L6_POOL("L6"),
        L7_CACHE("L7"),
        L8_SEED("L8"),
        NONE("--"),
    }

    /** Total number of layers reported in the badge ("working/total"). Keep
     *  in sync with [Layer]. */
    const val TOTAL_LAYERS = 8

    /** URL of the static snapshot mirror used by [Layer.L5_MIRROR]. The CI
     *  workflow `update-snapshot.yml` rewrites the upstream JSON every 30
     *  minutes; jsDelivr serves it from its global edge with sub-second TTLs
     *  and is reachable on virtually every network. */
    private const val MIRROR_URL =
        "https://cdn.jsdelivr.net/gh/Khate-Tire/CF-IP-Scanner@main/worker/best_ips_snapshot.json"

    /** Secondary mirror via a different CDN — raw GitHub. Tried after the
     *  jsDelivr URL fails so a single CDN outage cannot blackhole the layer. */
    private const val MIRROR_URL_RAW =
        "https://raw.githubusercontent.com/Khate-Tire/CF-IP-Scanner/main/worker/best_ips_snapshot.json"

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

    /** Returns up to [limit] best IPs by walking L1..L8 in order. The first
     *  network layer that returns a non-empty list ALSO updates the L7 cache,
     *  so the offline backup grows organically as the user uses the app. */
    suspend fun bestIps(ctx: Context, limit: Int = 30): Picks = withContext(Dispatchers.IO) {
        val info = runCatching { IspContext.current() }.getOrDefault(IspContext.Info())
        val cc = info.country
        val isp = info.isp
        val asn = info.asn
        val deviceId = deviceId(ctx)

        // ---- L1..L4: network layers that hit the actual worker -----------
        for (layer in arrayOf(Layer.L1_DIRECT, Layer.L2_WORKER, Layer.L3_FRONTED, Layer.L4_DOH)) {
            val started = System.nanoTime()
            val picks = runCatching { fetchBestIpsViaLayer(layer, deviceId, cc, isp, asn, limit) }
                .onFailure { Log.w(TAG, "${layer.tag} bestIps failed: ${it.message}") }
                .getOrNull()
            val ms = (System.nanoTime() - started) / 1_000_000
            if (!picks.isNullOrEmpty()) {
                DbCache.savePicks(ctx, picks)
                Log.i(TAG, "bestIps: ${layer.tag} returned ${picks.size} ips in ${ms}ms")
                org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(layer.tag, ok = true, latencyMs = ms)
                return@withContext Picks(picks, layer, ms)
            } else {
                org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(layer.tag, ok = false, latencyMs = ms)
            }
        }

        // ---- L5: static snapshot mirror (jsdelivr / raw.github) ----------
        run {
            val started = System.nanoTime()
            val picks = runCatching { fetchSnapshotMirror() }
                .onFailure { Log.w(TAG, "L5 mirror failed: ${it.message}") }
                .getOrNull().orEmpty()
            val ms = (System.nanoTime() - started) / 1_000_000
            if (picks.isNotEmpty()) {
                DbCache.savePicks(ctx, picks)
                org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(Layer.L5_MIRROR.tag, ok = true, latencyMs = ms)
                return@withContext Picks(picks, Layer.L5_MIRROR, ms)
            } else {
                org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(Layer.L5_MIRROR.tag, ok = false, latencyMs = ms)
            }
        }

        // ---- L6: local pool of self-verified IPs --------------------------
        run {
            val pool = runCatching {
                org.khatetire.cfipscanner.data.IpPoolStore.top(ctx, limit)
            }.getOrDefault(emptyList())
            if (pool.isNotEmpty()) {
                val picks = pool.map { e ->
                    Pick(
                        ip = e.ip,
                        avgPing = e.pingMs.toDouble(),
                        avgDownload = e.downloadMbps,
                        score = e.score,
                        tier = "pool",
                    )
                }
                org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(Layer.L6_POOL.tag, ok = true, latencyMs = 0)
                return@withContext Picks(picks, Layer.L6_POOL, 0)
            } else {
                org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(Layer.L6_POOL.tag, ok = false, latencyMs = 0)
            }
        }

        // ---- L7: rich snapshot cache (the local DB backup) ----------------
        val cachedPicks = DbCache.loadPicks(ctx)
        if (cachedPicks.isNotEmpty()) {
            org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(Layer.L7_CACHE.tag, ok = true, latencyMs = 0)
            return@withContext Picks(cachedPicks.take(limit), Layer.L7_CACHE, 0)
        } else {
            org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(Layer.L7_CACHE.tag, ok = false, latencyMs = 0)
        }

        // ---- L8: bundled bootstrap seed ----------------------------------
        val seed = bundledSeedIps()
        if (seed.isNotEmpty()) {
            org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(Layer.L8_SEED.tag, ok = true, latencyMs = 0)
            return@withContext Picks(seed.map { Pick(it) }, Layer.L8_SEED, 0)
        } else {
            org.khatetire.cfipscanner.ui.ScanStateHolder.markDbLayer(Layer.L8_SEED.tag, ok = false, latencyMs = 0)
        }

        Picks(emptyList(), Layer.NONE, 0)
    }

    // ---- L5 snapshot mirror fetcher --------------------------------------

    private fun fetchSnapshotMirror(): List<Pick> {
        for (url in arrayOf(MIRROR_URL, MIRROR_URL_RAW)) {
            val req = Request.Builder().url(url).get().build()
            val picks = try {
                plainClient.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) return@use emptyList()
                    val text = resp.body?.string().orEmpty()
                    if (text.isBlank()) return@use emptyList()
                    val obj = json.parseToJsonElement(text).jsonObject
                    val arr = obj["results"] as? JsonArray ?: return@use emptyList()
                    arr.mapNotNull { it as? JsonObject }.mapNotNull { o ->
                        val ip = (o["ip"] as? JsonPrimitive)?.content ?: return@mapNotNull null
                        Pick(
                            ip = ip,
                            avgPing = (o["avg_ping"] as? JsonPrimitive)?.content?.toDoubleOrNull(),
                            avgDownload = (o["avg_download"] as? JsonPrimitive)?.content?.toDoubleOrNull(),
                            successRate = (o["success_rate"] as? JsonPrimitive)?.content?.toDoubleOrNull(),
                            score = (o["score"] as? JsonPrimitive)?.content?.toDoubleOrNull(),
                            tier = (o["tier"] as? JsonPrimitive)?.content.orEmpty(),
                        )
                    }
                }
            } catch (t: Throwable) {
                Log.w(TAG, "mirror $url failed: ${t.message}")
                emptyList()
            }
            if (picks.isNotEmpty()) return picks
        }
        return emptyList()
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
        // L3 / L4 bypass system DNS via fronting / DoH respectively, so they
        // must NOT inherit the cooldown that L1 set on the same hostname.
        if (layer != Layer.L3_FRONTED && layer != Layer.L4_DOH && isCoolingOff(host)) {
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
        for (layer in arrayOf(Layer.L1_DIRECT, Layer.L2_WORKER, Layer.L3_FRONTED, Layer.L4_DOH)) {
            val host = pickHost(layer) ?: continue
            if (layer != Layer.L3_FRONTED && layer != Layer.L4_DOH && isCoolingOff(host)) continue
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
        for (layer in arrayOf(Layer.L1_DIRECT, Layer.L2_WORKER, Layer.L3_FRONTED, Layer.L4_DOH)) {
            val host = pickHost(layer) ?: continue
            if (layer != Layer.L3_FRONTED && layer != Layer.L4_DOH && isCoolingOff(host)) continue
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
            Layer.L4_DOH -> canonical
            else -> null
        }
    }

    private fun canonicalHost(): String? {
        val raw = BuildConfig.DB_PROXY_URL.takeIf { it.isNotBlank() }
        if (raw != null) {
            val h = runCatching { raw.toHttpUrl().host }.getOrNull()
            if (!h.isNullOrBlank()) return h
        }
        // Hardcoded fallback so dev builds (no db.properties) still attempt
        // L1–L4 against the public community worker. Authenticated POSTs
        // will still fail without an API key, but anonymous GET /v1/best-ips
        // is reachable, which is what L1–L4 actually need.
        return DEFAULT_CANONICAL_HOST
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
        val base = activeClient()
        return when (layer) {
            Layer.L3_FRONTED -> {
                // L3: override DNS so the worker host resolves to a known-clean
                // Cloudflare anycast IP. SNI is left as-is so the TLS handshake
                // still matches the worker cert.
                val cleans = cleanIps()
                if (cleans.isEmpty()) base else {
                    val frontedDns = object : Dns {
                        override fun lookup(hostname: String): List<InetAddress> =
                            cleans.mapNotNull { ip ->
                                runCatching { InetAddress.getByAddress(hostname, parseIp(ip)) }.getOrNull()
                            }.ifEmpty { Dns.SYSTEM.lookup(hostname) }
                    }
                    base.newBuilder().dns(frontedDns).build()
                }
            }
            Layer.L4_DOH -> {
                // L4: resolve via Cloudflare DNS-over-HTTPS, bypassing ISP DNS
                // hijack. We always return the plain client (no proxy) because
                // DoH itself is the network call that proves we have egress.
                plainClient.newBuilder().dns(DohResolver.asDns()).build()
            }
            else -> base
        }
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
