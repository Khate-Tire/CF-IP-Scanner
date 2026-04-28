package org.khatetire.cfipscanner.vpn

import android.util.Log
import java.io.File

/**
 * Wrapper around the `hev-socks5-tunnel` native library that bridges a TUN
 * file descriptor (from VpnService.Builder.establish()) to a local SOCKS5
 * inbound (Xray's `socks-in`).
 *
 * Library file: `libhev-socks5-tunnel.so` placed in
 * `app/src/main/jniLibs/<abi>/` for each ABI we ship.
 *
 * If the .so is missing, [isAvailable] is false and [start] returns false —
 * the VPN service will surface a clean failure to the UI without crashing.
 */
object Tun2SocksController {
    private const val TAG = "Tun2Socks"
    // The v2rayNG .so registers natives onto com.v2ray.ang.service.TProxyService.
    private const val NATIVE_LIB = "hev-socks5-tunnel"

    private val available: Boolean by lazy {
        try {
            System.loadLibrary(NATIVE_LIB)
            Log.i(TAG, "loaded lib$NATIVE_LIB.so")
            true
        } catch (t: Throwable) {
            Log.w(TAG, "lib$NATIVE_LIB.so not present: ${t.message}"); false
        }
    }

    private var running = false

    fun isAvailable(): Boolean = available

    /**
     * Starts the tunnel. Writes a YAML config to [configDir]/tun2socks.yaml
     * pointing at `127.0.0.1:[socksPort]`, then hands the [tunFd] to the
     * native code (which dup's the fd, so caller still owns it).
     */
    fun start(
        configDir: File,
        tunFd: Int,
        mtu: Int = 1500,
        socksHost: String = "127.0.0.1",
        socksPort: Int = 10808,
    ): Boolean {
        if (!available) return false
        if (running) return true
        return try {
            val cfg = File(configDir, "tun2socks.yaml")
            cfg.writeText(buildYaml(mtu, socksHost, socksPort))
            com.v2ray.ang.service.TProxyService.TProxyStartService(cfg.absolutePath, tunFd)
            running = true
            true
        } catch (t: Throwable) {
            Log.e(TAG, "tun2socks start failed: ${t.message}", t)
            false
        }
    }

    fun stop() {
        if (!available || !running) return
        try { com.v2ray.ang.service.TProxyService.TProxyStopService() } catch (t: Throwable) {
            Log.w(TAG, "tun2socks stop threw: ${t.message}")
        }
        running = false
    }

    private fun buildYaml(mtu: Int, host: String, port: Int): String = """
tunnel:
  mtu: $mtu
socks5:
  port: $port
  address: $host
  udp: 'udp'
misc:
  task-stack-size: 81920
  log-level: warn
""".trimIndent()
}
