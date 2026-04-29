package org.khatetire.cfipscanner.sni

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * Validates a list of user-supplied SNI fronting domains. Default validation
 * profile (set in [Phase A] plan): TLS handshake OK + Cloudflare `cf-ray`
 * header + HTTP/2 negotiated + status code 200 or 204.
 *
 * Pure observer — never mutates settings, never throws. Each domain is
 * checked independently, in parallel, with a hard 6-second per-domain
 * timeout so a hung host can't block the rest.
 */
object SniValidator {

    /** One domain's validation outcome. */
    data class Result(
        val domain: String,
        val ok: Boolean,
        /** Latency of the HEAD request in ms (0 on failure). */
        val latencyMs: Long,
        /** Short reason — UI badge: "✓", or e.g. "no cf-ray", "h1 only". */
        val reason: String,
    )

    private val client = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(4, TimeUnit.SECONDS)
        .writeTimeout(4, TimeUnit.SECONDS)
        .protocols(listOf(Protocol.HTTP_2, Protocol.HTTP_1_1))
        .followRedirects(false)
        .build()

    /** Validate every entry in [domains] in parallel. Order preserved. */
    suspend fun validateAll(domains: Collection<String>): List<Result> = coroutineScope {
        domains.map { d -> async(Dispatchers.IO) { validate(d) } }.awaitAll()
    }

    /** Validate a single domain. Returns [Result] with `ok=false` on any
     *  failure rather than throwing — UI just renders the [Result.reason]. */
    suspend fun validate(domain: String): Result = withContext(Dispatchers.IO) {
        val cleaned = domain.trim().removePrefix("https://").removePrefix("http://")
            .substringBefore('/')
        if (cleaned.isBlank() || !cleaned.contains('.')) {
            return@withContext Result(domain, false, 0, "invalid")
        }
        val started = System.nanoTime()
        val r = withTimeoutOrNull(6_000L) {
            runCatching {
                val req = Request.Builder()
                    .url("https://$cleaned/")
                    .head()
                    .header("User-Agent", "Mozilla/5.0 (compatible; cfipscanner)")
                    .build()
                client.newCall(req).execute().use { resp ->
                    val proto = resp.protocol
                    val cfRay = resp.header("cf-ray")
                    val code = resp.code
                    when {
                        cfRay.isNullOrBlank() -> "no cf-ray"
                        proto != Protocol.HTTP_2 -> "h1 only"
                        code != 200 && code != 204 -> "http $code"
                        else -> null  // success
                    }
                }
            }.getOrElse { it.message ?: "error" }
        } ?: "timeout"
        val ms = (System.nanoTime() - started) / 1_000_000
        if (r == null) Result(cleaned, true, ms, "✓")
        else Result(cleaned, false, ms, r)
    }

    /** Convenience: returns just the domains that passed validation. */
    suspend fun validDomains(domains: Collection<String>): List<String> =
        validateAll(domains).filter { it.ok }.map { it.domain }
}
