package org.khatetire.cfipscanner.bootstrap

/**
 * JNI bridge for decrypting `assets/bootstrap.bin` in native memory.
 *
 * Phase 1 ships a pure-Kotlin fallback in [BootstrapLoader] so the app works
 * before the native library is built. When the native lib is present this
 * class returns a UTF-8 byte array of the plaintext; the caller MUST zero the
 * array immediately after parsing into [org.khatetire.cfipscanner.model.VlessConfig].
 *
 * Native side: see `app/src/main/cpp/bootstrap_native.c`.
 */
object BootstrapNative {
    @Volatile private var loaded = false

    fun isAvailable(): Boolean {
        if (loaded) return true
        return try {
            System.loadLibrary("bootstrap_native")
            loaded = true
            true
        } catch (_: Throwable) {
            false
        }
    }

    /** AES-GCM decrypt. Returns null on auth failure. Caller must wipe result. */
    external fun loadAndDecrypt(blob: ByteArray, key: ByteArray): ByteArray?
}
