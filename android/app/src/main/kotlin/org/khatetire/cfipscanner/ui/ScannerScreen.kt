package org.khatetire.cfipscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Cancel
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.Radar
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.khatetire.cfipscanner.R
import org.khatetire.cfipscanner.scanner.ScanProfile
import org.khatetire.cfipscanner.ui.theme.AntigravityColors

@Composable
fun ScannerScreen(
    state: ScanUiState,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(AntigravityColors.Aurora.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Rounded.Radar,
                    contentDescription = null,
                    tint = AntigravityColors.Aurora,
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = stringResource(R.string.scanner_title),
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text = stringResource(R.string.scanner_subtitle),
                    fontSize = 12.sp,
                    color = AntigravityColors.OnDarkDim,
                )
            }
        }
        Spacer(Modifier.height(20.dp))

        // Profile + cadence card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = AntigravityColors.Nebula),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = stringResource(R.string.scanner_profile_label),
                        fontSize = 12.sp,
                        color = AntigravityColors.OnDarkDim,
                        modifier = Modifier.weight(1f),
                    )
                    ProfileChip(state.profile)
                }
                Spacer(Modifier.height(10.dp))
                Text(
                    text = state.profile.description,
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Spacer(Modifier.height(12.dp))
                LinearProgressIndicator(
                    progress = { state.cleanPct.coerceIn(0f, 1f) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(6.dp)
                        .clip(RoundedCornerShape(3.dp)),
                    color = AntigravityColors.Ion,
                    trackColor = AntigravityColors.Cosmic,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "${state.clean} clean / ${state.tested} tested",
                    fontSize = 12.sp,
                    color = AntigravityColors.OnDarkDim,
                )
                Spacer(Modifier.height(4.dp))
                DbHealthBadge(state)
            }
        }

        Spacer(Modifier.height(12.dp))
        // Stat row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ScanStatCard(
                value = state.tested.toString(),
                label = stringResource(R.string.scanner_tested_label),
                accent = AntigravityColors.Aurora,
                modifier = Modifier.weight(1f),
            )
            ScanStatCard(
                value = state.clean.toString(),
                label = stringResource(R.string.scanner_clean_label),
                accent = AntigravityColors.Ion,
                modifier = Modifier.weight(1f),
            )
            ScanStatCard(
                value = if (state.bestPingMs > 0) "${state.bestPingMs}ms" else "—",
                label = stringResource(R.string.scanner_best_ping_label),
                accent = AntigravityColors.Plasma,
                modifier = Modifier.weight(1f),
            )
        }

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = onToggle,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = if (state.running) AntigravityColors.Critical else AntigravityColors.Aurora,
            ),
        ) {
            Icon(
                imageVector = if (state.running) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                contentDescription = null,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = if (state.running) stringResource(R.string.scanner_pause)
                       else stringResource(R.string.scanner_start),
                fontWeight = FontWeight.SemiBold,
            )
        }

        Spacer(Modifier.height(20.dp))
        Text(
            text = stringResource(R.string.scanner_recent_title),
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(8.dp))

        if (state.recent.isEmpty()) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = AntigravityColors.Nebula),
            ) {
                Text(
                    text = stringResource(R.string.scanner_no_results),
                    color = AntigravityColors.OnDarkDim,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(16.dp),
                )
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(state.recent) { row -> ResultRow(row) }
            }
        }
    }
}

@Composable
private fun DbHealthBadge(state: ScanUiState) {
    val connected = state.dbConnected
    val working = state.dbWorkingCount
    val accent = if (connected) AntigravityColors.Ion else AntigravityColors.Critical
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Icon(
            imageVector = if (connected) Icons.Rounded.CloudDone else Icons.Rounded.CloudOff,
            contentDescription = null,
            tint = accent,
            modifier = Modifier.size(16.dp),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text = if (connected) "DB · ${state.dbLayer}${if (state.dbLatencyMs > 0) " · ${state.dbLatencyMs}ms" else ""}"
                   else "DB · offline",
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = accent,
        )
        Spacer(Modifier.width(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            state.dbLayers.forEach { layer ->
                val dotColor = when (layer.status) {
                    DbLayerStatus.OK      -> AntigravityColors.Ion
                    DbLayerStatus.FAIL    -> AntigravityColors.Critical
                    DbLayerStatus.UNKNOWN -> AntigravityColors.OnDarkDim.copy(alpha = 0.4f)
                }
                Box(
                    modifier = Modifier
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(dotColor),
                )
            }
        }
        Spacer(Modifier.width(6.dp))
        Text(
            text = "$working/5",
            fontSize = 10.sp,
            color = AntigravityColors.OnDarkDim,
        )
    }
}

@Composable
private fun ProfileChip(profile: ScanProfile) {
    val (label, color) = when (profile) {
        ScanProfile.PAUSED  -> "Paused"  to AntigravityColors.OnDarkDim
        ScanProfile.MINIMAL -> "Minimal" to AntigravityColors.Solar
        ScanProfile.NORMAL  -> "Normal"  to AntigravityColors.Ion
        ScanProfile.BOOST   -> "Boost"   to AntigravityColors.Aurora
        ScanProfile.MAXIMUM -> "Max"     to AntigravityColors.Plasma
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(color.copy(alpha = 0.18f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Icon(
            imageVector = Icons.Rounded.Bolt,
            contentDescription = null,
            tint = color,
            modifier = Modifier.size(14.dp),
        )
        Spacer(Modifier.width(4.dp))
        Text(text = label, color = color, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun ScanStatCard(value: String, label: String, accent: Color, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = AntigravityColors.Nebula),
    ) {
        Column(
            modifier = Modifier.padding(12.dp).fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = value,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                color = accent,
            )
            Text(
                text = label,
                fontSize = 11.sp,
                color = AntigravityColors.OnDarkDim,
            )
        }
    }
}

@Composable
private fun ResultRow(row: ScanResultRow) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = AntigravityColors.Nebula),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = if (row.clean) Icons.Rounded.CheckCircle else Icons.Rounded.Cancel,
                contentDescription = null,
                tint = if (row.clean) AntigravityColors.Ion else AntigravityColors.Critical,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = row.redactedIp,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text = formatRelative(row.timestampMs),
                    fontSize = 11.sp,
                    color = AntigravityColors.OnDarkDim,
                )
            }
            Text(
                text = if (row.clean) "${row.pingMs} ms" else "blocked",
                fontSize = 13.sp,
                color = if (row.clean) AntigravityColors.OnDark else AntigravityColors.OnDarkDim,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}
