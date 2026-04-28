package org.khatetire.cfipscanner.sni

/**
 * SNI fronting bank — mirrors `DEFAULT_SNI_FALLBACK_BANK` in
 * `backend/main.py`. When the primary SNI is DPI-blocked the Xray client
 * rotates `tlsSettings.serverName` through these candidates while keeping the
 * WebSocket `Host:` header pointing at the real server. The original SNI from
 * the bootstrap config is appended as the lowest-priority entry.
 */
object SniBank {
    val DEFAULT: List<String> = listOf(
        "speed.cloudflare.com",
        "cf.090227.xyz",
        "cdnjs.cloudflare.com",
        "www.visa.com.sg",
        "www.icloud.com",
        "discord.com",
    )

    /** Build the rotation list: primary SNI first, then bank, then originalSni. */
    fun rotation(primarySni: String, originalSni: String? = null): List<String> {
        val seen = LinkedHashSet<String>()
        seen.add(primarySni)
        DEFAULT.forEach { seen.add(it) }
        originalSni?.takeIf { it.isNotBlank() }?.let { seen.add(it) }
        return seen.toList()
    }
}
