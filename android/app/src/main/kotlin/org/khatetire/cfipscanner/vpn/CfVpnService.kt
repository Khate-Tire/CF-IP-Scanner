package org.khatetire.cfipscanner.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import android.net.TrafficStats
import android.os.Process
import org.khatetire.cfipscanner.MainActivity
import org.khatetire.cfipscanner.R
import org.khatetire.cfipscanner.bootstrap.BootstrapLoader
import org.khatetire.cfipscanner.bootstrap.BootstrapPolicy
import org.khatetire.cfipscanner.model.VlessConfig
import org.khatetire.cfipscanner.net.DbClient
import org.khatetire.cfipscanner.settings.AppSettings
import org.khatetire.cfipscanner.sni.SniBank
import org.khatetire.cfipscanner.xray.XrayConfigBuilder
import org.khatetire.cfipscanner.xray.XrayController

/**
 * Foreground VPN service. Lifecycle:
 *   1. [ACTION_CONNECT] → load bootstrap (or future L1–L5 result), start Xray
 *      with SOCKS5 inbound, build VPN interface, hand FD to tun2socks.
 *   2. Persistent notification shows redacted state only.
 *   3. [ACTION_DISCONNECT] → tear everything down.
 *
 * Phase 1 scope: the tun2socks bridge is a TODO (`hev-socks5-tunnel` JNI is
 * dropped in alongside libXray — see `android/README.md`). The VPN interface
 * is created and Xray's SOCKS5 inbound starts so end-to-end wiring is
 * exercised; tun → SOCKS plumbing arrives with the libs.
 */
class CfVpnService : VpnService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var tunFd: ParcelFileDescriptor? = null
    private val xray by lazy { XrayController(applicationContext) }
    private var connectJob: Job? = null
    private var telemetryJob: Job? = null
    private var improveJob: Job? = null
    private var rotateJob: Job? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    /** Mutable holder so [AdaptiveConnectController.improvementLoop] can read
     *  the live config and the swap callback can mutate it. */
    @Volatile private var liveCfg: VlessConfig? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_DISCONNECT -> {
                shutdown()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_APPLY_MANUAL_IP -> {
                applyManualIp()
                return START_STICKY
            }
            ACTION_ROTATE -> {
                forceRotateNow()
                return START_STICKY
            }
            else -> startConnect()
        }
        return START_STICKY
    }

    private fun startConnect() {
        // Re-entry guard: ignore duplicate ACTION_CONNECT intents while we are
        // already mid-handshake or already up. Prevents the "double startConnect"
        // observed in logcat when the user taps the orb twice in quick succession.
        val currentState = VpnStateHolder.status.value.state
        if (currentState == VpnStatus.State.CONNECTING ||
            currentState == VpnStatus.State.CONNECTED) {
            Log.i(TAG, "startConnect ignored (already $currentState)")
            return
        }
        Log.i(TAG, "startConnect")
        VpnStateHolder.update { it.copy(state = VpnStatus.State.CONNECTING, failureReason = "") }
        startForegroundCompat(buildNotification(VpnStatus(state = VpnStatus.State.CONNECTING)))

        connectJob?.cancel()
        connectJob = scope.launch {
            val slot = runCatching { AppSettings.current().selectedSlot }.getOrDefault(1)
            val cfg = AdaptiveConnectController.bestNow(applicationContext, slot)
            if (cfg == null) {
                Log.e(TAG, "AdaptiveConnect.bestNow returned null (bootstrap empty?)")
                VpnStateHolder.fail("No server config (bootstrap empty)")
                updateNotification()
                return@launch
            }
            liveCfg = cfg
            Log.i(TAG, "using config slot=${cfg.displaySlot} host=${cfg.host}")
            // SNI fronting is OPT-IN. When disabled (default) we hand the
            // config's own SNI straight to Xray. When enabled with at least
            // one user-supplied domain we override TLS serverName only
            // (frontOnlyTls=true) so the WS Host: header still points at the
            // real backend.
            val s = AppSettings.current()
            val userSni: String? = if (s.sniFrontingEnabled)
                s.sniUserDomains.firstOrNull { it.isNotBlank() } else null
            val xrayJson = XrayConfigBuilder.build(
                cfg = cfg,
                overrideSni = userSni,
                frontOnlyTls = userSni != null,
                verifyTls = !cfg.allowInsecure,
            )
            if (!xray.start(xrayJson, "${cfg.host}:${cfg.port}")) {
                Log.e(TAG, "Xray start failed (libv2ray missing or API mismatch?)")
                VpnStateHolder.fail("Xray core failed to start")
                updateNotification()
                return@launch
            }
            // Bug fix (v2.3.1): Xray.start() returning true only means the
            // reflective call did not throw — it does not guarantee the
            // SOCKS inbound is actually listening. If the JSON config is
            // malformed or the port is taken, Xray will silently emit an
            // error and never bind. Probe the inbound for up to 2s before
            // handing the TUN fd to tun2socks (which would otherwise route
            // every packet to a black hole).
            val socksReady = waitForSocksReady(
                XrayConfigBuilder.SOCKS_HOST, XrayConfigBuilder.SOCKS_PORT, 2_000L,
            )
            if (!socksReady) {
                Log.e(TAG, "Xray SOCKS inbound never bound on ${XrayConfigBuilder.SOCKS_HOST}:${XrayConfigBuilder.SOCKS_PORT}")
                xray.stop()
                VpnStateHolder.fail("Xray inbound 127.0.0.1:${XrayConfigBuilder.SOCKS_PORT} never bound (config error?)")
                updateNotification()
                return@launch
            }
            tunFd = buildVpnInterface()
            val fd = tunFd?.fd
            if (fd == null) {
                Log.e(TAG, "buildVpnInterface returned null")
                xray.stop()
                VpnStateHolder.fail("VpnService.establish() returned null (revoked?)")
                updateNotification()
                return@launch
            }
            Log.i(TAG, "tun fd=$fd, starting tun2socks")
            val tunOk = Tun2SocksController.start(
                configDir = applicationContext.cacheDir,
                tunFd = fd,
                mtu = 1500,
                socksHost = XrayConfigBuilder.SOCKS_HOST,
                socksPort = XrayConfigBuilder.SOCKS_PORT,
            )
            if (!tunOk) {
                Log.e(TAG, "tun2socks start failed (libhev-socks5-tunnel missing?)")
                try { tunFd?.close() } catch (_: Throwable) {}
                tunFd = null
                xray.stop()
                val reason = if (!Tun2SocksController.isAvailable())
                    "libhev-socks5-tunnel.so missing for this ABI"
                else "tun2socks.start() returned false"
                VpnStateHolder.fail(reason)
                updateNotification()
                return@launch
            }
            Log.i(TAG, "CONNECTED")

            VpnStateHolder.update {
                it.copy(state = VpnStatus.State.CONNECTED, serverSlot = cfg.displaySlot,
                        cleanIp = cfg.host,
                        uptimeSec = 0L, bytesIn = 0L, bytesOut = 0L,
                        rateInBps = 0L, rateOutBps = 0L)
            }
            updateNotification()
            startTelemetry()
            startImprovementLoop()
            registerNetworkCallback()
        }
    }

    /** Background hot-swap loop: probes top candidates every 30s and restarts
     *  Xray (only) when a measurably better edge IP is found. */
    private fun startImprovementLoop() {
        improveJob?.cancel()
        improveJob = scope.launch {
            AdaptiveConnectController.improvementLoop(
                ctx = applicationContext,
                currentRef = { liveCfg },
                onSwap = { newCfg -> hotSwapXray(newCfg) },
            )
        }
    }

    /** Restart Xray (only) with [newCfg]. tun + tun2socks are left untouched
     *  so the swap blip is only the Xray restart latency (~1s). */
    private suspend fun hotSwapXray(newCfg: VlessConfig) {
        Log.i(TAG, "hotSwapXray -> ${newCfg.host}")
        try {
            xray.stop()
            val s = AppSettings.current()
            val userSni: String? = if (s.sniFrontingEnabled)
                s.sniUserDomains.firstOrNull { it.isNotBlank() } else null
            val xrayJson = XrayConfigBuilder.build(
                cfg = newCfg,
                overrideSni = userSni,
                frontOnlyTls = userSni != null,
                verifyTls = !newCfg.allowInsecure,
            )
            if (xray.start(xrayJson, "${newCfg.host}:${newCfg.port}")) {
                liveCfg = newCfg
                VpnStateHolder.update { it.copy(serverSlot = newCfg.displaySlot, cleanIp = newCfg.host) }
                updateNotification()
            } else {
                Log.w(TAG, "hotSwap: xray restart failed, keeping previous host")
            }
        } catch (t: Throwable) {
            Log.w(TAG, "hotSwap error: ${t.message}")
        }
    }

    /** Force a one-shot best-IP search and hot-swap to the winner. Triggered
     *  from the QS tile, the notification "Rotate" action, or a network change. */
    private fun forceRotateNow() {
        val state = VpnStateHolder.status.value.state
        if (state != VpnStatus.State.CONNECTED) {
            Log.i(TAG, "forceRotateNow: not connected, ignoring")
            return
        }
        if (AppSettings.current().manualCleanIp.isNotBlank()) {
            Log.i(TAG, "forceRotateNow: manual IP pinned, ignoring")
            return
        }
        rotateJob?.cancel()
        rotateJob = scope.launch {
            val slot = runCatching { AppSettings.current().selectedSlot }.getOrDefault(0)
            val cur = liveCfg ?: return@launch
            val fresh = AdaptiveConnectController.bestNow(applicationContext, slot) ?: return@launch
            if (fresh.host == cur.host) {
                Log.i(TAG, "forceRotateNow: best is still ${cur.host}")
                return@launch
            }
            Log.i(TAG, "forceRotateNow: ${cur.host} -> ${fresh.host}")
            hotSwapXray(fresh)
        }
    }

    /** Register a [ConnectivityManager.NetworkCallback] so that whenever the
     *  underlying network changes (Wi-Fi <-> cellular, captive portal exit,
     *  etc.) we re-evaluate the best clean IP and hot-swap if a faster one is
     *  available. Disabled when the user turns off auto-reconnect. */
    private fun registerNetworkCallback() {
        if (networkCallback != null) return
        if (!AppSettings.current().autoReconnectOnNetChange) return
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        val req = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        val cb = object : ConnectivityManager.NetworkCallback() {
            private var lastNet: Network? = null
            override fun onAvailable(network: Network) {
                if (lastNet != null && lastNet != network) {
                    Log.i(TAG, "network changed -> rotate probe")
                    forceRotateNow()
                }
                lastNet = network
            }
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                // Wi-Fi <-> cellular transitions surface here too.
                if (lastNet == null) lastNet = network
            }
        }
        try {
            cm.registerNetworkCallback(req, cb)
            networkCallback = cb
        } catch (t: Throwable) {
            Log.w(TAG, "registerNetworkCallback failed: ${t.message}")
        }
    }

    private fun unregisterNetworkCallback() {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        val cb = networkCallback ?: return
        runCatching { cm.unregisterNetworkCallback(cb) }
        networkCallback = null
    }

    /** Apply (or clear) the user's manual clean-IP override on a live tunnel.
     *  No-op if VPN isn't connected. When the manual field is cleared we revert
     *  to the bootstrap host for the active slot. */
    private fun applyManualIp() {
        val state = VpnStateHolder.status.value.state
        if (state != VpnStatus.State.CONNECTED) {
            Log.i(TAG, "applyManualIp: VPN not connected, will pick up on next connect")
            return
        }
        val cur = liveCfg ?: return
        scope.launch {
            val manual = AppSettings.current().manualCleanIp.trim()
            val target = if (manual.isNotEmpty()) {
                // Manual IP must be paired with the always-on fallback's
                // UUID/SNI/path or the VLESS handshake fails.
                val authBase = BootstrapLoader.fallback() ?: cur
                authBase.copy(host = manual)
            } else {
                // Cleared → fall back to the bootstrap host for the selected slot.
                val slot = AppSettings.current().selectedSlot
                val bootstrap = BootstrapLoader.load(applicationContext)
                val base = bootstrap.getOrNull(slot.coerceIn(0, bootstrap.lastIndex.coerceAtLeast(0))) ?: cur
                cur.copy(host = base.host)
            }
            if (target.host == cur.host) {
                Log.i(TAG, "applyManualIp: host unchanged (${cur.host})")
                return@launch
            }
            hotSwapXray(target)
        }
    }

    /** Periodic 1-Hz pump that updates uptime + byte counters + rates. */
    private fun startTelemetry() {
        telemetryJob?.cancel()
        val uid = Process.myUid()
        val baseRx = TrafficStats.getUidRxBytes(uid).coerceAtLeast(0)
        val baseTx = TrafficStats.getUidTxBytes(uid).coerceAtLeast(0)
        val started = android.os.SystemClock.elapsedRealtime()
        var lastRx = baseRx
        var lastTx = baseTx
        telemetryJob = scope.launch {
            while (isActive) {
                delay(1000)
                val rx = TrafficStats.getUidRxBytes(uid).coerceAtLeast(0)
                val tx = TrafficStats.getUidTxBytes(uid).coerceAtLeast(0)
                val dRx = (rx - lastRx).coerceAtLeast(0)
                val dTx = (tx - lastTx).coerceAtLeast(0)
                lastRx = rx; lastTx = tx
                val up = (android.os.SystemClock.elapsedRealtime() - started) / 1000
                VpnStateHolder.update {
                    if (it.state != VpnStatus.State.CONNECTED) it
                    else it.copy(
                        uptimeSec = up,
                        bytesIn = (rx - baseRx).coerceAtLeast(0),
                        bytesOut = (tx - baseTx).coerceAtLeast(0),
                        rateInBps = dRx,
                        rateOutBps = dTx,
                    )
                }
            }
        }
    }

    /**
     * Phase 2: pull a fresh edge IP from [DbClient] (5-layer fallback) and
     * substitute it into the chosen bootstrap slot. SNI / UUID / WS path
     * remain from the bootstrap so TLS+VLESS auth still succeeds. If
     * DbClient returns nothing (no DB configured + empty cache), we fall
     * back to the bootstrap host as-is.
     */
    private suspend fun pickConfig(slot: Int = 1): VlessConfig? {
        val bootstrap = BootstrapLoader.load(applicationContext)
        BootstrapPolicy.markBootstrap(bootstrap)
        if (bootstrap.isEmpty()) {
            Log.w(TAG, "pickConfig: bootstrap empty (slot=$slot, set BOOTSTRAP_VLESS_CONFIGS)")
            return null
        }
        val effectiveSlot = slot.coerceIn(0, bootstrap.lastIndex)
        Log.i(TAG, "pickConfig: requested slot=$slot, effective=$effectiveSlot of ${bootstrap.size}")
        val base = bootstrap[effectiveSlot]

        // Locally-validated pool wins over the remote DB (see
        // AdaptiveConnectController.bestNow for the same rationale).
        val poolBest = runCatching {
            org.khatetire.cfipscanner.data.IpPoolStore.bestIp(applicationContext)
        }.getOrNull()
        if (!poolBest.isNullOrBlank()) {
            Log.i(TAG, "pickConfig: pool clean IP -> $poolBest")
            return base.copy(host = poolBest)
        }
        val picks = runCatching { DbClient.bestIps(applicationContext, limit = 5) }
            .getOrNull()
        val freshIp = picks?.rawIps?.firstOrNull()
        return if (freshIp.isNullOrBlank()) base else base.copy(host = freshIp)
    }

    private fun buildVpnInterface(): ParcelFileDescriptor? {
        val builder = Builder()
            .setSession(getString(R.string.app_name))
            .setMtu(1500)
            .addAddress("10.10.10.2", 32)
            .addRoute("0.0.0.0", 0)
            .addRoute("::", 0)
            .addDnsServer("1.1.1.1")
            .addDnsServer("1.0.0.1")
            .addDisallowedApplication(packageName) // never tunnel ourselves
        // Per-app split tunneling: exclude packages the user picked.
        val excluded = runCatching { AppSettings.current().excludedApps }.getOrDefault(emptySet())
        for (pkg in excluded) {
            if (pkg.isBlank() || pkg == packageName) continue
            try {
                builder.addDisallowedApplication(pkg)
            } catch (e: PackageManager.NameNotFoundException) {
                Log.w(TAG, "excluded package not installed: $pkg")
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) builder.setMetered(false)
        return builder.establish()
    }

    private fun shutdown() {
        VpnStateHolder.setState(VpnStatus.State.DISCONNECTING)
        unregisterNetworkCallback()
        telemetryJob?.cancel(); telemetryJob = null
        improveJob?.cancel(); improveJob = null
        rotateJob?.cancel(); rotateJob = null
        liveCfg = null
        connectJob?.cancel()
        Tun2SocksController.stop()
        try { tunFd?.close() } catch (_: Throwable) {}
        tunFd = null
        xray.stop()
        VpnStateHolder.update { VpnStatus(state = VpnStatus.State.IDLE) }
        updateNotification()
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    override fun onDestroy() {
        shutdown()
        scope.cancel()
        super.onDestroy()
    }

    override fun onRevoke() {
        // System or another VPN app revoked us — go away cleanly.
        shutdown()
        stopSelf()
        super.onRevoke()
    }

    // -------------------------------------------------------------------------
    // Notification — intentionally redacted (no SNI/host/IP/UUID).
    // -------------------------------------------------------------------------
    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.notif_channel_vpn),
                NotificationManager.IMPORTANCE_LOW).apply {
                description = getString(R.string.notif_channel_vpn_desc)
                setShowBadge(false)
            }
        )
    }

    private fun buildNotification(s: VpnStatus): Notification {
        ensureChannel()
        val text = when (s.state) {
            VpnStatus.State.CONNECTED ->
                getString(R.string.notif_text_connected, s.colo.ifBlank { "—" }, s.pingMs)
            VpnStatus.State.CONNECTING -> getString(R.string.notif_text_connecting)
            else -> getString(R.string.app_name)
        }
        val openApp = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val disconnect = PendingIntent.getService(
            this, 1,
            Intent(this, CfVpnService::class.java).setAction(ACTION_DISCONNECT),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val rotate = PendingIntent.getService(
            this, 2,
            Intent(this, CfVpnService::class.java).setAction(ACTION_ROTATE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_vpn)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(text)
            .setContentIntent(openApp)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        if (s.state == VpnStatus.State.CONNECTED) {
            builder.addAction(0, getString(R.string.notif_action_rotate), rotate)
        }
        builder.addAction(0, getString(R.string.notif_action_disconnect), disconnect)
        return builder.build()
    }

    private fun updateNotification() {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        nm.notify(NOTIF_ID, buildNotification(VpnStateHolder.status.value))
    }

    /**
     * Polls 127.0.0.1:[port] until a TCP connection succeeds or [timeoutMs]
     * elapses. Used to confirm Xray's SOCKS inbound is actually listening
     * before handing the TUN fd to tun2socks.
     */
    private suspend fun waitForSocksReady(host: String, port: Int, timeoutMs: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            try {
                java.net.Socket().use { sock ->
                    sock.connect(java.net.InetSocketAddress(host, port), 250)
                    return true
                }
            } catch (_: Throwable) {
                delay(75)
            }
        }
        return false
    }

    /**
     * Bug fix (v2.3.1): the manifest declares
     * `foregroundServiceType="specialUse"` so on Android 14+ (API 34+) we
     * MUST call the 3-arg [startForeground] with a matching service type,
     * and silently kills the service before any handshake can complete.
     * On older API levels the 2-arg form is correct.
     */
    private fun startForegroundCompat(notif: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            try {
                startForeground(
                    NOTIF_ID, notif,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                )
            } catch (t: Throwable) {
                Log.e(TAG, "startForeground(typed) failed: ${t.message}", t)
                // Last-ditch fallback: try the 2-arg form. If that also
                // throws the service will die — surface the reason to UI.
                try { startForeground(NOTIF_ID, notif) }
                catch (t2: Throwable) {
                    VpnStateHolder.fail("startForeground denied: ${t2.javaClass.simpleName}")
                    throw t2
                }
            }
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    companion object {
        private const val TAG = "CfVpn"
        const val ACTION_CONNECT = "org.khatetire.cfipscanner.action.CONNECT"
        const val ACTION_DISCONNECT = "org.khatetire.cfipscanner.action.DISCONNECT"
        const val ACTION_APPLY_MANUAL_IP = "org.khatetire.cfipscanner.action.APPLY_MANUAL_IP"
        const val ACTION_ROTATE = "org.khatetire.cfipscanner.action.ROTATE"
        private const val CHANNEL_ID = "khate_vpn"
        private const val NOTIF_ID = 1001

        fun connectIntent(context: Context) =
            Intent(context, CfVpnService::class.java).setAction(ACTION_CONNECT)

        fun disconnectIntent(context: Context) =
            Intent(context, CfVpnService::class.java).setAction(ACTION_DISCONNECT)

        /** Tell a running VPN service to swap its host to whatever the user
         *  just stored in `AppSettings.manualCleanIp` (or the bootstrap host
         *  when the manual field is cleared). No-op if the service isn't running. */
        fun applyManualIpIntent(context: Context) =
            Intent(context, CfVpnService::class.java).setAction(ACTION_APPLY_MANUAL_IP)

        /** Trigger an immediate best-IP probe + hot-swap (tile / notification). */
        fun rotateIntent(context: Context) =
            Intent(context, CfVpnService::class.java).setAction(ACTION_ROTATE)
    }
}
