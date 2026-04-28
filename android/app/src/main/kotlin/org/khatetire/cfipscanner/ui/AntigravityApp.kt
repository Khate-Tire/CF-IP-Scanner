package org.khatetire.cfipscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Radar
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalContext
import org.khatetire.cfipscanner.R
import org.khatetire.cfipscanner.scanner.RealScannerEngine
import org.khatetire.cfipscanner.ui.theme.AntigravityBrushes
import org.khatetire.cfipscanner.ui.theme.AntigravityColors
import org.khatetire.cfipscanner.vpn.VpnStateHolder
import org.khatetire.cfipscanner.vpn.VpnStatus

enum class Tab(val labelRes: Int, val icon: ImageVector) {
    HOME    (R.string.tab_home,     Icons.Rounded.Home),
    SCANNER (R.string.tab_scanner,  Icons.Rounded.Radar),
    SETTINGS(R.string.tab_settings, Icons.Rounded.Settings),
    ABOUT   (R.string.tab_about,    Icons.Rounded.Info),
}

@Composable
fun AntigravityApp(
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    anonymousId: String,
    onOpenLink: (String) -> Unit,
) {
    var current by rememberSaveable { mutableStateOf(Tab.HOME) }
    val status by VpnStateHolder.status.collectAsState()
    val scan by ScanStateHolder.state.collectAsState()
    val ctx = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val snackbarHostState = remember { SnackbarHostState() }
    var previousState by remember { mutableStateOf(status.state) }

    LaunchedEffect(status.state) {
        if (previousState == status.state) return@LaunchedEffect
        when (status.state) {
            VpnStatus.State.CONNECTED -> {
                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                snackbarHostState.showSnackbar(ctx.getString(R.string.home_connect_success))
            }
            VpnStatus.State.FAILED -> {
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                snackbarHostState.showSnackbar(ctx.getString(R.string.home_connect_failed))
            }
            else -> Unit
        }
        previousState = status.state
    }

    Scaffold(
        containerColor = Color.Transparent,
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        bottomBar = { AntigravityNavBar(current = current, onSelect = { current = it }) },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(AntigravityBrushes.backdrop)
                .padding(padding),
        ) {
            when (current) {
                Tab.HOME     -> HomeScreen(status = status, onConnect = onConnect, onDisconnect = onDisconnect)
                Tab.SCANNER  -> ScannerScreen(state = scan, onToggle = {
                    val next = !scan.running
                    ScanStateHolder.setRunning(next)
                    if (next) RealScannerEngine.start(ctx) else RealScannerEngine.stop()
                })
                Tab.SETTINGS -> SettingsScreen()
                Tab.ABOUT    -> AboutScreen(anonymousId = anonymousId, onOpenLink = onOpenLink)
            }
        }
    }
}

@Composable
private fun AntigravityNavBar(current: Tab, onSelect: (Tab) -> Unit) {
    NavigationBar(
        containerColor = AntigravityColors.Nebula,
        contentColor = AntigravityColors.OnDark,
    ) {
        Tab.entries.forEach { tab ->
            NavigationBarItem(
                selected = current == tab,
                onClick = { onSelect(tab) },
                icon = { Icon(tab.icon, contentDescription = null) },
                label = { Text(stringResource(tab.labelRes)) },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = AntigravityColors.Aurora,
                    selectedTextColor = AntigravityColors.Aurora,
                    indicatorColor = AntigravityColors.Aurora.copy(alpha = 0.18f),
                    unselectedIconColor = AntigravityColors.OnDarkDim,
                    unselectedTextColor = AntigravityColors.OnDarkDim,
                ),
            )
        }
    }
}
