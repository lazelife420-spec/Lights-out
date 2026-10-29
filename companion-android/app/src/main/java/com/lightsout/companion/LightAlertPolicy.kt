package com.lightsout.companion

object LightAlertPolicy {
    fun allowed(enabled:Boolean,access:Boolean,own:String,source:String,selected:List<String>)=
        enabled&&access&&source!=own&&source in selected
}
