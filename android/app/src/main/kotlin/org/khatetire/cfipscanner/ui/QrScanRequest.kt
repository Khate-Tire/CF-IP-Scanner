package org.khatetire.cfipscanner.ui

import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Tiny global flag used to request opening the QR-scanner overlay from
 * deep within the Compose tree (e.g. the Manual-IP dialog) without having
 * to thread a callback through every screen.
 */
object QrScanRequest {
    val open = MutableStateFlow(false)
    fun request() { open.value = true }
    fun consume() { open.value = false }
}
