package com.lightsout.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CompanionUrlNormalizerTest {

    @Test
    fun `adds scheme and default port for bare host`() {
        assertEquals(
            "http://192.168.1.50:58732/",
            CompanionUrlNormalizer.normalize("192.168.1.50")
        )
    }

    @Test
    fun `preserves explicit path and query`() {
        assertEquals(
            "http://192.168.1.50:58732/?t=abc123&host=192.168.1.50%3A58732",
            CompanionUrlNormalizer.normalize("http://192.168.1.50:58732/?t=abc123&host=192.168.1.50%3A58732")
        )
    }

    @Test
    fun `preserves https without forcing cleartext port`() {
        assertEquals(
            "https://lightsout.local/",
            CompanionUrlNormalizer.normalize("https://lightsout.local")
        )
    }

    @Test
    fun `rejects unsupported scheme`() {
        assertNull(CompanionUrlNormalizer.normalize("ftp://192.168.1.50"))
    }

    @Test
    fun `rejects blank input`() {
        assertNull(CompanionUrlNormalizer.normalize("   "))
    }
}
