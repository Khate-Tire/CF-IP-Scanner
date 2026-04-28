package org.khatetire.cfipscanner.settings

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Persistent app settings backed by DataStore. Exposed as a process-wide
 * singleton via [AppSettings.init] (called from [org.khatetire.cfipscanner.KhateApp]).
 *
 * Pure UI/preference data only — never store secrets here.
 */
private val Context.dataStore by preferencesDataStore(name = "antigravity_settings")

enum class AccentTheme(val displayName: String) {
    AURORA("Aurora"), ION("Ion"), PLASMA("Plasma"), SOLAR("Solar")
}

data class Settings(
    val autoConnect: Boolean = false,
    val scanWifiOnly: Boolean = true,
    val scanChargingOnly: Boolean = false,
    val shareResults: Boolean = true,
    val killSwitch: Boolean = false,
    val lanBypass: Boolean = true,
    val accent: AccentTheme = AccentTheme.AURORA,
    val selectedSlot: Int = 0,
    /** When non-blank, pin the VPN to this clean IP and disable auto-rotation. */
    val manualCleanIp: String = "",
)

object AppSettings {
    private val K_AUTO     = booleanPreferencesKey("auto_connect")
    private val K_WIFI     = booleanPreferencesKey("scan_wifi_only")
    private val K_CHARGE   = booleanPreferencesKey("scan_charging_only")
    private val K_SHARE    = booleanPreferencesKey("share_results")
    private val K_KILL     = booleanPreferencesKey("kill_switch")
    private val K_LAN      = booleanPreferencesKey("lan_bypass")
    private val K_ACCENT   = intPreferencesKey("accent_theme")
    private val K_SLOT     = intPreferencesKey("selected_slot")
    private val K_MANUAL   = stringPreferencesKey("manual_clean_ip")

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _state = MutableStateFlow(Settings())
    val state: StateFlow<Settings> = _state.asStateFlow()

    private lateinit var appContext: Context

    fun init(ctx: Context) {
        if (::appContext.isInitialized) return
        appContext = ctx.applicationContext
        scope.launch {
            appContext.dataStore.data
                .map { it.toSettings() }
                .collect { _state.value = it }
        }
    }

    fun current(): Settings = _state.value

    fun update(transform: (Settings) -> Settings) {
        scope.launch {
            appContext.dataStore.edit { prefs ->
                val next = transform(prefs.toSettings())
                prefs[K_AUTO]   = next.autoConnect
                prefs[K_WIFI]   = next.scanWifiOnly
                prefs[K_CHARGE] = next.scanChargingOnly
                prefs[K_SHARE]  = next.shareResults
                prefs[K_KILL]   = next.killSwitch
                prefs[K_LAN]    = next.lanBypass
                prefs[K_ACCENT] = next.accent.ordinal
                prefs[K_SLOT]   = next.selectedSlot
                prefs[K_MANUAL] = next.manualCleanIp
            }
        }
    }

    fun reset() = update { Settings() }

    private fun Preferences.toSettings() = Settings(
        autoConnect      = this[K_AUTO]   ?: false,
        scanWifiOnly     = this[K_WIFI]   ?: true,
        scanChargingOnly = this[K_CHARGE] ?: false,
        shareResults     = this[K_SHARE]  ?: true,
        killSwitch       = this[K_KILL]   ?: false,
        lanBypass        = this[K_LAN]    ?: true,
        accent           = AccentTheme.entries.getOrElse(this[K_ACCENT] ?: 0) { AccentTheme.AURORA },
        selectedSlot     = this[K_SLOT]   ?: 0,
        manualCleanIp    = this[K_MANUAL] ?: "",
    )
}
