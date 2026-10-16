package com.lightsout.companion

object WizAddress {
    fun valid(ip: String): Boolean {
        val parts = ip.split('.')
        if (parts.size != 4 || parts.any { !it.matches(Regex("0|[1-9][0-9]{0,2}")) }) return false
        val n = parts.map { it.toInt() }
        if (n.any { it > 255 } || n[3] !in 1..254) return false
        return n[0] == 10 || n[0] == 127 || (n[0] == 192 && n[1] == 168) ||
            (n[0] == 172 && n[1] in 16..31) || (n[0] == 169 && n[1] == 254)
    }
    fun targets(values: List<String>): List<String> {
        require(values.size <= 8 && values.all { valid(it) }) { "Use up to 8 local WiZ IPv4 addresses." }
        return values.distinct().sorted()
    }
}
