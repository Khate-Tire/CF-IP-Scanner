package org.khatetire.cfipscanner.scanner

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Bundled "gold domains" list — high-quality Cloudflare-fronted enterprise
 * sites whose A records point at well-conditioned anycast IPs. Used as a
 * candidate seed when:
 *   1. The DB ladder returns no IPs (cold start, blocked, etc.), or
 *   2. The user explicitly wants extra coverage.
 *
 * Source asset: `assets/gold_domains.txt` (synced from
 * `CF-SITES/main/list.txt`). Resolution is done over Cloudflare DoH so
 * a poisoned local DNS can't sabotage the seed.
 */
object GoldDomains {
    private const val TAG = "GoldDomains"
    private const val ASSET = "gold_domains.txt"
    private const val DOH_URL = "https://cloudflare-dns.com/dns-query"

    @Volatile private var cachedDomains: List<String>? = null
    @Volatile private var cachedIps: List<String>? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(4, TimeUnit.SECONDS)
        .build()

    /** Read the bundled list from app assets (cached). */
    fun domains(ctx: Context): List<String> {
        cachedDomains?.let { return it }
        val list = runCatching {
            ctx.assets.open(ASSET).bufferedReader().useLines { seq ->
                seq.map { it.trim() }
                    .filter { it.isNotBlank() && !it.startsWith("#") }
                    .toList()
            }
        }.getOrDefault(emptyList())
        cachedDomains = list
        Log.i(TAG, "loaded ${list.size} gold domains from asset")
        return list
    }

    /** Resolve gold domains via Cloudflare DoH, dedupe IPs. Cached for the
     *  process lifetime. Caller may call [invalidate] to force a refresh. */
    suspend fun ips(ctx: Context, maxConcurrency: Int = 16): List<String> = withContext(Dispatchers.IO) {
        cachedIps?.let { return@withContext it }
        val ds = domains(ctx)
        if (ds.isEmpty()) return@withContext emptyList()
        val seen = LinkedHashSet<String>()
        coroutineScope {
            ds.chunked(maxConcurrency).forEach { batch ->
                val resolved = batch.map { d -> async { dohResolve(d) } }.awaitAll()
                resolved.forEach { ips -> ips.forEach { seen.add(it) } }
            }
        }
        val out = seen.toList()
        cachedIps = out
        Log.i(TAG, "resolved ${out.size} unique IPs from ${ds.size} gold domains")
        out
    }

    fun invalidate() { cachedIps = null }

    /** Cloudflare DoH POST (DNS wire format). Returns IPv4 addresses only. */
    private fun dohResolve(domain: String): List<String> {
        return runCatching {
            // Use JSON DoH for simplicity (no wire-format builder needed).
            val req = Request.Builder()
                .url("$DOH_URL?name=$domain&type=A")
                .header("Accept", "application/dns-json")
                .get()
                .build()
            withTimeoutBlocking(3_000L) {
                client.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) return@use emptyList()
                    val body = resp.body?.string().orEmpty()
                    val ans = JSONObject(body).optJSONArray("Answer") ?: return@use emptyList()
                    (0 until ans.length()).mapNotNull { i ->
                        val o = ans.optJSONObject(i) ?: return@mapNotNull null
                        // type 1 == A
                        if (o.optInt("type") == 1) o.optString("data").takeIf { it.isNotBlank() } else null
                    }
                }
            }
        }.getOrDefault(emptyList())
    }

    // Tiny blocking wrapper so we don't drag coroutines into a sync helper.
    private fun <T> withTimeoutBlocking(ms: Long, block: () -> T): T {
        val deadline = System.currentTimeMillis() + ms
        // OkHttp call already enforces its own per-request timeout (4s),
        // so this is effectively a no-op guard. Kept for symmetry with
        // future async callers.
        val r = block()
        if (System.currentTimeMillis() > deadline + 500) {
            Log.w(TAG, "doh slow (>${ms}ms)")
        }
        return r
    }
}

/**
 * Parse user-supplied "custom IPs" text into a deduped list of dotted-quad
 * strings. Accepts comma- and newline-separated entries; each entry may be:
 *   - A single IPv4 (1.2.3.4)
 *   - A /24 CIDR (1.2.3.0/24) — expanded to 256 IPs
 *   - A /N CIDR with N in 16..30 — expanded
 * Output is hard-capped to [maxIps] to prevent OOM.
 */
object CustomIpRangeParser {
    fun parse(text: String, maxIps: Int = 4096): List<String> {
        if (text.isBlank()) return emptyList()
        val out = LinkedHashSet<String>()
        text.split('\n', ',', ';', ' ', '\t').forEach { raw ->
            if (out.size >= maxIps) return@forEach
            val token = raw.trim()
            if (token.isBlank()) return@forEach
            if ('/' in token) expandCidr(token, out, maxIps) else if (isValidIpv4(token)) out.add(token)
        }
        return out.take(maxIps)
    }

    private fun expandCidr(cidr: String, out: MutableSet<String>, cap: Int) {
        val (ip, prefixStr) = cidr.split('/', limit = 2).let { it[0] to it.getOrNull(1) }
        if (prefixStr.isNullOrBlank() || !isValidIpv4(ip)) return
        val prefix = prefixStr.toIntOrNull() ?: return
        if (prefix !in 16..32) return
        val parts = ip.split('.').map { it.toInt() }
        val ipInt = (parts[0] shl 24) or (parts[1] shl 16) or (parts[2] shl 8) or parts[3]
        val hostBits = 32 - prefix
        val mask = if (prefix == 0) 0 else (-1 shl hostBits)
        val base = ipInt and mask
        val count = 1 shl hostBits
        for (i in 0 until count) {
            if (out.size >= cap) return
            val v = base or i
            out.add(intToIp(v))
        }
    }

    private fun intToIp(v: Int): String =
        "${(v ushr 24) and 0xff}.${(v ushr 16) and 0xff}.${(v ushr 8) and 0xff}.${v and 0xff}"

    private fun isValidIpv4(s: String): Boolean {
        val p = s.split('.')
        if (p.size != 4) return false
        return p.all { it.toIntOrNull()?.let { n -> n in 0..255 } == true }
    }
}
