package org.khatetire.cfipscanner.xray

import android.content.Context
import android.util.Log
import java.io.File

/**
 * Reflective binding to the libv2ray AAR (`libv2ray.aar`) — newer API:
 *   libv2ray.Libv2ray.initCoreEnv(envPath, key)
 *   libv2ray.Libv2ray.newCoreController(handler) -> CoreController
 *   coreController.startLoop(content, port)
 *   coreController.stopLoop()
 *
 * Compiles even when the AAR is absent. When absent, [start] returns false.
 */
class XrayController(private val context: Context? = null) {

    private var controller: Any? = null
    private var running = false

    fun isAvailable(): Boolean = LIBXRAY_AVAILABLE

    fun start(jsonConfig: String, domainAndPort: String = "1.1.1.1:443"): Boolean {
        if (running) return true
        val ctx = context
        if (!LIBXRAY_AVAILABLE) {
            Log.w(TAG, "libv2ray AAR not present; cannot start Xray.")
            return false
        }
        if (ctx == null) {
            Log.e(TAG, "Context required to initialise libv2ray env.")
            return false
        }
        return try {
            val libCls = Class.forName(LIB_FQN)
            val handlerCls = Class.forName(HANDLER_FQN)

            // Ensure geo data is on disk where Xray expects it.
            val envDir = File(ctx.filesDir, "v2ray").apply { mkdirs() }
            ensureAssetCopied(ctx, "geoip.dat", File(envDir, "geoip.dat"))
            ensureAssetCopied(ctx, "geosite.dat", File(envDir, "geosite.dat"))

            try {
                libCls.getMethod("initCoreEnv", String::class.java, String::class.java)
                    .invoke(null, envDir.absolutePath, "")
            } catch (t: Throwable) {
                Log.w(TAG, "initCoreEnv failed (continuing): ${t.message}")
            }

            val handler = java.lang.reflect.Proxy.newProxyInstance(
                handlerCls.classLoader, arrayOf(handlerCls)
            ) { _, method, args ->
                if (method.name == "onEmitStatus" && (args?.size ?: 0) >= 2) {
                    Log.i(TAG, "v2ray status: ${args!![1]}")
                }
                0L
            }

            val cc = libCls.getMethod("newCoreController", handlerCls).invoke(null, handler)
                ?: error("newCoreController returned null")

            val ccCls = cc.javaClass
            val startLoop = ccCls.methods.firstOrNull { it.name == "startLoop" }
                ?: error("startLoop method not found")
            when (startLoop.parameterTypes.size) {
                2 -> startLoop.invoke(cc, jsonConfig, 10808)
                1 -> startLoop.invoke(cc, jsonConfig)
                else -> error("Unexpected startLoop arity ${startLoop.parameterTypes.size}")
            }
            controller = cc
            running = true
            Log.i(TAG, "XrayController started (CoreController API).")
            true
        } catch (t: Throwable) {
            Log.e(TAG, "XrayController.start failed: ${t.message}", t)
            running = false
            false
        }
    }

    fun stop() {
        if (!running) return
        try {
            controller?.let { it.javaClass.getMethod("stopLoop").invoke(it) }
        } catch (t: Throwable) {
            Log.w(TAG, "stopLoop threw: ${t.message}")
        }
        controller = null
        running = false
    }

    fun isRunning(): Boolean = running

    private fun ensureAssetCopied(ctx: Context, assetName: String, dest: File) {
        if (dest.exists() && dest.length() > 0) return
        try {
            ctx.assets.open(assetName).use { input ->
                dest.outputStream().use { out -> input.copyTo(out) }
            }
            Log.i(TAG, "copied asset $assetName -> ${dest.absolutePath} (${dest.length()} bytes)")
        } catch (t: Throwable) {
            Log.w(TAG, "asset $assetName not bundled: ${t.message}")
        }
    }

    companion object {
        private const val TAG = "XrayController"
        private const val LIB_FQN = "libv2ray.Libv2ray"
        private const val HANDLER_FQN = "libv2ray.CoreCallbackHandler"
        private const val CC_FQN = "libv2ray.CoreController"

        val LIBXRAY_AVAILABLE: Boolean by lazy {
            try { Class.forName(CC_FQN); true } catch (_: Throwable) { false }
        }
    }
}
