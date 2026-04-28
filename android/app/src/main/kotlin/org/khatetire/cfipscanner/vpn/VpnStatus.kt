package org.khatetire.cfipscanner.vpn

/**
 * Snapshot of VPN session telemetry surfaced to the UI. **Intentionally
 * minimal** — never carries SNI, host, IP, UUID, or path. Display layer maps
 * [colo] + [pingMs] to the user-visible "Frankfurt · 32 ms" string and uses
 * [serverSlot] for the redacted slot label.
 */
data class VpnStatus(
    val state: State = State.IDLE,
    val colo: String = "",          // "FRA", "AMS", … (Cloudflare colo code)
    val pingMs: Int = 0,
    val uptimeSec: Long = 0L,
    val bytesIn: Long = 0L,
    val bytesOut: Long = 0L,
    val rateInBps: Long = 0L,       // current download rate (bytes/sec)
    val rateOutBps: Long = 0L,      // current upload rate (bytes/sec)
    val serverSlot: String = "EU-1",
) {
    enum class State { IDLE, CONNECTING, CONNECTED, DISCONNECTING, FAILED }
}
