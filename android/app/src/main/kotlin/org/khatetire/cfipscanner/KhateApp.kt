package org.khatetire.cfipscanner

import android.app.Application
import org.khatetire.cfipscanner.settings.AppSettings

class KhateApp : Application() {
    override fun onCreate() {
        super.onCreate()
        AppSettings.init(this)
    }
}
