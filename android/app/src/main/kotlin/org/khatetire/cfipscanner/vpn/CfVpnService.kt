package org.khatetire.cfipscanner.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
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
        VpnStateHolder.setState(VpnStatus.State.CONNECTING)
        startForeground(NOTIF_ID, buildNotification(VpnStatus(state = VpnStatus.State.CONNECTING)))

        connectJob?.cancel()
        connectJob = scope.launch {
            val slot = runCatching { AppSettings.current().selectedSlot }.getOrDefault(1)
            val cfg = AdaptiveConnectController.bestNow(applicationContext, slot)
            if (cfg == null) {
                Log.e(TAG, "AdaptiveConnect.bestNow returned null (bootstrap empty?)")
                VpnStateHolder.setState(VpnStatus.State.FAILED)
                updateNotification()
                return@launch
            }
            liveCfg = cfg
            Log.i(TAG, "using config slot=${cfg.displaySlot} host=${cfg.host}")
            // Phase-1 SNI selection: just use the primary; Phase-4 watchdog
            // will rotate through SniBank.rotation(...) on failure.
            val rotation = SniBank.rotation(cfg.sni, originalSni = cfg.sni)
            val xrayJson = XrayConfigBuilder.build(
                cfg = cfg,
                overrideSni = rotation.first(),
                frontOnlyTls = false,
                verifyTls = !cfg.allowInsecure,
            )
            if (!xray.start(xrayJson, "${cfg.host}:${cfg.port}")) {
                Log.e(TAG, "Xray start failed (libv2ray missing or API mismatch?)")
                VpnStateHolder.setState(VpnStatus.State.FAILED)
                updateNotification()
                return@launch
            }
            tunFd = buildVpnInterface()
            val fd = tunFd?.fd
            if (fd == null) {
                Log.e(TAG, "buildVpnInterface returned null")
                xray.stop()
                VpnStateHolder.setState(VpnStatus.State.FAILED)
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
                VpnStateHolder.setState(VpnStatus.State.FAILED)
                updateNotification()
                return@launch
            }
            Log.i(TAG, "CONNECTED")

            VpnStateHolder.update {
                it.copy(state = VpnStatus.State.CONNECTED, serverSlot = cfg.displaySlot,
                        uptimeSec = 0L, bytesIn = 0L, bytesOut = 0L,
                        rateInBps = 0L, rateOutBps = 0L)
            }
            updateNotification()
            startTelemetry()
            startImprovementLoop()
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
            val rotation = SniBank.rotation(newCfg.sni, originalSni = newCfg.sni)
            val xrayJson = XrayConfigBuilder.build(
                cfg = newCfg,
                overrideSni = rotation.first(),
                frontOnlyTls = false,
                verifyTls = !newCfg.allowInsecure,
            )
            if (xray.start(xrayJson, "${newCfg.host}:${newCfg.port}")) {
                liveCfg = newCfg
                VpnStateHolder.update { it.copy(serverSlot = newCfg.displaySlot) }
                updateNotification()
            } else {
                Log.w(TAG, "hotSwap: xray restart failed, keeping previous host")
            }
        } catch (t: Throwable) {
            Log.w(TAG, "hotSwap error: ${t.message}")
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) builder.setMetered(false)
        return builder.establish()
    }

    private fun shutdown() {
        VpnStateHolder.setState(VpnStatus.State.DISCONNECTING)
        telemetryJob?.cancel(); telemetryJob = null
        improveJob?.cancel(); improveJob = null
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
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_vpn)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(text)
            .setContentIntent(openApp)
            .addAction(0, getString(R.string.notif_action_disconnect), disconnect)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun updateNotification() {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        nm.notify(NOTIF_ID, buildNotification(VpnStateHolder.status.value))
    }

    companion object {
        private const val TAG = "CfVpn"
        const val ACTION_CONNECT = "org.khatetire.cfipscanner.action.CONNECT"
        const val ACTION_DISCONNECT = "org.khatetire.cfipscanner.action.DISCONNECT"
        private const val CHANNEL_ID = "khate_vpn"
        private const val NOTIF_ID = 1001

        fun connectIntent(context: Context) =
            Intent(context, CfVpnService::class.java).setAction(ACTION_CONNECT)

        fun disconnectIntent(context: Context) =
            Intent(context, CfVpnService::class.java).setAction(ACTION_DISCONNECT)
    }
}
