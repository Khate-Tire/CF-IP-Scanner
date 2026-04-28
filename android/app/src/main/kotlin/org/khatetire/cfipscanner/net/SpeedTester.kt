package org.khatetire.cfipscanner.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit

/**
 * Lightweight HTTP throughput probe. When [useSocks] is true, the request
 * is routed through the local Xray SOCKS5 inbound on 127.0.0.1:10808 so the
 * measurement reflects the active VPN tunnel.
 */
object SpeedTester {

    /** ~1 MB Cloudflare speed file. */
    private const val URL = "https://speed.cloudflare.com/__down?bytes=1048576"

    data class Result(
        val ok: Boolean,
        val bytes: Long,
        val millis: Long,
        val mbps: Double,
        val error: String? = null,
    )

    suspend fun run(useSocks: Boolean): Result = withContext(Dispatchers.IO) {
        val builder = OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
        if (useSocks) {
            builder.proxy(Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", 10808)))
        }
        val client = builder.build()
        val req = Request.Builder().url(URL).get().build()
        val started = System.nanoTime()
        try {
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    return@withContext Result(false, 0, 0, 0.0, "HTTP ${resp.code}")
                }
                val body = resp.body ?: return@withContext Result(false, 0, 0, 0.0, "empty body")
                val bytes = body.bytes().size.toLong()
                val ms = (System.nanoTime() - started) / 1_000_000
                val mbps = if (ms > 0) (bytes * 8.0) / (ms * 1000.0) else 0.0
                Result(ok = true, bytes = bytes, millis = ms, mbps = mbps)
            }
        } catch (t: Throwable) {
            Result(false, 0, 0, 0.0, t.message ?: t::class.java.simpleName)
        }
    }
}
