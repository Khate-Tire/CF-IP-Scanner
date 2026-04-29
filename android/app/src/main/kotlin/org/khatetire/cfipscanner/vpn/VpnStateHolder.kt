package org.khatetire.cfipscanner.vpn

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Single source of truth for the current VPN state. Both [CfVpnService] (writer)
 * and the Compose UI (reader) reference the same singleton so process death of
 * the activity (but not the service) keeps the UI consistent on rebind.
 */
object VpnStateHolder {
    private val _status = MutableStateFlow(VpnStatus())
    val status: StateFlow<VpnStatus> = _status.asStateFlow()

    fun update(transform: (VpnStatus) -> VpnStatus) {
        _status.value = transform(_status.value)
    }

    fun setState(state: VpnStatus.State) {
        _status.value = _status.value.copy(state = state)
    }

    /** Set state=FAILED with a short [reason] surfaced to the UI. */
    fun fail(reason: String) {
        _status.value = _status.value.copy(state = VpnStatus.State.FAILED, failureReason = reason)
    }
}
