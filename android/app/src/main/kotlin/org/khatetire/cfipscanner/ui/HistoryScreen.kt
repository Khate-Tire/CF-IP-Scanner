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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DeleteSweep
import androidx.compose.material.icons.rounded.History
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import org.khatetire.cfipscanner.R
import org.khatetire.cfipscanner.history.SessionDb
import org.khatetire.cfipscanner.history.SessionEntity
import org.khatetire.cfipscanner.ui.theme.AntigravityColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun HistoryScreen(onClose: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val dao = remember { SessionDb.get(ctx).sessions() }
    val sessions by dao.recent().collectAsState(initial = emptyList())

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(AntigravityColors.Space),
    ) {
        Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) {
                    Icon(Icons.Rounded.Close, contentDescription = null, tint = AntigravityColors.OnDark)
                }
                Spacer(Modifier.width(4.dp))
                Icon(Icons.Rounded.History, contentDescription = null, tint = AntigravityColors.Aurora)
                Spacer(Modifier.width(8.dp))
                Text(
                    text = stringResource(R.string.history_title),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = AntigravityColors.OnDark,
                    modifier = Modifier.weight(1f),
                )
                if (sessions.isNotEmpty()) {
                    TextButton(onClick = {
                        scope.launch { dao.clear() }
                    }) {
                        Icon(Icons.Rounded.DeleteSweep, contentDescription = null, tint = AntigravityColors.Plasma)
                        Spacer(Modifier.width(4.dp))
                        Text(stringResource(R.string.history_clear), color = AntigravityColors.Plasma)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            if (sessions.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        text = stringResource(R.string.history_empty),
                        color = AntigravityColors.OnDarkDim,
                        fontSize = 14.sp,
                    )
                }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(sessions, key = { it.id }) { row -> SessionRow(row) }
                }
            }
        }
    }
}

@Composable
private fun SessionRow(s: SessionEntity) {
    val df = remember { SimpleDateFormat("MMM d  HH:mm", Locale.getDefault()) }
    val durSec = (((s.endMs ?: System.currentTimeMillis()) - s.startMs) / 1000L).coerceAtLeast(0)
    val totalMb = (s.bytesIn + s.bytesOut) / 1_048_576.0
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(AntigravityColors.Nebula)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = if (s.cleanIp.isBlank()) "—" else s.cleanIp,
                color = AntigravityColors.Ion,
                fontFamily = FontFamily.Monospace,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = df.format(Date(s.startMs)),
                color = AntigravityColors.OnDarkDim,
                fontSize = 11.sp,
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                text = formatDuration(durSec),
                color = AntigravityColors.OnDark,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
            )
            Text(
                text = String.format(Locale.US, "%.1f MB", totalMb),
                color = AntigravityColors.OnDarkDim,
                fontSize = 11.sp,
            )
        }
    }
}

private fun formatDuration(sec: Long): String {
    val h = sec / 3600
    val m = (sec % 3600) / 60
    val s = sec % 60
    return if (h > 0) "${h}h ${m}m" else if (m > 0) "${m}m ${s}s" else "${s}s"
}
