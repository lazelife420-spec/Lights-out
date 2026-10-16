package com.lightsout.companion

import org.junit.Assert.*
import org.junit.Test

class WizAddressTest {
    @Test fun acceptsLocalTargets() { listOf("10.0.2.2", "192.168.0.18", "172.16.1.1", "172.31.1.254", "169.254.1.2", "127.0.0.1").forEach { assertTrue(it, WizAddress.valid(it)) } }
    @Test fun rejectsPublicAndAmbiguousTargets() { listOf("8.8.8.8", "172.32.0.1", "0.0.0.0", "224.0.0.1", "localhost", "https://192.168.1.2", "192.168.1.255", "192.168.1.0", "192.168.01.2", "192.168.1.999", "::1", "10.0.0.2\n").forEach { assertFalse(it, WizAddress.valid(it)) } }
    @Test fun deduplicatesTargets() { assertEquals(listOf("10.0.0.2"), WizAddress.targets(listOf("10.0.0.2", "10.0.0.2"))) }
    @Test(expected = IllegalArgumentException::class) fun limitsTargets() { WizAddress.targets((1..9).map { "10.0.0.$it" }) }
    @Test(expected = IllegalArgumentException::class) fun rejectsMixedList() { WizAddress.targets(listOf("192.168.0.18", "8.8.8.8")) }
}
