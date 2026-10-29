package com.lightsout.companion

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/** No notification text/extras, remote forwarding, history or content logging. */
class LightNotificationService:NotificationListenerService(){
    private val seen=mutableMapOf<String,Long>()
    override fun onNotificationPosted(sbn:StatusBarNotification){
        if(sbn.packageName==packageName||sbn.notification.flags and (Notification.FLAG_ONGOING_EVENT or Notification.FLAG_GROUP_SUMMARY)!=0)return
        val now=android.os.SystemClock.elapsedRealtime();seen.entries.removeAll { now-it.value>60000 }
        val key=sbn.packageName+":"+sbn.id;if(seen.containsKey(key))return
        if(seen.size>=128)return;seen[key]=now
        PhoneLightExperience.notification(applicationContext,sbn.packageName)
    }
}
