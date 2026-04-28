package org.khatetire.cfipscanner.vpn

/**
 * Snapshot of VPN session telemetry surfaced to the UI. Carries the picked
 * Cloudflare edge IP ([cleanIp]) for the user-facing "connected to" label —
 * this is a public CF anycast IP, not a secret. SNI / UUID / path stay
 * encrypted in the bootstrap and are never surfaced here.
 */
data class VpnStatus(
    val state: State = State.IDLE,
    val colo: String = "",          // "FRA", "AMS", … (Cloudflare colo code)
    val pingMs: Int = 0,
    val uptimeSec: Long = 0L,
    val bytesIn: Long = 0L,
    val bytesOut: Long = 0L,
    val rateInBps: Long = 0L,       // current download rate (bytes/sec)
    val rateOutBps: Long = 0L,
    val serverSlot: String = "EU-1",
    val cleanIp: String = "",       // currently connected Cloudflare edge IP
) {
    enum class State { IDLE, CONNECTING, CONNECTED, DISCONNECTING, FAILED }
}
