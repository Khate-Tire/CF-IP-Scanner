package com.v2ray.ang.service

/**
 * JNI binding stub for `libhev-socks5-tunnel.so` from the v2rayNG project.
 *
 * The .so's `JNI_OnLoad` calls `RegisterNatives` against this exact class
 * (FQN: `com/v2ray/ang/service/TProxyService`) with these exact method names
 * and signatures. We MUST mirror v2rayNG's source layout precisely:
 *  - a top-level `class` (not `object`) — Kotlin emits a real static method
 *    on the outer class for `@JvmStatic` inside a `companion object`, which
 *    is what JNI RegisterNatives needs.
 *  - the native lib loaded from inside the *companion object's* `init` block
 *    so JNI_OnLoad's FindClass uses the app's class loader (the loader that
 *    triggered loadLibrary) and resolves this class's FQN successfully.
 *
 * Keep rules in `proguard-rules.pro` keep this class and its companion
 * intact so R8 doesn't rename or strip them in release builds.
 */
class TProxyService {
    companion object {
        init {
            System.loadLibrary("hev-socks5-tunnel")
        }

        @JvmStatic external fun TProxyStartService(configPath: String, fd: Int)
        @JvmStatic external fun TProxyStopService()
        @JvmStatic external fun TProxyGetStats(): LongArray?
    }
}

