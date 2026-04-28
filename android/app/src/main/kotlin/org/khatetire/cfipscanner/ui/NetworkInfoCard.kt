package org.khatetire.cfipscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Router
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.khatetire.cfipscanner.R
import org.khatetire.cfipscanner.net.IspContext
import org.khatetire.cfipscanner.ui.theme.AntigravityColors
import org.khatetire.cfipscanner.vpn.VpnStatus

/**
 * Shows the device's egress identity (Public IP, ISP, ASN, Country).
 *
 * Behaviour:
 *  • In IDLE / FAILED / DISCONNECTING the card shows the "real internet"
 *    identity (the IP your ISP exposes to the world).
 *  • In CONNECTED the card shows BOTH the last-known real identity AND the
 *    new identity observed through the tunnel, so the user can confirm the
 *    VPN actually changed their egress.
 *
 * The IP is masked by default and revealed on tap (privacy nudge).
 */
@Composable
fun NetworkInfoCard(
    state: VpnStatus.State,
    modifier: Modifier = Modifier,
) {
    val ctx = LocalContext.current
    val clipboard: ClipboardManager = LocalClipboardManager.current
    val scope = rememberCoroutineScope()

    var realInfo by remember { mutableStateOf<IspContext.Info?>(null) }
    var vpnInfo by remember { mutableStateOf<IspContext.Info?>(null) }
    var loading by remember { mutableStateOf(false) }
    var revealed by remember { mutableStateOf(false) }
    var refreshTick by remember { mutableStateOf(0) }

    // Re-fetch whenever connection state changes (idle vs connected) or the
    // user taps refresh. We never overwrite the cached "real" identity while
    // connected — that would leak the VPN exit IP into the "real" slot.
    LaunchedEffect(state, refreshTick) {
        loading = true
        try {
            val info = withContext(Dispatchers.IO) {
                runCatching { IspContext.current(forceRefresh = true) }
                    .getOrDefault(IspContext.Info())
            }
            when (state) {
                VpnStatus.State.CONNECTED -> vpnInfo = info
                VpnStatus.State.IDLE,
                VpnStatus.State.FAILED -> {
                    realInfo = info
                    vpnInfo = null
                }
                else -> Unit // CONNECTING/DISCONNECTING: don't trust the result
            }
        } finally {
            loading = false
        }
    }

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = AntigravityColors.Nebula),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Rounded.Public,
                    contentDescription = null,
                    tint = AntigravityColors.Ion,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = stringResource(R.string.netinfo_title),
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onBackground,
                    modifier = Modifier.weight(1f),
                )
                IconButton(
                    onClick = { revealed = !revealed },
                    modifier = Modifier.size(32.dp),
                ) {
                    Icon(
                        imageVector = if (revealed) Icons.Rounded.VisibilityOff
                                      else Icons.Rounded.Visibility,
                        contentDescription = stringResource(R.string.netinfo_reveal),
                        tint = AntigravityColors.OnDarkDim,
                        modifier = Modifier.size(18.dp),
                    )
                }
                IconButton(
                    onClick = { refreshTick++ },
                    modifier = Modifier.size(32.dp),
                    enabled = !loading,
                ) {
                    if (loading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(14.dp),
                            color = AntigravityColors.Ion,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Rounded.Refresh,
                            contentDescription = stringResource(R.string.netinfo_refresh),
                            tint = AntigravityColors.OnDarkDim,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }

            Spacer(Modifier.height(12.dp))

            // Real internet block (always present if we ever resolved it)
            IdentityBlock(
                title = stringResource(R.string.netinfo_real),
                info = realInfo,
                accent = AntigravityColors.OnDarkDim,
                badge = Icons.Rounded.Router,
                revealed = revealed,
                onCopy = { value -> clipboard.setText(AnnotatedString(value)) },
            )

            // After-VPN block — only shown when connected and we have a
            // distinct identity to compare against.
            if (state == VpnStatus.State.CONNECTED) {
                Spacer(Modifier.height(14.dp))
                IdentityBlock(
                    title = stringResource(R.string.netinfo_vpn),
                    info = vpnInfo,
                    accent = AntigravityColors.Ion,
                    badge = Icons.Rounded.Shield,
                    revealed = revealed,
                    onCopy = { value -> clipboard.setText(AnnotatedString(value)) },
                )
            }
        }
    }
}

@Composable
private fun IdentityBlock(
    title: String,
    info: IspContext.Info?,
    accent: Color,
    badge: ImageVector,
    revealed: Boolean,
    onCopy: (String) -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(28.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(accent.copy(alpha = 0.18f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = badge,
                contentDescription = null,
                tint = accent,
                modifier = Modifier.size(16.dp),
            )
        }
        Spacer(Modifier.width(10.dp))
        Text(
            text = title,
            fontSize = 12.sp,
            color = AntigravityColors.OnDarkDim,
            fontWeight = FontWeight.Medium,
        )
    }
    Spacer(Modifier.height(8.dp))

    val unknown = stringResource(R.string.netinfo_unknown)
    val loadingText = stringResource(R.string.netinfo_loading)

    val ip = info?.ip?.takeIf { it.isNotBlank() }
    val displayIp = when {
        info == null -> loadingText
        ip == null -> unknown
        revealed -> ip
        else -> maskIp(ip)
    }

    InfoRow(
        label = stringResource(R.string.netinfo_ip),
        value = displayIp,
        monospace = true,
        copyable = ip != null,
        onCopy = { ip?.let(onCopy) },
    )
    InfoRow(
        label = stringResource(R.string.netinfo_isp),
        value = info?.isp?.takeIf { it.isNotBlank() } ?: if (info == null) loadingText else unknown,
        copyable = !info?.isp.isNullOrBlank(),
        onCopy = { info?.isp?.takeIf { it.isNotBlank() }?.let(onCopy) },
    )
    InfoRow(
        label = stringResource(R.string.netinfo_country),
        value = info?.country?.takeIf { it.isNotBlank() } ?: if (info == null) loadingText else unknown,
        copyable = false,
        onCopy = {},
    )
    InfoRow(
        label = stringResource(R.string.netinfo_asn),
        value = info?.asn?.takeIf { it.isNotBlank() } ?: if (info == null) loadingText else unknown,
        copyable = !info?.asn.isNullOrBlank(),
        onCopy = { info?.asn?.takeIf { it.isNotBlank() }?.let(onCopy) },
    )
}

@Composable
private fun InfoRow(
    label: String,
    value: String,
    monospace: Boolean = false,
    copyable: Boolean,
    onCopy: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(28.dp)
            .let { if (copyable) it.clickable { onCopy() } else it },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            fontSize = 12.sp,
            color = AntigravityColors.OnDarkDim,
            modifier = Modifier.width(84.dp),
        )
        Text(
            text = value,
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onBackground,
            fontWeight = FontWeight.Medium,
            fontFamily = if (monospace) FontFamily.Monospace else FontFamily.Default,
            modifier = Modifier.weight(1f),
        )
    }
}

/** Mask `203.0.113.42` → `203.0.•••.•••` ; IPv6 → first 2 hextets + `•••`. */
private fun maskIp(ip: String): String {
    if (ip.contains(':')) {
        val parts = ip.split(':')
        val keep = parts.take(2).joinToString(":")
        return "$keep:••••:••••"
    }
    val parts = ip.split('.')
    if (parts.size != 4) return "•••"
    return "${parts[0]}.${parts[1]}.•••.•••"
}
