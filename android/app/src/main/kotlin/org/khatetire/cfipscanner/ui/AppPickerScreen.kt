package org.khatetire.cfipscanner.ui

import android.content.pm.PackageManager
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.core.graphics.drawable.toBitmapOrNull
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.khatetire.cfipscanner.R
import org.khatetire.cfipscanner.settings.AppSettings
import org.khatetire.cfipscanner.ui.theme.AntigravityColors

private data class AppEntry(
    val pkg: String,
    val label: String,
    val icon: android.graphics.Bitmap?,
)

@Composable
fun AppPickerScreen(onClose: () -> Unit) {
    val ctx = LocalContext.current
    val settings by AppSettings.state.collectAsState()
    val initialExcluded = remember(settings.excludedApps) { settings.excludedApps }
    val excluded = remember { mutableStateMapOf<String, Boolean>() }
    var apps by remember { mutableStateOf<List<AppEntry>?>(null) }
    var query by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        initialExcluded.forEach { excluded[it] = true }
        apps = withContext(Dispatchers.IO) { loadApps(ctx) }
    }

    val filtered = remember(apps, query) {
        val q = query.trim().lowercase()
        if (apps == null) emptyList()
        else if (q.isEmpty()) apps!!
        else apps!!.filter { it.label.lowercase().contains(q) || it.pkg.lowercase().contains(q) }
    }

    Box(modifier = Modifier.fillMaxSize().background(AntigravityColors.Space)) {
        Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) {
                    Icon(Icons.Rounded.ArrowBack, contentDescription = null, tint = AntigravityColors.OnDark)
                }
                Spacer(Modifier.width(4.dp))
                Text(
                    text = stringResource(R.string.exclude_apps_title),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = AntigravityColors.OnDark,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = {
                    AppSettings.update { it.copy(excludedApps = excluded.filterValues { v -> v }.keys.toSet()) }
                    onClose()
                }) {
                    Text(stringResource(R.string.exclude_apps_save), color = AntigravityColors.Aurora)
                }
            }
            Text(
                text = stringResource(R.string.exclude_apps_help),
                fontSize = 12.sp,
                color = AntigravityColors.OnDarkDim,
                modifier = Modifier.padding(start = 8.dp, end = 8.dp),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                placeholder = { Text(stringResource(R.string.exclude_apps_search)) },
                leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            if (apps == null) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = AntigravityColors.Aurora)
                }
            } else {
                Card(
                    modifier = Modifier.fillMaxSize(),
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(containerColor = AntigravityColors.Nebula),
                ) {
                    LazyColumn(modifier = Modifier.fillMaxSize().padding(8.dp)) {
                        items(filtered, key = { it.pkg }) { app ->
                            val checked = excluded[app.pkg] == true
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { excluded[app.pkg] = !checked }
                                    .padding(horizontal = 8.dp, vertical = 8.dp),
                            ) {
                                if (app.icon != null) {
                                    androidx.compose.foundation.Image(
                                        painter = BitmapPainter(app.icon.asImageBitmap()),
                                        contentDescription = null,
                                        modifier = Modifier.size(36.dp).clip(CircleShape),
                                    )
                                } else {
                                    Box(
                                        modifier = Modifier
                                            .size(36.dp)
                                            .clip(CircleShape)
                                            .background(AntigravityColors.Cosmic),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Icon(
                                            Icons.Rounded.Apps,
                                            contentDescription = null,
                                            tint = AntigravityColors.OnDarkDim,
                                            modifier = Modifier.size(20.dp),
                                        )
                                    }
                                }
                                Spacer(Modifier.width(12.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(app.label, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = AntigravityColors.OnDark)
                                    Text(app.pkg, fontSize = 11.sp, color = AntigravityColors.OnDarkDim)
                                }
                                Checkbox(
                                    checked = checked,
                                    onCheckedChange = { excluded[app.pkg] = it },
                                    colors = CheckboxDefaults.colors(
                                        checkedColor = AntigravityColors.Aurora,
                                        uncheckedColor = AntigravityColors.OnDarkDim,
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun loadApps(ctx: android.content.Context): List<AppEntry> {
    val pm = ctx.packageManager
    val intent = android.content.Intent(android.content.Intent.ACTION_MAIN)
        .addCategory(android.content.Intent.CATEGORY_LAUNCHER)
    val flags = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU)
        PackageManager.ResolveInfoFlags.of(0L) else null
    val resolved = if (flags != null) pm.queryIntentActivities(intent, flags)
                   else @Suppress("DEPRECATION") pm.queryIntentActivities(intent, 0)
    val mine = ctx.packageName
    return resolved
        .asSequence()
        .map { it.activityInfo.applicationInfo }
        .distinctBy { it.packageName }
        .filter { it.packageName != mine }
        .map { ai ->
            AppEntry(
                pkg = ai.packageName,
                label = runCatching { pm.getApplicationLabel(ai).toString() }.getOrDefault(ai.packageName),
                icon = runCatching { pm.getApplicationIcon(ai).toBitmapOrNull(96, 96) }.getOrNull(),
            )
        }
        .sortedBy { it.label.lowercase() }
        .toList()
}
