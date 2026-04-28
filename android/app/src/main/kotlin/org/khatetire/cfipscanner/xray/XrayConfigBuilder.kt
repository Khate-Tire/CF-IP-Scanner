package org.khatetire.cfipscanner.xray

import org.json.JSONArray
import org.json.JSONObject
import org.khatetire.cfipscanner.model.VlessConfig

/**
 * Builds an Xray-core JSON config for VLESS+WS+TLS. Mirrors the shape that
 * `backend/scanner.py :: generate_xray_config` produces in the desktop app.
 *
 * `frontOnlyTls=true` overrides ONLY `tlsSettings.serverName` with [overrideSni]
 * while keeping the WebSocket `Host:` header pointing at the original
 * [VlessConfig.wsHost]. This matches the SNI-fronting fallback behaviour
 * shipped to the desktop scanner.
 */
object XrayConfigBuilder {

    /** Local SOCKS5 inbound used by tun2socks. Keep in sync with [SOCKS_PORT]. */
    const val SOCKS_HOST = "127.0.0.1"
    const val SOCKS_PORT = 10808
    const val HTTP_PORT = 10809

    fun build(
        cfg: VlessConfig,
        overrideSni: String? = null,
        frontOnlyTls: Boolean = false,
        verifyTls: Boolean = true,
    ): String {
        val sni = overrideSni ?: cfg.sni
        val wsHost = if (frontOnlyTls) cfg.wsHost else (overrideSni ?: cfg.wsHost)

        val log = JSONObject().put("loglevel", "warning")

        val inbounds = JSONArray().put(
            JSONObject()
                .put("tag", "socks-in")
                .put("port", SOCKS_PORT)
                .put("listen", SOCKS_HOST)
                .put("protocol", "socks")
                .put("settings", JSONObject().put("udp", true).put("auth", "noauth"))
                .put("sniffing", JSONObject().put("enabled", true)
                    .put("destOverride", JSONArray().put("http").put("tls")))
        ).put(
            JSONObject()
                .put("tag", "http-in")
                .put("port", HTTP_PORT)
                .put("listen", SOCKS_HOST)
                .put("protocol", "http")
                .put("settings", JSONObject().put("allowTransparent", false))
        )

        val outbounds = JSONArray().put(
            JSONObject()
                .put("tag", cfg.tag)
                .put("protocol", "vless")
                .put("settings", JSONObject().put("vnext", JSONArray().put(
                    JSONObject()
                        .put("address", cfg.host)
                        .put("port", cfg.port)
                        .put("users", JSONArray().put(
                            JSONObject()
                                .put("id", cfg.uuid)
                                .put("encryption", "none")
                                .put("level", 0)
                        ))
                )))
                .put("streamSettings", JSONObject()
                    .put("network", "ws")
                    .put("security", "tls")
                    .put("tlsSettings", JSONObject()
                        .put("serverName", sni)
                        .put("allowInsecure", cfg.allowInsecure || !verifyTls)
                        .put("fingerprint", cfg.fingerprint)
                        .put("alpn", JSONArray().also { a -> cfg.alpn.forEach(a::put) })
                    )
                    .put("wsSettings", JSONObject()
                        .put("path", cfg.wsPath)
                        .put("headers", JSONObject().put("Host", wsHost))
                    )
                )
        ).put(
            JSONObject().put("tag", "direct").put("protocol", "freedom")
        ).put(
            JSONObject().put("tag", "block").put("protocol", "blackhole")
        )

        return JSONObject()
            .put("log", log)
            .put("inbounds", inbounds)
            .put("outbounds", outbounds)
            .toString()
    }
}
