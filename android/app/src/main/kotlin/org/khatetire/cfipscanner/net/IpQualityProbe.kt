package org.khatetire.cfipscanner.net

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.Dns
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.khatetire.cfipscanner.vpn.SystemVpnDetector
import java.net.InetAddress
import java.util.concurrent.TimeUnit

/**
 * Measures full quality metrics for one Cloudflare edge IP — equivalent to
 * the desktop scanner's per-IP probe, but without spinning up Xray per IP.
 *
 * Strategy: send all requests to `https://speed.cloudflare.com/...` but use
 * a custom [Dns] that pins the hostname to the target [ip]. The TLS SNI is
 * therefore the real CF anycast hostname (so the cert validates and the CF
 * edge will serve the speed-test endpoints), while the TCP connection
 * actually goes to the IP we want to measure.
 *
 * Sizes are kept small to limit mobile-data consumption:
 *   - Download : 200 KB (best of 2)
 *   - Upload   : 100 KB (best of 2)
 *   - Ping     : 6 × HTTP HEAD to `/__down?bytes=0` (drop 1st as cold-start)
 *
 * Total per-IP data: ~600 KB ((200KB dl ×2) + (100KB ul ×2)) plus a few KB
 * of overhead. Roughly 1/7 of the desktop scanner's footprint.
 */
object IpQualityProbe {

    private const val TAG = "IpQualityProbe"

    private const val SNI_HOST = "speed.cloudflare.com"
    private const val DOWNLOAD_BYTES = 200_000
    private const val UPLOAD_BYTES = 100_000

    private val OCTET = "application/octet-stream".toMediaType()

    data class Quality(
        val ok: Boolean,
        val pingMs: Int = -1,
        val jitterMs: Int = -1,
        val downloadMbps: Double = 0.0,
        val uploadMbps: Double = 0.0,
        val datacenter: String = "",
    )

    /** Run the full probe against [ip]. Returns [Quality.ok]=false if the
     *  edge couldn't even be reached (no ping). All other fields default
     *  to 0 / -1 when individual sub-probes fail.
     *
     *  When [ctx] is non-null the probe sockets are bound to the underlying
     *  ISP network (cellular / Wi-Fi), bypassing any active VPN. This is
     *  required for the scanner to be meaningful: testing a Cloudflare IP
     *  *through* a VPN tunnel measures the tunnel, not the IP. */
    suspend fun probe(ip: String, ctx: Context? = null): Quality = withContext(Dispatchers.IO) {
        val client = buildClient(ip, ctx)

        // 1. Pings (6, drop first)
        val pings = mutableListOf<Long>()
        repeat(6) { i ->
            val ms = pingOnce(client)
            if (ms > 0 && i > 0) pings += ms
            delay(120)
        }
        if (pings.isEmpty()) {
            Log.d(TAG, "$ip: no successful pings, marking unreachable")
            return@withContext Quality(ok = false)
        }
        val avgPing = (pings.sum() / pings.size).toInt()
        val jitter = if (pings.size >= 2) (pings.max() - pings.min()).toInt() else 0

        // 2. Datacenter (cdn-cgi/trace)
        val colo = runCatching { fetchColo(client) }.getOrDefault("")

        // 3. Download (best of 2 small chunks)
        val dl1 = runCatching { measureDownload(client) }.getOrDefault(0.0)
        val dl2 = runCatching { measureDownload(client) }.getOrDefault(0.0)
        val downloadMbps = maxOf(dl1, dl2)

        // 4. Upload (best of 2 small chunks)
        val ul1 = runCatching { measureUpload(client) }.getOrDefault(0.0)
        val ul2 = runCatching { measureUpload(client) }.getOrDefault(0.0)
        val uploadMbps = maxOf(ul1, ul2)

        Quality(
            ok = true,
            pingMs = avgPing,
            jitterMs = jitter,
            downloadMbps = downloadMbps,
            uploadMbps = uploadMbps,
            datacenter = colo,
        )
    }

    private fun buildClient(ip: String, ctx: Context? = null): OkHttpClient {
        val pinned = listOf(InetAddress.getByName(ip))
        val pinningDns = object : Dns {
            override fun lookup(hostname: String): List<InetAddress> =
                if (hostname.equals(SNI_HOST, ignoreCase = true)) pinned
                else Dns.SYSTEM.lookup(hostname)
        }
        val builder = OkHttpClient.Builder()
            .dns(pinningDns)
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .writeTimeout(8, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
        if (ctx != null) {
            val underlying = SystemVpnDetector.underlyingNetwork(ctx)
            if (underlying != null) {
                builder.socketFactory(underlying.socketFactory)
            }
        }
        return builder.build()
    }

    private fun pingOnce(client: OkHttpClient): Long {
        val req = Request.Builder()
            .url("https://$SNI_HOST/__down?bytes=0")
            .head()
            .build()
        val started = System.nanoTime()
        return try {
            client.newCall(req).execute().use { resp ->
                if (resp.isSuccessful || resp.code in 200..399) {
                    (System.nanoTime() - started) / 1_000_000
                } else -1
            }
        } catch (_: Throwable) { -1 }
    }

    private fun fetchColo(client: OkHttpClient): String {
        val req = Request.Builder()
            .url("https://$SNI_HOST/cdn-cgi/trace")
            .build()
        return client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return ""
            val body = resp.body?.string().orEmpty()
            body.lineSequence()
                .firstOrNull { it.startsWith("colo=") }
                ?.substringAfter("colo=")
                ?.trim()
                .orEmpty()
        }
    }

    private fun measureDownload(client: OkHttpClient): Double {
        val req = Request.Builder()
            .url("https://$SNI_HOST/__down?bytes=$DOWNLOAD_BYTES")
            .build()
        val started = System.nanoTime()
        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return 0.0
            val bytes = resp.body?.bytes()?.size?.toLong() ?: 0L
            val ms = (System.nanoTime() - started) / 1_000_000.0
            if (ms <= 0 || bytes <= 0) return 0.0
            // Mbps = bits / seconds / 1e6
            return (bytes * 8.0) / (ms / 1000.0) / 1_000_000.0
        }
    }

    private fun measureUpload(client: OkHttpClient): Double {
        val payload = ByteArray(UPLOAD_BYTES)
        val req = Request.Builder()
            .url("https://$SNI_HOST/__up")
            .post(payload.toRequestBody(OCTET))
            .build()
        val started = System.nanoTime()
        client.newCall(req).execute().use { resp ->
            if (resp.code >= 400) return 0.0
            val ms = (System.nanoTime() - started) / 1_000_000.0
            if (ms <= 0) return 0.0
            return (UPLOAD_BYTES.toLong() * 8.0) / (ms / 1000.0) / 1_000_000.0
        }
    }
}
