package org.khatetire.cfipscanner.model

/**
 * Parsed VLESS+WS+TLS endpoint. **Sensitive** when sourced from the bootstrap
 * blob — never log, copy, share, or display fields directly. The custom
 * [toString] returns a redacted form; ProGuard rules also strip it in release.
 */
data class VlessConfig(
    val uuid: String,
    val host: String,           // server address — IP or hostname
    val port: Int,
    val sni: String,            // tlsSettings.serverName
    val wsHost: String,         // wsSettings.headers.Host
    val wsPath: String,
    val fingerprint: String = "chrome",
    val alpn: List<String> = listOf("http/1.1"),
    val allowInsecure: Boolean = false,
    val tag: String = "proxy",
) {
    /** Human-safe label. NEVER include UUID, host, port, sni, or path. */
    val displaySlot: String get() = "EU-1"

    override fun toString(): String =
        "VlessConfig(slot=$displaySlot, sni=***, host=***, uuid=***)"

    companion object {
        /**
         * Parse a `vless://` URI. Drops the `#` fragment. Throws on malformed
         * input. Caller is responsible for treating the result as confidential.
         */
        fun parse(uri: String): VlessConfig {
            val cleaned = uri.trim().substringBefore('#')
            require(cleaned.startsWith("vless://")) { "not a vless uri" }
            val body = cleaned.removePrefix("vless://")
            val atIdx = body.indexOf('@')
            require(atIdx > 0) { "missing user@host" }
            val uuid = body.substring(0, atIdx)
            val rest = body.substring(atIdx + 1)
            val qIdx = rest.indexOf('?')
            val hostPort = if (qIdx >= 0) rest.substring(0, qIdx) else rest
            val query = if (qIdx >= 0) rest.substring(qIdx + 1) else ""
            val (host, portStr) = hostPort.split(":", limit = 2).let {
                require(it.size == 2) { "missing port" }
                it[0] to it[1]
            }
            val params = query.split('&').filter { it.isNotEmpty() }.associate {
                val (k, v) = it.split("=", limit = 2).let { p -> p[0] to (p.getOrNull(1) ?: "") }
                k to java.net.URLDecoder.decode(v, "UTF-8")
            }
            return VlessConfig(
                uuid = uuid,
                host = host,
                port = portStr.toInt(),
                sni = params["sni"] ?: host,
                wsHost = params["host"] ?: params["sni"] ?: host,
                wsPath = params["path"] ?: "/",
                fingerprint = params["fp"] ?: "chrome",
                alpn = params["alpn"]?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }
                    ?: listOf("http/1.1"),
                allowInsecure = (params["allowInsecure"] ?: params["insecure"] ?: "0") == "1",
            )
        }
    }
}
