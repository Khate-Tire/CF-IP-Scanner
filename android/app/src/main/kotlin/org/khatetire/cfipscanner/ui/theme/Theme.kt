package org.khatetire.cfipscanner.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Offset
import org.khatetire.cfipscanner.settings.AccentTheme
import org.khatetire.cfipscanner.settings.AppSettings

// =============================================================================
// Antigravity palette — deep cosmic theme. Always-dark by design.
// =============================================================================
object AntigravityColors {
    val Space      = Color(0xFF06081A)
    val Nebula     = Color(0xFF0E1130)
    val Cosmic     = Color(0xFF161A45)
    val Stardust   = Color(0xFF222866)

    val Aurora     = Color(0xFF7B61FF)
    val AuroraSoft = Color(0xFFB39DFF)
    val Ion        = Color(0xFF00E5FF)
    val Plasma     = Color(0xFFFF3DCB)
    val Solar      = Color(0xFFFFC857)
    val Critical   = Color(0xFFFF4D6D)

    val OnDark     = Color(0xFFEDEEFB)
    val OnDarkDim  = Color(0xFF9CA0C9)
}

/** Resolved accent triad for the current theme. */
data class AccentPalette(
    val primary: Color,
    val secondary: Color,
    val tertiary: Color,
)

val LocalAccent = compositionLocalOf { paletteFor(AccentTheme.AURORA) }

fun paletteFor(accent: AccentTheme): AccentPalette = when (accent) {
    AccentTheme.AURORA -> AccentPalette(AntigravityColors.Aurora, AntigravityColors.Ion,    AntigravityColors.Plasma)
    AccentTheme.ION    -> AccentPalette(AntigravityColors.Ion,    AntigravityColors.Aurora, AntigravityColors.Plasma)
    AccentTheme.PLASMA -> AccentPalette(AntigravityColors.Plasma, AntigravityColors.Aurora, AntigravityColors.Ion)
    AccentTheme.SOLAR  -> AccentPalette(AntigravityColors.Solar,  AntigravityColors.Aurora, AntigravityColors.Plasma)
}

private fun schemeFor(accent: AccentTheme) = darkColorScheme(
    primary             = paletteFor(accent).primary,
    onPrimary           = Color.White,
    primaryContainer    = AntigravityColors.Cosmic,
    onPrimaryContainer  = AntigravityColors.OnDark,
    secondary           = paletteFor(accent).secondary,
    onSecondary         = AntigravityColors.Space,
    tertiary            = paletteFor(accent).tertiary,
    onTertiary          = Color.White,
    background          = AntigravityColors.Space,
    onBackground        = AntigravityColors.OnDark,
    surface             = AntigravityColors.Nebula,
    onSurface           = AntigravityColors.OnDark,
    surfaceVariant      = AntigravityColors.Cosmic,
    onSurfaceVariant    = AntigravityColors.OnDarkDim,
    outline             = AntigravityColors.Stardust,
    error               = AntigravityColors.Critical,
)

@Composable
fun AntigravityTheme(content: @Composable () -> Unit) {
    val settings by AppSettings.state.collectAsState()
    val accent = settings.accent
    val palette = paletteFor(accent)
    CompositionLocalProvider(LocalAccent provides palette) {
        MaterialTheme(colorScheme = schemeFor(accent), content = content)
    }
}

@Composable
fun KhateTheme(content: @Composable () -> Unit) = AntigravityTheme(content)

object AntigravityBrushes {
    val backdrop: Brush = Brush.linearGradient(
        colors = listOf(
            Color(0xFF06081A),
            Color(0xFF0B0E2C),
            Color(0xFF13093A),
        ),
        start = Offset.Zero,
        end = Offset.Infinite,
    )

    val orbConnected: Brush = Brush.radialGradient(
        colors = listOf(
            AntigravityColors.Ion,
            AntigravityColors.Aurora,
            AntigravityColors.Plasma.copy(alpha = 0.85f),
        ),
        radius = 600f,
    )

    val orbIdle: Brush = Brush.radialGradient(
        colors = listOf(
            AntigravityColors.Cosmic,
            AntigravityColors.Nebula,
            AntigravityColors.Space,
        ),
        radius = 600f,
    )

    val orbConnecting: Brush = Brush.radialGradient(
        colors = listOf(
            AntigravityColors.AuroraSoft,
            AntigravityColors.Aurora,
            AntigravityColors.Cosmic,
        ),
        radius = 600f,
    )

    val orbFailed: Brush = Brush.radialGradient(
        colors = listOf(
            AntigravityColors.Critical,
            Color(0xFF6E1830),
            AntigravityColors.Space,
        ),
        radius = 600f,
    )

    val accentSweep: Brush = Brush.horizontalGradient(
        colors = listOf(AntigravityColors.Ion, AntigravityColors.Aurora, AntigravityColors.Plasma),
    )

    fun orbConnectedFor(accent: AccentTheme): Brush {
        val p = paletteFor(accent)
        return Brush.radialGradient(
            colors = listOf(p.secondary, p.primary, p.tertiary.copy(alpha = 0.85f)),
            radius = 600f,
        )
    }
}


