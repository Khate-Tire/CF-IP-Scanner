package org.khatetire.cfipscanner.util

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.UUID

/**
 * Per-install random UUID stored in EncryptedSharedPreferences. Used as an
 * opaque rate-limit / leaderboard key by the community Worker. Never tied to
 * any account, IMEI, ad ID, or device identifier.
 */
object AnonymousId {
    private const val PREFS = "khate_anon"
    private const val KEY_UUID = "uuid"

    fun get(context: Context): String {
        val prefs = prefs(context)
        prefs.getString(KEY_UUID, null)?.let { return it }
        val fresh = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_UUID, fresh).apply()
        return fresh
    }

    private fun prefs(context: Context) = EncryptedSharedPreferences.create(
        context,
        PREFS,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
}
