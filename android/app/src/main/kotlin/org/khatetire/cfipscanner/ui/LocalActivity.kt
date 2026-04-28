package org.khatetire.cfipscanner.ui

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.fragment.app.FragmentActivity

/**
 * CompositionLocal exposing the hosting [FragmentActivity] to Compose code.
 * Used by features that need an Activity reference (e.g. BiometricPrompt,
 * QR scanner permission requests).
 */
val LocalActivity = staticCompositionLocalOf<FragmentActivity?> { null }
