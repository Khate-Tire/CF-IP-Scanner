package org.khatetire.cfipscanner.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.PowerSettingsNew
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate as drawRotate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import org.khatetire.cfipscanner.ui.theme.AntigravityBrushes
import org.khatetire.cfipscanner.ui.theme.AntigravityColors
import org.khatetire.cfipscanner.vpn.VpnStatus

/**
 * The Antigravity hero element: a layered orb with two animated rings, an
 * inner gradient core, and a power icon. Tap to lift off / land.
 */
@Composable
fun ConnectOrb(
    state: VpnStatus.State,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val brush: Brush = when (state) {
        VpnStatus.State.CONNECTED      -> AntigravityBrushes.orbConnected
        VpnStatus.State.CONNECTING,
        VpnStatus.State.DISCONNECTING  -> AntigravityBrushes.orbConnecting
        VpnStatus.State.FAILED         -> AntigravityBrushes.orbFailed
        else                           -> AntigravityBrushes.orbIdle
    }
    val scale by animateFloatAsState(
        targetValue = if (state == VpnStatus.State.CONNECTED) 1.04f else 1f,
        animationSpec = tween(durationMillis = 600),
        label = "orbScale",
    )

    val transition = rememberInfiniteTransition(label = "orbRing")
    val rotation by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = if (state == VpnStatus.State.CONNECTING) 1800 else 7200,
                easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "orbRotation",
    )
    val pulse by transition.animateFloat(
        initialValue = 0.85f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1400),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "orbPulse",
    )

    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(280.dp)
            .scale(scale)
            // Modifier.clickable provides proper semantics (Role.Button) so
            // TalkBack/Switch Access/UIAutomator all see the orb as tappable.
            // pointerInput-only orbs are invisible to accessibility and can
            // also drop taps when their `key` (state) flips during press.
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                role = Role.Button,
                onClick = onClick,
            ),
    ) {
        // Outer rotating accent arc.
        Canvas(modifier = Modifier.fillMaxSize()) {
            val stroke = 4f
            val sweep = when (state) {
                VpnStatus.State.CONNECTED -> 280f
                VpnStatus.State.CONNECTING, VpnStatus.State.DISCONNECTING -> 110f
                VpnStatus.State.FAILED -> 220f
                else -> 220f
            }
            // dim base ring
            drawCircle(
                color = AntigravityColors.Stardust.copy(alpha = 0.35f),
                style = Stroke(width = stroke),
            )
            // gradient sweep ring
            drawRotate(degrees = rotation) {
                drawArc(
                    brush = Brush.sweepGradient(
                        listOf(
                            AntigravityColors.Ion,
                            AntigravityColors.Aurora,
                            AntigravityColors.Plasma,
                            AntigravityColors.Ion,
                        ),
                    ),
                    startAngle = 0f,
                    sweepAngle = sweep,
                    useCenter = false,
                    style = Stroke(width = stroke * 1.6f),
                )
            }
        }

        // Mid soft glow ring (only when connected — extra emphasis).
        if (state == VpnStatus.State.CONNECTED) {
            Box(
                modifier = Modifier
                    .size((220f * pulse).dp)
                    .clip(CircleShape)
                    .background(
                        Brush.radialGradient(
                            colors = listOf(
                                AntigravityColors.Aurora.copy(alpha = 0.30f),
                                Color.Transparent,
                            ),
                        )
                    ),
            )
        }

        // Inner core orb.
        Box(
            modifier = Modifier
                .size(180.dp)
                .clip(CircleShape)
                .background(brush),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Rounded.PowerSettingsNew,
                contentDescription = null,
                tint = if (state == VpnStatus.State.IDLE) AntigravityColors.OnDarkDim
                       else MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(64.dp),
            )
        }
    }
}
