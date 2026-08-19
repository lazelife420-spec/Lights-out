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

    @Test
    fun `redactForLog never returns pairing credentials`() {
        assertEquals(
            "http://192.168.0.16:58732/ [query redacted]",
            CompanionUrlNormalizer.redactForLog("http://192.168.0.16:58732/?t=abc123&host=192.168.0.16%3A58732")
        )
        assertEquals("(redacted URL)", CompanionUrlNormalizer.redactForLog("not a url?t=abc123"))
    }

    @Test
    fun `hostOf reads the host out of a companion URL`() {
        assertEquals("192.168.1.50", CompanionUrlNormalizer.hostOf("http://192.168.1.50:58732/?t=abc123"))
    }

    @Test
    fun `hostOf returns null for blank or malformed input`() {
        assertNull(CompanionUrlNormalizer.hostOf(null))
        assertNull(CompanionUrlNormalizer.hostOf(""))
        assertNull(CompanionUrlNormalizer.hostOf("not a url"))
    }

    @Test
    fun `shouldInvalidateStaleToken is false when the URL carries its own token`() {
        // A fresh pairing always wins regardless of what host it targets.
        assertEquals(
            false,
            CompanionUrlNormalizer.shouldInvalidateStaleToken("192.168.1.99", "newtoken", "192.168.1.50")
        )
    }

    @Test
    fun `shouldInvalidateStaleToken is false for a token-less reconnect to the same host`() {
        // Restart-time reconnect and subnet-scan/UDP rediscovery of the *same*
        // pairing both pass the matching host through explicitly.
        assertEquals(
            false,
            CompanionUrlNormalizer.shouldInvalidateStaleToken("192.168.1.50", null, "192.168.1.50")
        )
    }

    @Test
    fun `shouldInvalidateStaleToken is true for a token-less connect to a different host`() {
        // e.g. the bare-host auto-detect flow pairing to a second PC -- the
        // stored token belongs to a different pairing and must not carry over.
        assertEquals(
            true,
            CompanionUrlNormalizer.shouldInvalidateStaleToken("192.168.1.99", null, "192.168.1.50")
        )
    }

    @Test
    fun `shouldInvalidateStaleToken is false when there is no stored token to invalidate`() {
        assertEquals(
            false,
            CompanionUrlNormalizer.shouldInvalidateStaleToken("192.168.1.99", null, null)
        )
    }
}
