package org.khatetire.cfipscanner.widget

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.actionStartActivity
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartService
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.unit.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.material3.ColorProviders
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.compose.material3.darkColorScheme
import androidx.glance.action.clickable
import org.khatetire.cfipscanner.MainActivity
import org.khatetire.cfipscanner.vpn.CfVpnService
import org.khatetire.cfipscanner.vpn.VpnStateHolder
import org.khatetire.cfipscanner.vpn.VpnStatus
import androidx.compose.ui.graphics.Color as ComposeColor

class CfWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = CfWidget()
}

private val widgetColors = ColorProviders(
    light = darkColorScheme(),
    dark = darkColorScheme(),
)

class CfWidget : GlanceAppWidget() {

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            GlanceTheme(colors = widgetColors) {
                Content()
            }
        }
    }

    @Composable
    private fun Content() {
        val status by VpnStateHolder.status.collectAsState()
        val connected = status.state == VpnStatus.State.CONNECTED
        val bg = ColorProvider(if (connected) ComposeColor(0xFF1A2050) else ComposeColor(0xFF0E1130))
        Box(
            modifier = GlanceModifier
                .fillMaxSize()
                .cornerRadius(16.dp)
                .background(bg)
                .padding(12.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                modifier = GlanceModifier.fillMaxSize(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = if (connected) "In orbit" else "Antigravity",
                    style = TextStyle(
                        color = ColorProvider(ComposeColor(0xFFEDEEFB)),
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                    ),
                )
                Spacer(GlanceModifier.height(4.dp))
                Text(
                    text = if (connected && status.cleanIp.isNotBlank()) status.cleanIp
                        else status.state.name.lowercase(),
                    style = TextStyle(
                        color = ColorProvider(ComposeColor(0xFF00E5FF)),
                        fontSize = 12.sp,
                    ),
                )
                Spacer(GlanceModifier.height(8.dp))
                ToggleButton(connected)
            }
        }
    }

    @Composable
    private fun ToggleButton(connected: Boolean) {
        val ctx = androidx.glance.LocalContext.current
        val intent = if (connected) CfVpnService.disconnectIntent(ctx)
            else Intent(ctx, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        Box(
            modifier = GlanceModifier
                .fillMaxWidth()
                .height(36.dp)
                .cornerRadius(10.dp)
                .background(ColorProvider(if (connected) ComposeColor(0xFFFF3DCB) else ComposeColor(0xFF7B61FF)))
                .clickable(
                    if (connected) actionStartService(intent, isForegroundService = true)
                    else actionStartActivity<MainActivity>()
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = if (connected) "Disconnect" else "Lift off",
                style = TextStyle(
                    color = ColorProvider(ComposeColor(0xFFEDEEFB)),
                    fontWeight = FontWeight.Medium,
                    fontSize = 13.sp,
                ),
            )
        }
    }
}
