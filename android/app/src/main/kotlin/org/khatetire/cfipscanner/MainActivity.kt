package org.khatetire.cfipscanner

import android.content.Intent
import android.net.Uri
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.CompositionLocalProvider
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.khatetire.cfipscanner.settings.AppSettings
import org.khatetire.cfipscanner.ui.AntigravityApp
import org.khatetire.cfipscanner.ui.LocalActivity
import org.khatetire.cfipscanner.ui.theme.AntigravityTheme
import org.khatetire.cfipscanner.util.AnonymousId
import org.khatetire.cfipscanner.vpn.CfVpnService
import org.khatetire.cfipscanner.vpn.VpnStateHolder
import org.khatetire.cfipscanner.vpn.VpnStatus

class MainActivity : FragmentActivity() {

    private val prepareVpnLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) startVpnService()
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* nice-to-have */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
        val anonId = AnonymousId.get(applicationContext)
        // Hand the app context to IspContext so cellular SIM operator can be
        // merged into the ISP label, and pre-warm the DB layer ladder so the
        // header badge in the Scanner tab reflects reality before the first
        // scan kicks off (otherwise the user only sees L5 lit on cold start).
        org.khatetire.cfipscanner.net.IspContext.attach(applicationContext)
        lifecycleScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            runCatching { org.khatetire.cfipscanner.net.DbClient.bestIps(applicationContext, limit = 5) }
        }
        setContent {
            AntigravityTheme {
                CompositionLocalProvider(LocalActivity provides this) {
                    AntigravityApp(
                        onConnect = ::onConnectClick,
                        onDisconnect = ::onDisconnectClick,
                        anonymousId = anonId,
                        onOpenLink = ::openExternal,
                    )
                }
            }
        }
        // Auto-connect if user enabled it and we are idle.
        if (AppSettings.current().autoConnect &&
            VpnStateHolder.status.value.state == VpnStatus.State.IDLE) {
            onConnectClick()
        }
    }

    private fun onConnectClick() {
        val prepareIntent: Intent? = VpnService.prepare(this)
        if (prepareIntent != null) {
            prepareVpnLauncher.launch(prepareIntent)
        } else {
            startVpnService()
        }
    }

    private fun onDisconnectClick() {
        ContextCompat.startForegroundService(this, CfVpnService.disconnectIntent(this))
    }

    private fun startVpnService() {
        ContextCompat.startForegroundService(this, CfVpnService.connectIntent(this))
    }

    private fun openExternal(url: String) {
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}

