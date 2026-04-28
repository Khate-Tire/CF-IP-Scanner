package org.khatetire.cfipscanner.util

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * Thin wrapper around [BiometricPrompt] that falls back to device credential
 * (PIN/pattern/password) when no biometric enrollment is available. Designed
 * so callers don't have to know whether the device has fingerprint, face, or
 * just a screen lock — they just want "is the user present".
 *
 * If no auth at all is enrollable on the device, [authenticate] succeeds
 * immediately so the lock toggle never bricks the UI on stock emulators.
 */
object BiometricGate {

    /** True when *something* (biometric or device credential) can be used. */
    fun isAvailable(ctx: Context): Boolean {
        val bm = BiometricManager.from(ctx)
        val authenticators = BiometricManager.Authenticators.BIOMETRIC_WEAK or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL
        return bm.canAuthenticate(authenticators) == BiometricManager.BIOMETRIC_SUCCESS
    }

    /**
     * Show the system biometric prompt. [onSuccess] runs on the main thread
     * after positive auth; [onFailure] runs on cancel / hard error / lockout.
     */
    fun authenticate(
        activity: FragmentActivity,
        title: String,
        subtitle: String? = null,
        onSuccess: () -> Unit,
        onFailure: () -> Unit = {},
    ) {
        if (!isAvailable(activity)) {
            // No lock at all on the device — let the user through; the toggle
            // still serves as a "remember to enroll" hint via [isAvailable].
            onSuccess(); return
        }
        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(
            activity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    onSuccess()
                }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    onFailure()
                }
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .apply { if (!subtitle.isNullOrBlank()) setSubtitle(subtitle) }
            .setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_WEAK or
                    BiometricManager.Authenticators.DEVICE_CREDENTIAL
            )
            .build()
        prompt.authenticate(info)
    }
}
