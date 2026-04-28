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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.NetworkPing
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.SouthWest
import androidx.compose.material.icons.rounded.Speed
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.NorthEast
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.content.Intent
import android.net.Uri
import kotlinx.coroutines.launch
import org.khatetire.cfipscanner.R
import org.khatetire.cfipscanner.net.SpeedTester
import org.khatetire.cfipscanner.ui.theme.AntigravityColors
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
