package org.khatetire.cfipscanner.ui

import android.os.SystemClock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.NetworkPing
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.SouthWest
import androidx.compose.material.icons.rounded.Speed
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.NorthEast
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.ContentPaste
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.content.Intent
import android.widget.Toast
import android.net.Uri
import kotlinx.coroutines.launch
import org.khatetire.cfipscanner.R
import org.khatetire.cfipscanner.net.SpeedTester
import org.khatetire.cfipscanner.settings.AppSettings
import org.khatetire.cfipscanner.ui.theme.AntigravityColors
import org.khatetire.cfipscanner.vpn.CfVpnService
import org.khatetire.cfipscanner.vpn.VpnStatus

@Composable
fun HomeScreen(
    status: VpnStatus,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    var speedRunning by remember { mutableStateOf(false) }
    var speedLine by remember { mutableStateOf<String?>(null) }
    var lastOrbTapAtMs by remember { mutableStateOf(0L) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(24.dp))

        // Brand header with status pill
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = stringResource(R.string.app_name),
                    fontSize = 26.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text = stringResource(R.string.app_tagline),
                    fontSize = 13.sp,
                    color = AntigravityColors.OnDarkDim,
                )
            }
            StatusPill(state = status.state)
        }

        Spacer(Modifier.height(28.dp))

        ConnectOrb(
            state = status.state,
            onClick = {
                val now = SystemClock.elapsedRealtime()
                if (now - lastOrbTapAtMs < 850L) return@ConnectOrb
                lastOrbTapAtMs = now
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                when (status.state) {
                    VpnStatus.State.CONNECTED -> onDisconnect()
                    VpnStatus.State.CONNECTING, VpnStatus.State.DISCONNECTING -> Unit
                    else -> onConnect()
                }
            },
        )

        Spacer(Modifier.height(20.dp))
        Text(
            text = stateLabel(status.state),
            fontSize = 18.sp,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = if (status.state == VpnStatus.State.CONNECTED)
                       stringResource(R.string.server_slot_label, status.serverSlot)
                   else stringResource(R.string.app_tagline),
            fontSize = 13.sp,
            color = AntigravityColors.OnDarkDim,
        )

        // Live rate strip when connected
        if (status.state == VpnStatus.State.CONNECTED) {
            Spacer(Modifier.height(8.dp))
            Text(
                text = stringResource(
                    R.string.home_rate_label,
                    formatBytes(status.rateInBps),
                    formatBytes(status.rateOutBps),
                ),
                fontSize = 12.sp,
                color = AntigravityColors.Ion,
                fontWeight = FontWeight.Medium,
            )
        }

        Spacer(Modifier.height(20.dp))

        // Stats grid (2x2)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            StatCard(
                icon = Icons.Rounded.NetworkPing,
                label = stringResource(R.string.home_ping_label),
                value = if (status.state == VpnStatus.State.CONNECTED) "${status.pingMs} ms" else "—",
                accent = AntigravityColors.Ion,
                modifier = Modifier.weight(1f),
            )
            StatCard(
                icon = Icons.Rounded.Schedule,
                label = stringResource(R.string.home_uptime_label),
                value = formatUptime(status.uptimeSec),
                accent = AntigravityColors.Aurora,
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(12.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            StatCard(
                icon = Icons.Rounded.SouthWest,
                label = stringResource(R.string.home_download_label),
                value = formatBytes(status.bytesIn),
                accent = AntigravityColors.Plasma,
                modifier = Modifier.weight(1f),
            )
            StatCard(
                icon = Icons.Rounded.NorthEast,
                label = stringResource(R.string.home_upload_label),
                value = formatBytes(status.bytesOut),
                accent = AntigravityColors.Solar,
                modifier = Modifier.weight(1f),
            )
        }

        Spacer(Modifier.height(16.dp))

        // Speed test button
        Button(
            onClick = {
                if (speedRunning) return@Button
                speedRunning = true
                speedLine = null
                val useSocks = status.state == VpnStatus.State.CONNECTED
                scope.launch {
                    val r = SpeedTester.run(useSocks = useSocks)
                    speedRunning = false
                    speedLine = if (r.ok) String.format("%.2f Mbps · %d ms", r.mbps, r.millis)
                                else (r.error ?: "failed")
                }
            },
            modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(containerColor = AntigravityColors.Cosmic),
        ) {
            if (speedRunning) {
                CircularProgressIndicator(
                    modifier = Modifier.size(18.dp),
                    color = AntigravityColors.Ion,
                    strokeWidth = 2.dp,
                )
                Spacer(Modifier.width(10.dp))
                Text(stringResource(R.string.home_speed_running), color = AntigravityColors.OnDark)
            } else {
                Icon(Icons.Rounded.Speed, contentDescription = null, tint = AntigravityColors.Ion)
                Spacer(Modifier.width(8.dp))
                Text(
                    text = speedLine ?: stringResource(R.string.home_speed_test),
                    color = AntigravityColors.OnDark,
                    fontWeight = FontWeight.Medium,
                )
            }
        }

        Spacer(Modifier.height(20.dp))

        // Detail row
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = AntigravityColors.Nebula),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                DetailRow(
                    icon = Icons.Rounded.CloudDone,
                    label = stringResource(R.string.home_orbit_label),
                    value = if (status.state == VpnStatus.State.CONNECTED)
                                "${status.colo.ifBlank { "Auto" }} · slot ${status.serverSlot}"
                            else stringResource(R.string.region_unknown),
                )
                if (status.state == VpnStatus.State.CONNECTED && status.cleanIp.isNotBlank()) {
                    Spacer(Modifier.height(10.dp))
                    CleanIpRow(ip = status.cleanIp)
                }
                Spacer(Modifier.height(10.dp))
                ManualIpRow()
                Spacer(Modifier.height(10.dp))
                DetailRow(
                    icon = Icons.Rounded.NetworkPing,
                    label = stringResource(R.string.home_protocol_label),
                    value = stringResource(R.string.home_protocol_value),
                )
                Spacer(Modifier.height(10.dp))
                DetailRow(
                    icon = Icons.Rounded.CloudDone,
                    label = stringResource(R.string.home_quality_label),
                    value = qualityFor(status),
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        // Network identity card: Real IP + ISP/ASN/Country, plus the
        // through-VPN equivalents once connected so the user can verify
        // the tunnel actually changed their egress.
        NetworkInfoCard(state = status.state)

        // Share clean IP — only meaningful while connected.
        if (status.state == VpnStatus.State.CONNECTED && status.cleanIp.isNotBlank()) {
            val ctxShare = LocalContext.current
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = {
                    runCatching {
                        val send = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_SUBJECT, ctxShare.getString(R.string.home_share_ip_subject))
                            putExtra(Intent.EXTRA_TEXT, status.cleanIp)
                        }
                        ctxShare.startActivity(
                            Intent.createChooser(send, ctxShare.getString(R.string.home_share_ip))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                    }
                },
                modifier = Modifier.fillMaxWidth().height(44.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = AntigravityColors.Ion.copy(alpha = 0.18f)),
            ) {
                Icon(Icons.Rounded.Share, contentDescription = null, tint = AntigravityColors.Ion)
                Spacer(Modifier.width(8.dp))
                Text(
                    text = stringResource(R.string.home_share_ip),
                    color = AntigravityColors.Ion,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        // Support: Star on GitHub
        val ctx = LocalContext.current
        Button(
            onClick = {
                runCatching {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/Khate-Tire/CF-IP-Scanner"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    ctx.startActivity(intent)
                }
            },
            modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(containerColor = AntigravityColors.Solar.copy(alpha = 0.18f)),
        ) {
            Icon(
                imageVector = Icons.Rounded.Star,
                contentDescription = null,
                tint = AntigravityColors.Solar,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = "Support us — Star on GitHub",
                color = AntigravityColors.Solar,
                fontWeight = FontWeight.SemiBold,
            )
        }

        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun StatusPill(state: VpnStatus.State) {
    val (label, color) = when (state) {
        VpnStatus.State.CONNECTED      -> "ONLINE"  to AntigravityColors.Ion
        VpnStatus.State.CONNECTING,
        VpnStatus.State.DISCONNECTING  -> "BUSY"    to AntigravityColors.Solar
        VpnStatus.State.FAILED         -> "ERROR"   to AntigravityColors.Critical
        else                           -> "OFFLINE" to AntigravityColors.OnDarkDim
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(AntigravityColors.Nebula)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        androidx.compose.foundation.layout.Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(color),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = label,
            color = color,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun StatCard(
    icon: ImageVector,
    label: String,
    value: String,
    accent: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = AntigravityColors.Nebula),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            androidx.compose.foundation.layout.Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(accent.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = accent,
                    modifier = Modifier.size(20.dp),
                )
            }
            Spacer(Modifier.height(10.dp))
            Text(
                text = label,
                fontSize = 12.sp,
                color = AntigravityColors.OnDarkDim,
            )
            Text(
                text = value,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
    }
}

@Composable
private fun DetailRow(icon: ImageVector, label: String, value: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = AntigravityColors.OnDarkDim,
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(12.dp))
        Text(
            text = label,
            fontSize = 13.sp,
            color = AntigravityColors.OnDarkDim,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = value,
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onBackground,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun ManualIpRow() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val settings by AppSettings.state.collectAsState()
    val current = settings.manualCleanIp
    val activity = LocalActivity.current
    val bioTitle = stringResource(R.string.biometric_manual_ip_title)
    var dialogOpen by remember { mutableStateOf(false) }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable {
                if (settings.biometricLock && activity != null) {
                    org.khatetire.cfipscanner.util.BiometricGate.authenticate(
                        activity = activity,
                        title = bioTitle,
                        onSuccess = { dialogOpen = true },
                    )
                } else {
                    dialogOpen = true
                }
            },
    ) {
        Icon(
            imageVector = Icons.Rounded.Edit,
            contentDescription = null,
            tint = AntigravityColors.Ion,
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(12.dp))
        Text(
            text = stringResource(R.string.home_manual_ip_label),
            fontSize = 13.sp,
            color = AntigravityColors.OnDarkDim,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = if (current.isBlank())
                stringResource(R.string.home_manual_ip_off)
            else current,
            fontSize = 13.sp,
            color = if (current.isBlank()) AntigravityColors.OnDarkDim else AntigravityColors.Ion,
            fontWeight = FontWeight.SemiBold,
            fontFamily = if (current.isBlank()) FontFamily.Default else FontFamily.Monospace,
        )
    }

    if (dialogOpen) {
        var input by remember { mutableStateOf(current) }
        AlertDialog(
            onDismissRequest = { dialogOpen = false },
            title = { Text(stringResource(R.string.home_manual_ip_label)) },
            text = {
                Column {
                    Text(
                        text = stringResource(R.string.home_manual_ip_help),
                        fontSize = 12.sp,
                        color = AntigravityColors.OnDarkDim,
                    )
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = input,
                        onValueChange = { input = it.trim() },
                        singleLine = true,
                        placeholder = { Text(stringResource(R.string.home_manual_ip_hint)) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    val clip = LocalClipboardManager.current
                    val emptyMsg = stringResource(R.string.home_paste_ip_empty)
                    val invalidMsg = stringResource(R.string.home_paste_ip_invalid)
                    Row {
                        TextButton(onClick = {
                            val raw = clip.getText()?.text?.trim().orEmpty()
                            when {
                                raw.isEmpty() -> Toast.makeText(ctx, emptyMsg, Toast.LENGTH_SHORT).show()
                                !looksLikeIp(raw) -> Toast.makeText(ctx, invalidMsg, Toast.LENGTH_SHORT).show()
                                else -> input = raw
                            }
                        }) {
                            Icon(Icons.Rounded.ContentPaste, contentDescription = null, tint = AntigravityColors.Ion)
                            Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.home_paste_ip), color = AntigravityColors.Ion)
                        }
                        Spacer(Modifier.width(4.dp))
                        TextButton(onClick = {
                            dialogOpen = false
                            QrScanRequest.request()
                        }) {
                            Icon(Icons.Rounded.QrCodeScanner, contentDescription = null, tint = AntigravityColors.Aurora)
                            Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.home_scan_qr), color = AntigravityColors.Aurora)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val cleaned = input.trim()
                    scope.launch {
                        AppSettings.update { it.copy(manualCleanIp = cleaned) }
                        // Apply immediately if VPN is up
                        runCatching {
                            ctx.startService(CfVpnService.applyManualIpIntent(ctx))
                        }
                    }
                    dialogOpen = false
                }) { Text(stringResource(R.string.home_manual_ip_apply)) }
            },
            dismissButton = {
                TextButton(onClick = {
                    scope.launch {
                        AppSettings.update { it.copy(manualCleanIp = "") }
                        runCatching {
                            ctx.startService(CfVpnService.applyManualIpIntent(ctx))
                        }
                    }
                    dialogOpen = false
                }) { Text(stringResource(R.string.home_manual_ip_clear)) }
            },
        )
    }
}

@Composable
private fun CleanIpRow(ip: String) {
    val ctx = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val copiedMsg = stringResource(R.string.home_clean_ip_copied)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Icon(
            imageVector = Icons.Rounded.Public,
            contentDescription = null,
            tint = AntigravityColors.Ion,
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(12.dp))
        Text(
            text = stringResource(R.string.home_clean_ip_label),
            fontSize = 13.sp,
            color = AntigravityColors.OnDarkDim,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = ip,
            fontSize = 13.sp,
            color = AntigravityColors.Ion,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
        )
        Spacer(Modifier.width(8.dp))
        Icon(
            imageVector = Icons.Rounded.ContentCopy,
            contentDescription = "Copy IP",
            tint = AntigravityColors.OnDarkDim,
            modifier = Modifier
                .size(16.dp)
                .clickable {
                    clipboard.setText(AnnotatedString(ip))
                    Toast.makeText(ctx, copiedMsg, Toast.LENGTH_SHORT).show()
                },
        )
    }
}

@Composable
private fun stateLabel(state: VpnStatus.State): String = when (state) {
    VpnStatus.State.IDLE          -> stringResource(R.string.state_idle)
    VpnStatus.State.CONNECTING    -> stringResource(R.string.state_connecting)
    VpnStatus.State.CONNECTED     -> stringResource(R.string.state_connected)
    VpnStatus.State.DISCONNECTING -> stringResource(R.string.state_disconnecting)
    VpnStatus.State.FAILED        -> stringResource(R.string.state_failed)
}

@Composable
private fun qualityFor(status: VpnStatus): String {
    if (status.state != VpnStatus.State.CONNECTED) return stringResource(R.string.home_quality_unknown)
    return when {
        status.pingMs in 1..50    -> stringResource(R.string.home_quality_excellent)
        status.pingMs in 51..120  -> stringResource(R.string.home_quality_good)
        status.pingMs in 121..250 -> stringResource(R.string.home_quality_fair)
        status.pingMs > 250       -> stringResource(R.string.home_quality_poor)
        else                      -> stringResource(R.string.home_quality_unknown)
    }
}

/** Loose IPv4/IPv6 check used by the manual-IP paste action. */
private fun looksLikeIp(s: String): Boolean {
    val t = s.trim()
    if (t.isEmpty() || t.length > 64) return false
    val v4 = Regex("""^(\d{1,3})(\.\d{1,3}){3}$""")
    if (v4.matches(t)) {
        return t.split('.').all { (it.toIntOrNull() ?: -1) in 0..255 }
    }
    // very loose IPv6 test — colons + hex only
    return t.contains(':') && t.all { it.isDigit() || it in 'a'..'f' || it in 'A'..'F' || it == ':' }
}
