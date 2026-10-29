package com.lightsout.companion

import org.junit.Assert.*
import org.junit.Test

class LightExperienceTest {
    @Test fun offAndUnknownModesCannotProduceFrames(){assertNull(LightExperienceModel.frame("off",.5,5.0,0,4,35));assertNull(LightExperienceModel.frame("future",.5,5.0,0,4,35))}
    @Test fun everyFrameStaysInsideLocalWizBounds(){for(mode in listOf("hourglass","orbit","ember"))for(p in 0..100)for(i in 0..7){val f=LightExperienceModel.frame(mode,p/100.0,p*6.0,i,8,100)!!;assertTrue(f.dimming in 10..60);assertTrue(listOf(f.r,f.g,f.b).all { it in 0..255 })}}
    @Test fun hourglassUsesOrderedLightProgress(){val f=(0..3).map { LightExperienceModel.frame("hourglass",.5,30.0,it,4,50)!!.dimming };assertEquals(listOf(10,10,50,50),f)}
    @Test fun orbitHasStablePeriodAndEmberEndsAtMinimum(){assertEquals(LightExperienceModel.frame("orbit",.3,24.0,0,4,35),LightExperienceModel.frame("orbit",.3,48.0,0,4,35));assertEquals(10,LightExperienceModel.frame("ember",1.0,0.0,0,4,35)!!.dimming)}
    @Test fun beaconIsFiniteAndBrightnessBounded(){assertNull(LightExperienceModel.beacon(6.0,35,0,1));for(i in 0..59){val f=LightExperienceModel.beacon(i/10.0,100,0,1)!!;assertTrue(f.dimming in 10..60)};assertTrue(LightExperienceModel.beacon(4.5,50,0,1)!!.dimming>40)}
    @Test fun appAlertsRequireBothConsentAndOsAccess(){assertFalse(LightAlertPolicy.allowed(false,true,"self","selected",listOf("selected")));assertFalse(LightAlertPolicy.allowed(true,false,"self","selected",listOf("selected")));assertTrue(LightAlertPolicy.allowed(true,true,"self","selected",listOf("selected")))}
    @Test fun unselectedAndOwnNotificationsNeverFlash(){assertFalse(LightAlertPolicy.allowed(true,true,"self","other",listOf("selected")));assertFalse(LightAlertPolicy.allowed(true,true,"self","self",listOf("self")));assertFalse(LightAlertPolicy.allowed(true,true,"self","selected",emptyList()))}
}
