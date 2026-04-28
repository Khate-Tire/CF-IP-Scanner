package org.khatetire.cfipscanner

import android.content.Intent
import android.net.Uri
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import org.khatetire.cfipscanner.settings.AppSettings
import org.khatetire.cfipscanner.ui.AntigravityApp
import org.khatetire.cfipscanner.ui.theme.AntigravityTheme
import org.khatetire.cfipscanner.util.AnonymousId
import org.khatetire.cfipscanner.vpn.CfVpnService
import org.khatetire.cfipscanner.vpn.VpnStateHolder
import org.khatetire.cfipscanner.vpn.VpnStatus

class MainActivity : ComponentActivity() {

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
        setContent {
            AntigravityTheme {
                AntigravityApp(
                    onConnect = ::onConnectClick,
                    onDisconnect = ::onDisconnectClick,
                    anonymousId = anonId,
                    onOpenLink = ::openExternal,
                )
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

