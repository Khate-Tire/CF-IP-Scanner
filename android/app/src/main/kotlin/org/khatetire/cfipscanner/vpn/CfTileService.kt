package org.khatetire.cfipscanner.vpn

import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import org.khatetire.cfipscanner.MainActivity
import org.khatetire.cfipscanner.R

/**
 * Quick Settings tile that lets the user toggle the VPN from the system
 * shade without opening the app. Mirrors [VpnStateHolder] so its label
 * always matches the live connection state.
 */
class CfTileService : TileService() {

    private var scope: CoroutineScope? = null
    private var watchJob: Job? = null

    override fun onStartListening() {
        super.onStartListening()
        sync()
        val s = CoroutineScope(SupervisorJob() + Dispatchers.Main)
        scope = s
        watchJob = s.launch {
            VpnStateHolder.status.collectLatest { sync() }
        }
    }

    override fun onStopListening() {
        watchJob?.cancel(); watchJob = null
        scope?.cancel(); scope = null
        super.onStopListening()
    }

    override fun onClick() {
        super.onClick()
        when (VpnStateHolder.status.value.state) {
            VpnStatus.State.CONNECTED, VpnStatus.State.CONNECTING -> {
                ContextCompat.startForegroundService(this, CfVpnService.disconnectIntent(this))
            }
            else -> {
                // VpnService.prepare must be called from an Activity. If consent
                // is already granted (returns null), start the service directly;
                // otherwise launch the app so the user can grant permission.
                val needsConsent = VpnService.prepare(applicationContext) != null
                if (needsConsent) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        startActivityAndCollapseCompat()
                    } else {
                        @Suppress("DEPRECATION")
                        startActivityAndCollapse(
                            Intent(this, MainActivity::class.java)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                    }
                } else {
                    ContextCompat.startForegroundService(this, CfVpnService.connectIntent(this))
                }
            }
        }
        sync()
    }

    @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private fun startActivityAndCollapseCompat() {
        val pi = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        startActivityAndCollapse(pi)
    }

    private fun sync() {
        val tile = qsTile ?: return
        val s = VpnStateHolder.status.value
        when (s.state) {
            VpnStatus.State.CONNECTED -> {
                tile.state = Tile.STATE_ACTIVE
                tile.label = getString(R.string.tile_label_connected)
                tile.contentDescription = getString(R.string.tile_label_connected)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    tile.subtitle = if (s.cleanIp.isNotBlank()) s.cleanIp else getString(R.string.app_name)
                }
            }
            VpnStatus.State.CONNECTING, VpnStatus.State.DISCONNECTING -> {
                tile.state = Tile.STATE_UNAVAILABLE
                tile.label = getString(R.string.tile_label_busy)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    tile.subtitle = ""
                }
            }
            else -> {
                tile.state = Tile.STATE_INACTIVE
                tile.label = getString(R.string.tile_label_idle)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    tile.subtitle = ""
                }
            }
        }
        tile.updateTile()
    }
}
