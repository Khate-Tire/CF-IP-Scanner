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
import androidx.compose.material.icons.rounded.Code
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.PrivacyTip
import androidx.compose.material.icons.rounded.RocketLaunch
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.khatetire.cfipscanner.BuildConfig
import org.khatetire.cfipscanner.R
import org.khatetire.cfipscanner.ui.theme.AntigravityBrushes
import org.khatetire.cfipscanner.ui.theme.AntigravityColors

@Composable
fun AboutScreen(
    anonymousId: String,
    onOpenLink: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(96.dp)
                .clip(CircleShape)
                .background(AntigravityBrushes.orbConnected),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Rounded.RocketLaunch,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(48.dp),
            )
        }
        Spacer(Modifier.height(16.dp))
        Text(
            text = stringResource(R.string.app_name),
            fontSize = 26.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = stringResource(R.string.about_version, BuildConfig.VERSION_NAME),
            fontSize = 12.sp,
            color = AntigravityColors.OnDarkDim,
        )
        Spacer(Modifier.height(24.dp))
        Text(
            text = stringResource(R.string.about_description),
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = stringResource(R.string.about_credits),
            fontSize = 12.sp,
            color = AntigravityColors.OnDarkDim,
            modifier = Modifier.padding(horizontal = 8.dp),
        )

        Spacer(Modifier.height(24.dp))

        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = AntigravityColors.Nebula),
        ) {
            Column {
                LinkRow(
                    icon = Icons.Rounded.Code,
                    label = stringResource(R.string.about_link_github),
                ) { onOpenLink("https://github.com/Khate-Tire/CF-IP-Scanner") }
                Divider()
                LinkRow(
                    icon = Icons.Rounded.Public,
                    label = stringResource(R.string.about_link_telegram),
                ) { onOpenLink("https://t.me/ANTIGRAVITY_IP") }
                Divider()
                LinkRow(
                    icon = Icons.Rounded.PrivacyTip,
                    label = stringResource(R.string.about_link_privacy),
                ) { onOpenLink("https://github.com/Khate-Tire/CF-IP-Scanner#privacy") }
            }
        }

        Spacer(Modifier.height(20.dp))

        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = AntigravityColors.Nebula),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = stringResource(R.string.about_anonymous_id),
                    fontSize = 11.sp,
                    color = AntigravityColors.OnDarkDim,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = anonymousId,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onBackground,
                )
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun LinkRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = AntigravityColors.Aurora,
            modifier = Modifier.size(22.dp),
        )
        Spacer(Modifier.width(14.dp))
        Text(
            text = label,
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.weight(1f),
        )
        Text(text = "›", fontSize = 22.sp, color = AntigravityColors.OnDarkDim)
    }
}

@Composable
private fun Divider() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(AntigravityColors.Cosmic),
    )
}
