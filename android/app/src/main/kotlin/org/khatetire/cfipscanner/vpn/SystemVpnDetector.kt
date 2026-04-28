package org.khatetire.cfipscanner.vpn

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build

/**
 * Detects whether *any* VpnService (this app's own [CfVpnService] OR an
 * external client like Hiddify, NekoBox, system Always-on VPN, etc.) is
 * currently active. Used by [org.khatetire.cfipscanner.net.DbClient] to
 * decide whether to attempt direct, proxy-routed, or DoH paths to the DB
 * worker — when an external VPN is up, our HTTP traffic is *already*
 * tunneled by the OS, so the canonical worker URL usually resolves cleanly
 * without needing the local Xray inbound proxy.
 */
object SystemVpnDetector {
    /** True iff at least one active network advertises the VPN transport. */
    fun isAnyVpnActive(ctx: Context): Boolean {
        return try {
            val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val nets = cm.allNetworks
                for (n in nets) {
                    val caps = cm.getNetworkCapabilities(n) ?: continue
                    if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return true
                }
                false
            } else {
                // Pre-M: fall back to checking the active network info directly.
                @Suppress("DEPRECATION")
                cm.activeNetworkInfo?.type == ConnectivityManager.TYPE_VPN
            }
        } catch (_: Throwable) {
            false
        }
    }

    /**
     * Returns the first active non-VPN [Network] (cellular or Wi-Fi) the
     * device has, or `null` if only VPN networks are up. Used by the
     * scanner so per-IP probes go over the user's NATIVE ISP — testing a
     * Cloudflare IP from inside a VPN tunnel is meaningless because the
     * tunnel itself rewrites the path. Requires API 23 (M); earlier APIs
     * return null and callers should fall back to plain OkHttp.
     */
    fun underlyingNetwork(ctx: Context): Network? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null
        return try {
            val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return null
            cm.allNetworks.firstOrNull { n ->
                val caps = cm.getNetworkCapabilities(n) ?: return@firstOrNull false
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                    caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN) &&
                    !caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
            }
        } catch (_: Throwable) {
            null
        }
    }
}
