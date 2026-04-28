package org.khatetire.cfipscanner

import android.app.Application
import org.khatetire.cfipscanner.history.SessionRecorder
import org.khatetire.cfipscanner.settings.AppSettings
import org.khatetire.cfipscanner.work.IpPoolRefreshScheduler
import org.khatetire.cfipscanner.work.ScanScheduler

class KhateApp : Application() {
    override fun onCreate() {
        super.onCreate()
        AppSettings.init(this)
        SessionRecorder.start(this)
        ScanScheduler.apply(this)
        IpPoolRefreshScheduler.apply(this)
    }
}
