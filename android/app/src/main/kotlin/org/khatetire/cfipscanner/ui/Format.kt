package org.khatetire.cfipscanner.ui

import java.util.Locale

internal fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val units = arrayOf("KB", "MB", "GB", "TB")
    var v = bytes.toDouble() / 1024.0
    var i = 0
    while (v >= 1024.0 && i < units.lastIndex) { v /= 1024.0; i++ }
    return String.format(Locale.US, if (v >= 100) "%.0f %s" else "%.1f %s", v, units[i])
}

internal fun formatUptime(sec: Long): String {
    if (sec <= 0) return "—"
    val h = sec / 3600
    val m = (sec % 3600) / 60
    val s = sec % 60
    return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s)
           else      String.format(Locale.US, "%d:%02d", m, s)
}

internal fun formatRelative(timestampMs: Long, nowMs: Long = System.currentTimeMillis()): String {
    val d = ((nowMs - timestampMs) / 1000L).coerceAtLeast(0)
    return when {
        d < 5 -> "just now"
        d < 60 -> "${d}s ago"
        d < 3600 -> "${d / 60}m ago"
        else -> "${d / 3600}h ago"
    }
}
