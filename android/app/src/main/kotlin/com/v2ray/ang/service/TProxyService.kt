package com.v2ray.ang.service

/**
 * JNI binding for `libhev-socks5-tunnel.so` from the v2rayNG project.
 *
 * The .so's `JNI_OnLoad` calls `RegisterNatives` against this exact class
 * name + package, so we must keep both. This file is intentionally a stub
 * with only the native declarations the .so binds to.
 */
object TProxyService {
    init {
        // Load the .so from this class's static initializer so that JNI_OnLoad's
        // FindClass("com/v2ray/ang/service/TProxyService") resolves against the
        // app's class loader (the one that loaded this class), not the bootstrap
        // loader (which can't see app classes and would cause RegisterNatives to
        // fail, making System.loadLibrary throw UnsatisfiedLinkError).
        System.loadLibrary("hev-socks5-tunnel")
    }

    @JvmStatic external fun TProxyStartService(configPath: String, fd: Int)
    @JvmStatic external fun TProxyStopService()
    @JvmStatic external fun TProxyGetStats(): LongArray
}
