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

    @Test
    fun `extractToken reads the t query param`() {
        assertEquals(
            "abc123",
            CompanionUrlNormalizer.extractToken("http://192.168.1.50:58732/?t=abc123&host=192.168.1.50%3A58732")
        )
    }

    @Test
    fun `extractToken returns null once the token has been stripped from the address`() {
        // Reproduces the real bug: onPageFinished's callback reports the
        // WebView's URL *after* companion.html's history.replaceState() has
        // already stripped the query string, so a value like this is what
        // gets passed around post-load -- and must not be mistaken for "no
        // token was ever provided."
        assertNull(CompanionUrlNormalizer.extractToken("http://192.168.1.50:58732/"))
    }

    @Test
    fun `extractToken returns null for blank or malformed input`() {
        assertNull(CompanionUrlNormalizer.extractToken(null))
        assertNull(CompanionUrlNormalizer.extractToken(""))
        assertNull(CompanionUrlNormalizer.extractToken("not a url"))
    }

    @Test
    fun `buildUrl always targets the default port with the given token`() {
        assertEquals(
            "http://192.168.0.16:58732/?t=abc123",
            CompanionUrlNormalizer.buildUrl("192.168.0.16", "abc123")
        )
    }
}
