package com.v2ray.ang.service

/**
 * JNI binding for `libhev-socks5-tunnel.so` from the v2rayNG project.
 *
 * The .so's `JNI_OnLoad` calls `RegisterNatives` against this exact class
 * name + package, so we must keep both. This file is intentionally a stub
 * with only the native declarations the .so binds to.
 */
object TProxyService {
    @JvmStatic external fun TProxyStartService(configPath: String, fd: Int)
    @JvmStatic external fun TProxyStopService()
    @JvmStatic external fun TProxyGetStats(): LongArray
}
