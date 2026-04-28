package org.khatetire.cfipscanner.xray

import android.content.Context
import android.util.Log
import org.khatetire.cfipscanner.bootstrap.BootstrapLoader
import java.net.InetSocketAddress

/**
 * Dedicated Xray-core instance that exists **only to fetch the community
 * DB over a VLESS tunnel**. Mirrors the desktop app's "Layer 4: VLESS
 * Tunnel" DB connection — works even when the user's main VPN is OFF.
 *
 * Lifecycle:
 *   - Lazily started on the first call to [ensureRunning].
 *   - Kept warm for the lifetime of the process to avoid the 2–5 s cold
 *     start on every DB refresh.
 *   - Listens on [HTTP_PORT] (loopback only) — distinct from the main
 *     VPN's 10809 inbound so the two cores can coexist.
 */
object DbTunnel {

    private const val TAG = "DbTunnel"

    /** Loopback HTTP inbound port. Must NOT collide with the main VPN's
     *  [XrayConfigBuilder.HTTP_PORT] (10809). */
    const val HTTP_PORT = 10810

    @Volatile private var controller: XrayController? = null
    @Volatile private var startAttempted = false

    /** Starts the parallel Xray instance if not already running. Returns
     *  true when the proxy is ready. Safe to call from any thread. */
    @Synchronized
    fun ensureRunning(ctx: Context): Boolean {
        controller?.let { if (it.isRunning()) return true }
        if (startAttempted && controller == null) {
            // Previous attempt failed — retry once per process to avoid
            // hammering libv2ray when the AAR is missing.
            return false
        }
        val cfg = BootstrapLoader.fallback() ?: run {
            Log.w(TAG, "no bootstrap fallback config; cannot start DB tunnel")
            return false
        }
        val json = XrayConfigBuilder.buildForDb(cfg, httpPort = HTTP_PORT)
        val xray = XrayController(ctx.applicationContext)
        if (!xray.isAvailable()) {
            Log.w(TAG, "libv2ray not bundled; DB tunnel unavailable")
            startAttempted = true
            return false
        }
        val ok = xray.start(json)
        startAttempted = true
        if (ok) {
            controller = xray
            Log.i(TAG, "DB tunnel started on 127.0.0.1:$HTTP_PORT")
        } else {
            Log.w(TAG, "DB tunnel start failed")
        }
        return ok
    }

    /** Returns the loopback proxy address if the tunnel is running, else
     *  null. Callers should treat null as "fall back to next layer". */
    fun httpProxyAddress(ctx: Context): InetSocketAddress? {
        return if (ensureRunning(ctx))
            InetSocketAddress("127.0.0.1", HTTP_PORT)
        else null
    }

    /** Manually tear down — only useful for tests / shutdown. */
    @Synchronized
    fun stop() {
        controller?.stop()
        controller = null
        startAttempted = false
    }
}
