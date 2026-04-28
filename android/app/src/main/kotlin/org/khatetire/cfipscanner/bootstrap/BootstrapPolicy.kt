package org.khatetire.cfipscanner.bootstrap

import org.khatetire.cfipscanner.model.VlessConfig

/**
 * Hard runtime guard against accidentally surfacing bootstrap config fields.
 * Tracks identity (System.identityHashCode) of bootstrap-sourced configs so
 * Share / Copy / QR / Export buttons can call [isShareable] before invoking
 * any user-facing sink.
 *
 * Configs vended by the L1–L5 community DB pipeline are NOT registered here
 * and therefore ARE shareable (subject to the server's `shareable: true` flag).
 */
object BootstrapPolicy {
    private val bootstrapIds = java.util.Collections.newSetFromMap(
        java.util.IdentityHashMap<VlessConfig, Boolean>()
    )

    fun markBootstrap(configs: Iterable<VlessConfig>) {
        configs.forEach { bootstrapIds.add(it) }
    }

    fun isBootstrap(cfg: VlessConfig): Boolean = bootstrapIds.contains(cfg)

    fun isShareable(cfg: VlessConfig): Boolean = !isBootstrap(cfg)

    /** Throws if the caller tries to surface a bootstrap config to a user sink. */
    fun assertSafeSink(cfg: VlessConfig, sink: String) {
        if (isBootstrap(cfg)) {
            throw SecurityException("Refused to expose bootstrap config to sink=$sink")
        }
    }
}
