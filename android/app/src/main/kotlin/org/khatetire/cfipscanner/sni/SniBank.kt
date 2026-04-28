package org.khatetire.cfipscanner.sni

/**
 * SNI fronting bank — mirrors `DEFAULT_SNI_FALLBACK_BANK` in
 * `backend/main.py`. When the primary SNI is DPI-blocked the Xray client
 * rotates `tlsSettings.serverName` through these candidates while keeping the
 * WebSocket `Host:` header pointing at the real server. The original SNI from
 * the bootstrap config is appended as the lowest-priority entry.
 *
 * Selection criteria (high-collateral-damage SNIs):
 *   1. Domain is served by Cloudflare's edge (so the TLS handshake on a
 *      Cloudflare anycast IP completes with a valid cert).
 *   2. Blocking the SNI would break too much mass traffic to be politically
 *      viable for an ISP/firewall (e.g. Cloudflare's own properties,
 *      Cloudflare-fronted developer tooling that local devs rely on,
 *      mainstream consumer apps with millions of users in the region).
 *   3. The TLS ServerName plaintext appears in normal user traffic so DPI
 *      whitelist heuristics will not flag it as an obfuscation tunnel.
 *
 * Notes for blocked regions (RU/IR/TR/CN): mainstream regional sites
 * (Yandex, Aparat, Divar, Trendyol, etc.) usually run on local CDNs and
 * are NOT Cloudflare customers, so they cannot serve as SNI fronts here.
 * The list below sticks to globally-distributed Cloudflare customers that
 * are typically reachable even from inside heavy DPI environments.
 */
object SniBank {
    val DEFAULT: List<String> = listOf(
        // ---- Cloudflare-owned (always present on every CF anycast IP) ----
        "speed.cloudflare.com",
        "www.cloudflare.com",
        "developers.cloudflare.com",
        "workers.cloudflare.com",
        "ajax.cloudflare.com",
        "cdnjs.cloudflare.com",
        "challenges.cloudflare.com",
        "one.one.one.one",
        "1.1.1.1",
        // ---- Mainstream consumer apps fronted by Cloudflare ----
        "discord.com",
        "discordapp.com",
        "patreon.com",
        "linktr.ee",
        "canva.com",
        "udemy.com",
        "medium.com",
        "coursera.org",
        "producthunt.com",
        "ycombinator.com",
        "imgur.com",
        // ---- Developer / SaaS tooling on Cloudflare ----
        "npmjs.com",
        "statuspage.io",
        "atlassian.com",
        "typeform.com",
        "bitwarden.com",
        // ---- Public CDNs / static assets ----
        "cdn.jsdelivr.net",
        "fonts.bunny.net",
        // ---- Legacy fallbacks (kept for compatibility) ----
        "cf.090227.xyz",
        "www.visa.com.sg",
        "www.icloud.com",
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
