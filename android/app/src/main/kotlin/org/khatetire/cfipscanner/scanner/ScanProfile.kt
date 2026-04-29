package org.khatetire.cfipscanner.scanner

import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

/**
 * Output of [ScanRateController]. Tells the scanner how aggressive to be right
 * now. Higher tier = faster cadence + more parallelism. The scanner reads the
 * latest profile each time it finishes one batch.
 */
enum class ScanProfile(
    val interval: Duration,
    val parallelism: Int,
    val description: String,
) {
    /** Stopped completely (e.g., user disabled, hard cap reached, hot device). */
    PAUSED(Duration.INFINITE, 0, "Paused"),

    /** Connected + actively using the phone — stay out of the way. */
    MINIMAL(60.seconds, 1, "Minimal — you're using the phone"),

    /** Connected + idle/screen off — moderate background scan. */
    NORMAL(10.seconds, 2, "Normal — connected, idle"),

    /** Connected + idle + on charger — go a bit faster. */
    BOOST(3.seconds, 3, "Boost — charging"),

    /** Not yet connected — burn the queue to find a good IP fast.
     *  Parallelism = 32 ("discovery mode"): the in-flight TCP probes are
     *  cheap (single 2s-bounded handshake each, no TLS/HTTP unless the
     *  cheap probe passes) so we can comfortably keep dozens in flight on
     *  modern devices. The runDbCycle/runShardCycle paths bound this with
     *  a Semaphore, so we won't actually open more than `parallelism`
     *  sockets at once. */
    MAXIMUM(200.milliseconds, 32, "Maximum — searching for clean IP"),
}
