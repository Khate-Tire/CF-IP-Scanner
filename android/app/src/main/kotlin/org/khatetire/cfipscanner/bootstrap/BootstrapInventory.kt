package org.khatetire.cfipscanner.bootstrap

import android.content.Context

/**
 * Public, non-sensitive view of the bootstrap config list. Returns only
 * count + redacted slot labels — never host, sni, uuid, or path.
 */
object BootstrapInventory {
    fun slots(context: Context): List<String> {
        val n = BootstrapLoader.load(context).size
        if (n == 0) return emptyList()
        return List(n) { i -> "Orbit slot ${i + 1}" }
    }
}
