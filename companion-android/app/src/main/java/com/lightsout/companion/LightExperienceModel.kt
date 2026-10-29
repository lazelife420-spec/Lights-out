package com.lightsout.companion

import kotlin.math.*

/** Pure frame intent. No power, address, notification or timer authority. */
object LightExperienceModel {
    data class Frame(val r:Int,val g:Int,val b:Int,val dimming:Int)
    private fun clip(v:Double,min:Double,max:Double)=if(v.isFinite())v.coerceIn(min,max) else min
    private fun mix(a:List<Int>,b:List<Int>,t:Double)=a.indices.map { (a[it]+(b[it]-a[it])*t).roundToInt() }
    fun frame(mode:String,progress:Double,elapsedSeconds:Double,index:Int,count:Int,brightness:Int):Frame? {
        if(mode !in setOf("hourglass","orbit","ember"))return null
        val p=clip(progress,0.0,1.0);val seconds=clip(elapsedSeconds,0.0,86400.0);val n=count.coerceIn(1,32);val i=index.coerceIn(0,n-1);val peak=brightness.coerceIn(10,60)
        val rgb:List<Int>;val level:Double
        when(mode){
            "hourglass"->{val local=clip(p*n-i,0.0,1.0);rgb=mix(listOf(255,176,76),listOf(255,72,18),local);level=10+(peak-10)*(1-local)}
            "orbit"->{val wave=(1+cos(2*PI*(seconds/24-i.toDouble()/n)))/2;rgb=mix(mix(listOf(62,145,255),listOf(175,88,235),wave),listOf(255,123,38),p*p);level=10+(peak-10)*(1-p)*(.5+.5*wave)}
            else->{val breath=(1+sin(2*PI*seconds/12))/2;rgb=mix(listOf(255,126,34),listOf(255,54,12),p);level=10+(peak-10)*(1-p)*(.88+.12*breath)}
        }
        return Frame(rgb[0],rgb[1],rgb[2],clip(level,10.0,60.0).roundToInt())
    }
    fun beacon(seconds:Double,brightness:Int,index:Int,count:Int):Frame? {
        val t=clip(seconds,0.0,6.0);if(t>=6)return null
        val delay=index.coerceIn(0,31).toDouble()/count.coerceIn(1,32)*.6
        val wave=sin(PI*max(0.0,t-delay)/3)
        return Frame(128,192,255,(10+(brightness.coerceIn(10,60)-10)*wave*wave).roundToInt())
    }
}
