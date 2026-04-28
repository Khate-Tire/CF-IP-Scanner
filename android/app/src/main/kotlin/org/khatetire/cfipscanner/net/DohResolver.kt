package org.khatetire.cfipscanner.net

import android.util.Log
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.InetAddress
import java.util.concurrent.TimeUnit

/**
 * Resolves a hostname to A/AAAA records via Cloudflare DNS-over-HTTPS
 * (`https://1.1.1.1/dns-query`). Used by the L4-DoH fallback in
 * [DbClient]: when ISP DNS is poisoned for `*.workers.dev`, we ask
 * Cloudflare directly over HTTPS and pin the resulting addresses for the
 * subsequent OkHttp connection. The TLS handshake still validates against
 * the original hostname (we tunnel via `InetAddress.getByAddress(name, ip)`)
 * so no certificate workaround is needed.
 *
 * The 1.1.1.1 endpoint is itself an anycast IP that almost never matches
 * any blocklist, and the DoH response is opaque HTTPS traffic so DPI cannot
 * see the queried name.
 */
object DohResolver {
    private const val TAG = "DohResolver"
    private const val DOH_URL = "https://1.1.1.1/dns-query"

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(7, TimeUnit.SECONDS)
            .build()
    }

    /** Returns an empty list on failure — caller should fall through to the
     *  next layer. Each call is independent (we do not cache across calls;
     *  short-lived in-process caching is enough since the OkHttp client we
     *  build per-layer creates the connection right after). */
    fun resolve(hostname: String): List<InetAddress> {
        // Use the simple JSON API (`?name=...&type=A`). Cloudflare also
        // supports application/dns-message wire format; JSON is plenty for a
        // single A lookup and avoids us pulling a wire-format encoder.
        return try {
            val req = Request.Builder()
                .url("$DOH_URL?name=$hostname&type=A")
                .header("accept", "application/dns-json")
                .get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return emptyList()
                val text = resp.body?.string().orEmpty()
                parseJsonAnswer(hostname, text)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "doh resolve $hostname failed: ${t.message}")
            emptyList()
        }
    }

    /** OkHttp [Dns] adapter that delegates to [resolve] and falls through to
     *  [Dns.SYSTEM] if DoH returns nothing. */
    fun asDns(): Dns = object : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            val viaDoh = resolve(hostname)
            return if (viaDoh.isNotEmpty()) viaDoh else Dns.SYSTEM.lookup(hostname)
        }
    }

    private fun parseJsonAnswer(name: String, body: String): List<InetAddress> {
        // Minimal parser — we only care about the "data":"x.x.x.x" entries
        // in the Answer array. Avoids pulling a JSON serializer at the cost
        // of a small regex.
        val out = mutableListOf<InetAddress>()
        val regex = Regex("\"data\"\\s*:\\s*\"(\\d+\\.\\d+\\.\\d+\\.\\d+)\"")
        for (m in regex.findAll(body)) {
            val ip = m.groupValues[1]
            try {
                val parts = ip.split('.').map { it.toInt().toByte() }.toByteArray()
                out += InetAddress.getByAddress(name, parts)
            } catch (_: Throwable) { /* skip malformed */ }
        }
        return out
    }
}
