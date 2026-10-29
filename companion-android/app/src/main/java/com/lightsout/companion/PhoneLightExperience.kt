package com.lightsout.companion

import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs

/** Opt-in phone-owned WiZ effects. No notification contents are read or stored. */
object PhoneLightExperience {
    private val worker=Executors.newSingleThreadExecutor()
    private val busy=AtomicBoolean(false)
    private var lastTick=0L;private var lastBeacon= -30000L
    private var run=""
    private data class Light(val ip:String,val original:JSONObject,val epoch:Int,var last:JSONObject?=null,var released:Boolean=false)
    private val timerLights=mutableListOf<Light>()
    private fun prefs(c:Context)=c.getSharedPreferences("light_experience",Context.MODE_PRIVATE)
    private fun settings(c:Context)=try{JSONObject(prefs(c).getString("settings","{}")?:"{}")}catch(_:Exception){JSONObject()}
    private fun targets(j:JSONObject,key:String)=PhoneHomeStore.strings(j.optJSONArray(key))
    fun access(c:Context)=NotificationManagerCompat.getEnabledListenerPackages(c).contains(c.packageName)
    fun publicConfig(c:Context):JSONObject {
        val j=settings(c);val lights=PhoneHomeStore.lights(c)
        val intent=Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION") val apps=c.packageManager.queryIntentActivities(intent,0).map { it.activityInfo.applicationInfo }.distinctBy { it.packageName }.filter { it.packageName!=c.packageName }.sortedBy { c.packageManager.getApplicationLabel(it).toString().lowercase() }.take(200)
        return JSONObject().put("settings",j).put("lights",JSONArray(lights)).put("notificationAccess",access(c))
            .put("apps",JSONArray(apps.map { JSONObject().put("id",it.packageName).put("name",c.packageManager.getApplicationLabel(it).toString()) }))
    }
    fun save(c:Context,value:JSONObject):JSONObject {
        val mode=value.optString("timerMode","off");require(mode in setOf("off","hourglass","orbit","ember"))
        val brightness=value.optInt("brightness",35);require(brightness in 10..60)
        val timer=WizAddress.targets(targets(value,"timerTargets"));val alerts=WizAddress.targets(targets(value,"alertTargets"));val saved=PhoneHomeStore.lights(c)
        require((timer+alerts).all { it in saved }) { "Choose saved phone lights." }
        require(mode=="off"||timer.isNotEmpty()) { "Choose lights for timer mode." }
        val timerAlerts=value.optBoolean("timerAlerts");val appAlerts=value.optBoolean("appAlerts")
        require(!(timerAlerts||appAlerts)||alerts.isNotEmpty()) { "Choose lights for alert beacons." }
        val apps=targets(value,"apps");require(apps.size<=32&&apps.distinct().size==apps.size&&apps.all { it.matches(Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+"))&&it!=c.packageName }) { "Choose up to 32 phone apps." }
        require(!appAlerts||apps.isNotEmpty()) { "Choose the apps allowed to flash your lights." }
        val j=JSONObject().put("version",1).put("timerMode",mode).put("brightness",brightness).put("timerTargets",JSONArray(timer)).put("alertTargets",JSONArray(alerts)).put("timerAlerts",timerAlerts).put("appAlerts",appAlerts).put("apps",JSONArray(apps))
        check(prefs(c).edit().putString("settings",j.toString()).commit()) { "Could not save light modes." }
        return publicConfig(c)
    }
    private fun params(frame:LightExperienceModel.Frame)=JSONObject().put("r",frame.r).put("g",frame.g).put("b",frame.b).put("dimming",frame.dimming)
    private fun matches(live:JSONObject,last:JSONObject)=last.keys().asSequence().all { live.has(it)&&abs(live.optInt(it,-1000)-last.getInt(it))<=6 }
    private fun usable(c:Context,ip:String)=ip in PhoneHomeStore.lights(c)
    private fun capture(c:Context,ips:List<String>):List<Light> = ips.filter { usable(c,it) }.map { ip ->
        try{PhoneLights.withTargetLock(ip){val pilot=PhoneLights.request(ip);Light(ip,pilot,PhoneLights.manualEpoch(ip),released=pilot.opt("state")!=true)}}catch(_:Exception){Light(ip,JSONObject(),PhoneLights.manualEpoch(ip),released=true)}
    }
    private fun apply(c:Context,light:Light,value:JSONObject):Boolean=PhoneLights.withTargetLock(light.ip){
        if(light.released||!usable(c,light.ip)||PhoneLights.manualEpoch(light.ip)!=light.epoch){light.released=true;return@withTargetLock false}
        try{val live=PhoneLights.request(light.ip)
            if(live.opt("state")!=true||light.last?.let { !matches(live,it) }==true){light.released=true;return@withTargetLock false}
            PhoneLights.request(light.ip,value);light.last=JSONObject(value.toString());true
        }catch(_:Exception){light.released=true;false}
    }
    private fun restore(c:Context,lights:List<Light>){for(light in lights)if(!light.released&&light.last!=null){
        val pilot=light.original;val value=JSONObject().put("dimming",pilot.optInt("dimming",10).coerceIn(10,100))
        if(pilot.optInt("sceneId",0)>0)value.put("sceneId",pilot.getInt("sceneId"))
        else if(pilot.optInt("temp",0)>0)value.put("temp",pilot.getInt("temp"))
        else for(key in listOf("r","g","b","c","w"))if(pilot.has(key))value.put(key,pilot.getInt(key))
        apply(c,light,value)
    }}
    private fun awake(c:Context,work:()->Unit){val lock=c.getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"LightsOut:LightMode");try{lock.acquire(25000);work()}finally{if(lock.isHeld)lock.release()}}
    fun tick(c:Context){
        val now=SystemClock.elapsedRealtime();if(now-lastTick<3000||!busy.compareAndSet(false,true))return;lastTick=now
        val app=c.applicationContext
        worker.execute {try{val t=PhoneTimerStore.read(app);val j=settings(app);val ips=targets(j,"timerTargets").filter { usable(app,it) };val mode=j.optString("timerMode","off")
            val key=t.runId+":"+mode+":"+ips.joinToString(",")
            if(key!=run||t.phase !in setOf("running","paused")||mode=="off"){if(timerLights.isNotEmpty())awake(app){restore(app,timerLights)};timerLights.clear();run=key}
            if(t.phase!="running"||mode=="off"||ips.isEmpty())return@execute
            awake(app){if(timerLights.isEmpty())timerLights.addAll(capture(app,ips));val left=t.remaining(SystemClock.elapsedRealtime(),System.currentTimeMillis(),PhoneTimerStore.boot(app));val p=if(t.totalMs>0)1-left.toDouble()/t.totalMs else 1.0
                for((index,light) in timerLights.withIndex()){val current=PhoneTimerStore.read(app);if(current.runId!=t.runId||current.phase!="running"||settings(app).optString("timerMode","off")!=mode)break
                    val frame=LightExperienceModel.frame(mode,p,(t.totalMs-left)/1000.0,index,timerLights.size,j.optInt("brightness",35))?:continue;apply(app,light,params(frame))
                }
            }
        }catch(_:Exception){/* Failed/unreachable lights never gain power authority. */}finally{busy.set(false)}}
    }
    fun finished(c:Context,allowBeacon:Boolean){val app=c.applicationContext;worker.execute {try{val alert=allowBeacon&&settings(app).optBoolean("timerAlerts");if(timerLights.isEmpty()&&!alert)return@execute;awake(app){restore(app,timerLights);timerLights.clear();run="";if(alert)beacon(app,"timer")}}catch(_:Exception){}}}
    fun stopTimer(c:Context){finished(c,false)}
    fun notification(c:Context,packageId:String){val j=settings(c);if(!LightAlertPolicy.allowed(j.optBoolean("appAlerts"),access(c),c.packageName,packageId,targets(j,"apps")))return
        val now=SystemClock.elapsedRealtime();if(now-lastBeacon<30000||!busy.compareAndSet(false,true))return;lastBeacon=now
        val app=c.applicationContext;worker.execute {try{awake(app){beacon(app,"app")}}catch(_:Exception){}finally{busy.set(false)}}
    }
    private fun beacon(c:Context,kind:String){
        val j=settings(c);val enabled=if(kind=="app")"appAlerts" else "timerAlerts";if(!j.optBoolean(enabled))return
        val lights=capture(c,targets(j,"alertTargets"));val start=SystemClock.elapsedRealtime();var changed=0
        try{for(step in 0..5){if(!settings(c).optBoolean(enabled)||SystemClock.elapsedRealtime()-start>9000)break
            for((index,light)in lights.withIndex()){val frame=LightExperienceModel.beacon(step.toDouble(),j.optInt("brightness",35),index,lights.size)?:continue;if(apply(c,light,params(frame)))changed++}
            Thread.sleep(1000)
        }}finally{restore(c,lights)}
        PhoneHomeStore.event(c,if(changed>0)"Light beacon acknowledged. Prior light settings restored where still under Lights Out control." else "Light beacon skipped: selected lights are off, unavailable or under manual control.")
    }
}
