package com.lightsout.companion

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/** No notification text/extras, remote forwarding, history or content logging. */
class LightNotificationService:NotificationListenerService(){
    private val seen=mutableMapOf<String,Long>()
    override fun onNotificationPosted(sbn:StatusBarNotification){
        if(sbn.packageName==packageName||sbn.notification.flags and (Notification.FLAG_ONGOING_EVENT or Notification.FLAG_GROUP_SUMMARY)!=0)return
        // Filter by user-selected apps BEFORE populating the dedupe table so unselected
        // high-volume notifications can never exhaust the 128-entry cap.
        if(!PhoneLightExperience.isAlertAllowed(applicationContext,sbn.packageName))return
        val now=android.os.SystemClock.elapsedRealtime()
        val key="${sbn.packageName}:${sbn.tag.orEmpty()}:${sbn.id}"
        synchronized(seen) {
            seen.entries.removeAll { now-it.value>60000 }
            if(seen.containsKey(key)||seen.size>=128)return
            seen[key]=now
        }
        PhoneLightExperience.notification(applicationContext,sbn.packageName)
    }
}
