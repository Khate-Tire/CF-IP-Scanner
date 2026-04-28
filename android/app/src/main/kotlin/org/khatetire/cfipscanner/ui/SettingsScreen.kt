package org.khatetire.cfipscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.BatteryChargingFull
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CloudSync
import androidx.compose.material.icons.rounded.ColorLens
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.Lan
import androidx.compose.material.icons.rounded.Power
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Wifi
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.khatetire.cfipscanner.R
import org.khatetire.cfipscanner.bootstrap.BootstrapInventory
import org.khatetire.cfipscanner.settings.AccentTheme
import org.khatetire.cfipscanner.settings.AppSettings
import org.khatetire.cfipscanner.ui.theme.AntigravityColors
import org.khatetire.cfipscanner.ui.theme.paletteFor

@Composable
fun SettingsScreen(modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val settings by AppSettings.state.collectAsState()
    var accentDialog by remember { mutableStateOf(false) }
    var serverDialog by remember { mutableStateOf(false) }

    val slots = remember { BootstrapInventory.slots(ctx) }
    val currentSlotLabel = slots.getOrNull(settings.selectedSlot) ?: "Auto"

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 24.dp),
    ) {
        Text(
            text = stringResource(R.string.settings_title),
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(20.dp))

        SettingsSection(title = stringResource(R.string.settings_section_general)) {
            SettingsRow(
                icon = Icons.Rounded.ColorLens,
                title = stringResource(R.string.settings_accent),
                subtitle = settings.accent.displayName,
                onClick = { accentDialog = true },
            )
            SettingsRow(
                icon = Icons.Rounded.Public,
                title = stringResource(R.string.settings_server),
                subtitle = currentSlotLabel,
                onClick = { if (slots.isNotEmpty()) serverDialog = true },
            )
            SettingsToggle(
                icon = Icons.Rounded.Power,
                title = stringResource(R.string.settings_auto_connect),
                subtitle = stringResource(R.string.settings_auto_connect_desc),
                checked = settings.autoConnect,
                onCheckedChange = { v -> AppSettings.update { it.copy(autoConnect = v) } },
            )
        }

        Spacer(Modifier.height(16.dp))
        SettingsSection(title = stringResource(R.string.settings_section_scanner)) {
            SettingsToggle(
                icon = Icons.Rounded.Wifi,
                title = stringResource(R.string.settings_scan_wifi_only),
                subtitle = stringResource(R.string.settings_scan_wifi_only_desc),
                checked = settings.scanWifiOnly,
                onCheckedChange = { v -> AppSettings.update { it.copy(scanWifiOnly = v) } },
            )
            SettingsToggle(
                icon = Icons.Rounded.BatteryChargingFull,
                title = stringResource(R.string.settings_scan_charging_only),
                subtitle = stringResource(R.string.settings_scan_charging_only_desc),
                checked = settings.scanChargingOnly,
                onCheckedChange = { v -> AppSettings.update { it.copy(scanChargingOnly = v) } },
            )
            SettingsToggle(
                icon = Icons.Rounded.CloudSync,
                title = stringResource(R.string.settings_share_results),
                subtitle = stringResource(R.string.settings_share_results_desc),
                checked = settings.shareResults,
                onCheckedChange = { v -> AppSettings.update { it.copy(shareResults = v) } },
            )
        }

        Spacer(Modifier.height(16.dp))
        SettingsSection(title = stringResource(R.string.settings_section_advanced)) {
            SettingsToggle(
                icon = Icons.Rounded.Shield,
                title = stringResource(R.string.settings_kill_switch),
                subtitle = stringResource(R.string.settings_kill_switch_desc),
                checked = settings.killSwitch,
                onCheckedChange = { v -> AppSettings.update { it.copy(killSwitch = v) } },
            )
            SettingsToggle(
                icon = Icons.Rounded.Lan,
                title = stringResource(R.string.settings_lan_bypass),
                subtitle = stringResource(R.string.settings_lan_bypass_desc),
                checked = settings.lanBypass,
                onCheckedChange = { v -> AppSettings.update { it.copy(lanBypass = v) } },
            )
        }

        Spacer(Modifier.height(20.dp))
        TextButton(
            onClick = { AppSettings.reset() },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(Icons.Rounded.RestartAlt, contentDescription = null, tint = AntigravityColors.Plasma)
            Spacer(Modifier.width(8.dp))
            Text(
                text = stringResource(R.string.settings_reset),
                color = AntigravityColors.Plasma,
                fontWeight = FontWeight.Medium,
            )
        }
        Spacer(Modifier.height(24.dp))
    }

    if (accentDialog) {
        AccentPickerDialog(
            current = settings.accent,
            onPick = { acc ->
                AppSettings.update { it.copy(accent = acc) }
                accentDialog = false
            },
            onDismiss = { accentDialog = false },
        )
    }
    if (serverDialog) {
        ServerPickerDialog(
            slots = slots,
            currentIdx = settings.selectedSlot,
            onPick = { idx ->
                AppSettings.update { it.copy(selectedSlot = idx) }
                serverDialog = false
            },
            onDismiss = { serverDialog = false },
        )
    }
}

@Composable
private fun AccentPickerDialog(
    current: AccentTheme,
    onPick: (AccentTheme) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = AntigravityColors.Nebula,
        title = { Text(stringResource(R.string.settings_accent_title), color = AntigravityColors.OnDark) },
        text = {
            Column {
                AccentTheme.entries.forEach { acc ->
                    val palette = paletteFor(acc)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onPick(acc) }
                            .padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(28.dp)
                                .clip(CircleShape)
                                .background(palette.primary),
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(
                            text = acc.displayName,
                            color = AntigravityColors.OnDark,
                            fontSize = 15.sp,
                            modifier = Modifier.weight(1f),
                        )
                        if (acc == current) {
                            Icon(Icons.Rounded.Check, contentDescription = null, tint = palette.primary)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.dialog_close), color = AntigravityColors.Aurora)
            }
        },
    )
}

@Composable
private fun ServerPickerDialog(
    slots: List<String>,
    currentIdx: Int,
    onPick: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = AntigravityColors.Nebula,
        title = { Text(stringResource(R.string.settings_server_title), color = AntigravityColors.OnDark) },
        text = {
            Column {
                if (slots.isEmpty()) {
                    Text(
                        text = stringResource(R.string.settings_server_empty),
                        color = AntigravityColors.OnDarkDim,
                    )
                } else {
                    slots.forEachIndexed { idx, label ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onPick(idx) }
                                .padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.Public,
                                contentDescription = null,
                                tint = AntigravityColors.Ion,
                            )
                            Spacer(Modifier.width(12.dp))
                            Text(
                                text = label,
                                color = AntigravityColors.OnDark,
                                fontSize = 15.sp,
                                modifier = Modifier.weight(1f),
                            )
                            if (idx == currentIdx) {
                                Icon(Icons.Rounded.Check, contentDescription = null, tint = AntigravityColors.Aurora)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.dialog_close), color = AntigravityColors.Aurora)
            }
        },
    )
}

@Composable
private fun SettingsSection(title: String, content: @Composable () -> Unit) {
    Text(
        text = title.uppercase(),
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        color = AntigravityColors.OnDarkDim,
        modifier = Modifier.padding(start = 8.dp, bottom = 8.dp),
    )
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = AntigravityColors.Nebula),
    ) {
        Column(modifier = Modifier.padding(vertical = 4.dp)) { content() }
    }
}

@Composable
private fun SettingsToggle(
    icon: ImageVector,
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(icon)
        Spacer(Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onBackground)
            Text(subtitle, fontSize = 11.sp, color = AntigravityColors.OnDarkDim)
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = AntigravityColors.OnDark,
                checkedTrackColor = AntigravityColors.Aurora,
                uncheckedThumbColor = AntigravityColors.OnDarkDim,
                uncheckedTrackColor = AntigravityColors.Cosmic,
            ),
        )
    }
}

@Composable
private fun SettingsRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(icon)
        Spacer(Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onBackground)
            Text(subtitle, fontSize = 11.sp, color = AntigravityColors.OnDarkDim)
        }
    }
}

@Composable
private fun IconTile(icon: ImageVector) {
    Box(
        modifier = Modifier
            .size(36.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(AntigravityColors.Aurora.copy(alpha = 0.16f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = AntigravityColors.Aurora,
            modifier = Modifier.size(20.dp),
        )
    }
}
