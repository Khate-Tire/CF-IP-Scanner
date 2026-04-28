package org.khatetire.cfipscanner.bootstrap

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import org.khatetire.cfipscanner.model.VlessConfig
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Loads `assets/bootstrap.bin` (AES-GCM ciphertext produced by Gradle
 * `encryptBootstrap` task), derives the decryption key from the **release
 * keystore signing fingerprint at runtime**, decrypts, parses VLESS URIs, and
 * returns a [List] of [VlessConfig].
 *
 * Confidentiality contract:
 * - The plaintext URIs never touch disk.
 * - The plaintext byte array is zeroed after parsing.
 * - The returned [VlessConfig.toString] is redacted; ProGuard further strips it.
 * - Caller MUST NOT log, copy to clipboard, share, export, or QR-encode any
 *   field of these configs (see `BootstrapPolicy.assertSafeSink`).
 *
 * Blob format (must match `app/build.gradle.kts` `encryptBootstrap`):
 *   magic[4]   = "KFN1"
 *   iv[12]
 *   ciphertext = AES-GCM(plaintext UTF-8 newline-joined VLESS URIs)
 */
object BootstrapLoader {
    private const val TAG = "Bootstrap"
    private const val MAGIC = "KFN1"

    @Volatile private var cached: List<VlessConfig>? = null

    fun load(context: Context): List<VlessConfig> {
        cached?.let { return it }
        return try {
            val blob = context.assets.open("bootstrap.bin").use { it.readBytes() }
            Log.i(TAG, "bootstrap.bin size=${blob.size} bytes")
            if (blob.size < 4 + 12 + 16 || String(blob, 0, 4) != MAGIC) {
                Log.w(TAG, "bootstrap.bin invalid magic or too small"); emptyList()
            } else {
                val out = decrypt(blob, deriveKey(context))
                Log.i(TAG, "decrypted ${out.size} VLESS config(s)")
                cached = out
                out
            }
        } catch (t: Throwable) {
            Log.e(TAG, "bootstrap load failed: ${t.message}", t)
            emptyList()
        }
    }

    private fun decrypt(blob: ByteArray, key: ByteArray): List<VlessConfig> {
        val iv = blob.copyOfRange(4, 16)
        val ct = blob.copyOfRange(16, blob.size)

        // Pre-flight: detect the placeholder blob written when env is unset.
        if (iv.all { it == 0.toByte() } && ct.size == 16 && ct.all { it == 0.toByte() }) {
            Log.w(TAG, "placeholder bootstrap.bin (no real configs baked in)")
            return emptyList()
        }

        val plaintext: ByteArray = run {
            val nativePt = if (BootstrapNative.isAvailable()) BootstrapNative.loadAndDecrypt(blob, key) else null
            if (nativePt != null) return@run nativePt
            // Native stub or auth failure → fall back to JCE.
            try {
                Cipher.getInstance("AES/GCM/NoPadding").run {
                    init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
                    doFinal(ct)
                }
            } catch (t: Throwable) {
                Log.e(TAG, "AES-GCM decrypt failed (key mismatch?): ${t.message}")
                null
            }
        } ?: return emptyList()

        Log.i(TAG, "plaintext ${plaintext.size} bytes; first byte=0x${"%02x".format(plaintext[0])}")

        return try {
            String(plaintext, Charsets.UTF_8).lineSequence()
                .map { it.trim() }
                .filter { it.startsWith("vless://") }
                .mapNotNull { runCatching { VlessConfig.parse(it) }.getOrNull() }
                .toList()
        } finally {
            plaintext.fill(0)
        }
    }

    /**
     * Derive the AES key from the app's signing certificate SHA-256.
     * Must match what the CI workflow puts into `BOOTSTRAP_KEY`
     * (typically the same fingerprint hex string).
     */
    private fun deriveKey(context: Context): ByteArray {
        val pm = context.packageManager
        val pkg = context.packageName
        val sigBytes: ByteArray = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                @Suppress("DEPRECATION")
                val info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES)
                val signers = info.signingInfo?.apkContentsSigners
                    ?: info.signingInfo?.signingCertificateHistory
                signers?.firstOrNull()?.toByteArray() ?: ByteArray(0)
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES)
                    .signatures?.firstOrNull()?.toByteArray() ?: ByteArray(0)
            }
        } catch (_: Throwable) {
            ByteArray(0)
        }
        val fingerprintHex = MessageDigest.getInstance("SHA-256").digest(sigBytes)
            .joinToString("") { "%02X".format(it) }
        Log.i(TAG, "deriveKey: sigBytes=${sigBytes.size}B fp=$fingerprintHex")
        return MessageDigest.getInstance("SHA-256").digest(fingerprintHex.toByteArray())
    }
}
