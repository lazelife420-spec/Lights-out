package com.lightsout.companion

/** Portable intent validation; local authority is deliberately absent. */
object PortableRoutineChecks {
    const val MAX_BYTES = 262144
    fun id(value: String) = value.matches(Regex("[a-zA-Z0-9_-]{1,80}"))
    fun name(value: String) = value.isNotBlank() && value == value.trim() && value.length <= 60 && value.none { it.code < 32 || it.code == 127 }
    fun slots(addresses: List<String>, configured: Map<String,String>): Map<String,String> {
        val result = mutableMapOf<String,String>();val used = mutableSetOf<String>()
        for((slot,ip) in configured) if(ip in addresses && ip !in result && slot.matches(Regex("[a-zA-Z0-9_-]{1,32}"))) { result[ip]=slot;used.add(slot) }
        for(ip in addresses.sorted()) if(ip !in result) { var n=1;while("light-$n" in used)n++;result[ip]="light-$n";used.add("light-$n") }
        return result
    }
    fun action(id: String, type: String, phase: String, seconds: Long, ending: String, bindings: List<String>, brightness: Int) {
        require(id.matches(Regex("[a-zA-Z0-9_-]{1,64}"))) { "Invalid action identity." }
        when(type) {
            "timer.start" -> require(phase == "start" && seconds in 60..86400 && ending in setOf("reminder", "shutdown", "sleep", "hibernate")) { "Invalid portable timer." }
            "wiz.warm", "wiz.off" -> {
                require(phase == if(type == "wiz.off") "timer-complete" else "start") { "Unsupported action timing." }
                require(bindings.size in 1..8 && bindings.distinct().size == bindings.size && bindings.all { it.matches(Regex("[a-zA-Z0-9_-]{1,32}")) }) { "Use abstract light bindings, not addresses." }
                require(type != "wiz.warm" || brightness in 10..100) { "Invalid brightness." }
            }
            else -> throw IllegalArgumentException("This action has no supported interchange adapter.")
        }
    }
}
