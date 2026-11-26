package com.lightsout.companion

import java.net.URI
import java.net.URLEncoder

internal object CompanionUrlNormalizer {
    const val DEFAULT_PORT = 58732

    fun isPrivateIpv4(host: String): Boolean {
        val parts = host.split('.')
        if (parts.size != 4) return false
        val octets = parts.map { it.toIntOrNull() ?: return false }
        if (octets.any { it !in 0..255 }) return false
        val (a, b) = octets
        return a == 10 ||
            (a == 172 && b in 16..31) ||
            (a == 192 && b == 168) ||
            a == 127 ||
            (a == 169 && b == 254)
    }

    fun isLocalOrPrivateHost(rawHost: String): Boolean {
        val host = rawHost.trim().removePrefix("[").removeSuffix("]").lowercase()
        if (host.isEmpty()) return false
        if (host == "localhost" || host.endsWith(".local")) return true
        if (isPrivateIpv4(host)) return true
        if (host.contains(':')) {
            val bare = host.substringBefore('%')
            if (bare == "::1") return true
            val first = bare.substringBefore(':')
            val h0 = first.toIntOrNull(16) ?: return false
            if ((h0 and 0xfe00) == 0xfc00) return true // fc00::/7 ULA
            if ((h0 and 0xffc0) == 0xfe80) return true // fe80::/10 link-local
        }
        return false
    }

    fun normalize(raw: String?): String? {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isEmpty()) return null
        if (trimmed.contains("://") &&
            !trimmed.startsWith("http://", ignoreCase = true) &&
            !trimmed.startsWith("https://", ignoreCase = true)
        ) {
            return null
        }

        val withScheme = if (
            trimmed.startsWith("http://", ignoreCase = true) ||
            trimmed.startsWith("https://", ignoreCase = true)
        ) {
            trimmed
        } else {
            "http://$trimmed"
        }

        return try {
            val parsed = URI(withScheme)
            val scheme = (parsed.scheme ?: "http").lowercase()
            if (scheme != "http" && scheme != "https") return null
            if (!parsed.rawUserInfo.isNullOrEmpty()) return null

            val host = parsed.host?.trim().orEmpty()
            if (host.isEmpty()) return null
            // Cleartext HTTP is permitted only for local/private LAN addresses,
            // never for public internet hosts.
            if (scheme == "http" && !isLocalOrPrivateHost(host)) return null

            val port = when {
                parsed.port != -1 -> parsed.port
                scheme == "http" -> DEFAULT_PORT
                else -> -1
            }
            if (port != -1 && port !in 1..65535) return null
            val path = if (parsed.rawPath.isNullOrBlank()) "/" else parsed.rawPath
            val renderedHost = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
            val renderedPort = if (port != -1) ":$port" else ""
            val renderedQuery = parsed.rawQuery?.let { "?$it" }.orEmpty()
            val renderedFragment = parsed.rawFragment?.let { "#$it" }.orEmpty()

            "$scheme://$renderedHost$renderedPort$path$renderedQuery$renderedFragment"
        } catch (_: Exception) {
            null
        }
    }

    fun isSameOrigin(a: String?, b: String?): Boolean {
        if (a.isNullOrBlank() || b.isNullOrBlank()) return false
        return try {
            val ua = URI(a)
            val ub = URI(b)
            val sa = ua.scheme?.lowercase() ?: return false
            val sb = ub.scheme?.lowercase() ?: return false
            val ha = ua.host?.lowercase() ?: return false
            val hb = ub.host?.lowercase() ?: return false
            val pa = if (ua.port != -1) ua.port else if (sa == "https") 443 else 80
            val pb = if (ub.port != -1) ub.port else if (sb == "https") 443 else 80
            sa == sb && ha == hb && pa == pb
        } catch (_: Exception) {
            false
        }
    }

    fun stripQueryAndFragment(url: String?): String? {
        if (url.isNullOrBlank()) return null
        return try {
            val parsed = URI(url)
            val scheme = parsed.scheme?.lowercase() ?: return null
            val host = parsed.host?.trim().orEmpty()
            if (host.isEmpty()) return null
            val renderedHost = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
            val renderedPort = if (parsed.port != -1) ":${parsed.port}" else ""
            val path = if (parsed.rawPath.isNullOrBlank()) "/" else parsed.rawPath
            "$scheme://$renderedHost$renderedPort$path"
        } catch (_: Exception) {
            null
        }
    }

    // Extracts the pairing token from a normalized companion URL's `t` query
    // param. Used to capture the token at the moment the user actually
    // provides a URL (QR scan / manual paste / auto-discovery), independent
    // of what the address bar later becomes -- the companion page itself
    // calls history.replaceState() to strip `?t=` from the visible URL
    // almost immediately after load, so anything that reads the token back
    // out of a *later-observed* WebView URL (e.g. onPageFinished's callback
    // parameter) will find it already gone.
    fun extractToken(url: String?): String? {
        if (url.isNullOrBlank()) return null
        return try {
            URI(url).rawQuery
                ?.split("&")
                ?.firstOrNull { it.startsWith("t=") }
                ?.substringAfter("t=")
                ?.takeIf { it.isNotBlank() }
        } catch (_: Exception) {
            null
        }
    }

    // Safe diagnostic form: retain only origin/path and never query or fragment,
    // because the pairing token arrives as `?t=` before the page strips it.
    fun redactForLog(url: String?): String {
        if (url.isNullOrBlank()) return "(unknown)"
        return try {
            val parsed = URI(url)
            val scheme = parsed.scheme ?: return "(redacted URL)"
            val host = parsed.host ?: return "(redacted URL)"
            val renderedHost = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
            val renderedPort = if (parsed.port != -1) ":${parsed.port}" else ""
            val path = if (parsed.rawPath.isNullOrBlank()) "/" else parsed.rawPath
            "$scheme://$renderedHost$renderedPort$path [query redacted]"
        } catch (_: Exception) {
            "(redacted URL)"
        }
    }

    // Rebuilds a companion URL for a newly-discovered host, reusing a
    // previously-captured token (see extractToken). Always targets the
    // default port -- a rediscovered PC is identified by IP alone, not by a
    // full prior URL, so there's no "original port" to preserve.
    fun buildUrl(host: String, token: String): String {
        val renderedHost = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
        val encodedToken = URLEncoder.encode(token, "UTF-8")
        return "http://$renderedHost:$DEFAULT_PORT/?t=$encodedToken"
    }

    // Extracts just the host from a companion URL, or null if it can't be parsed.
    fun hostOf(url: String?): String? {
        if (url.isNullOrBlank()) return null
        return try {
            URI(url).host?.takeIf { it.isNotBlank() }
        } catch (_: Exception) {
            null
        }
    }

    // Decides whether a previously-stored pairing token should be dropped
    // because the URL now being loaded doesn't carry a token of its own and
    // targets a different host than the one the stored token was captured
    // for. This matters because a saved token is legitimately reused
    // token-less in two cases -- reconnecting to the *same* host after an app
    // restart (its token was stripped from the address bar by
    // history.replaceState, see extractToken) and a subnet-scan/UDP
    // rediscovery of the *same* pairing at a new IP (see MainActivity) --
    // both of which pass the matching host through explicitly. Anything else
    // token-less against a *different* host is a fresh pairing attempt (e.g.
    // the bare-host auto-detect flow) whose stored token belongs to some
    // other PC and must not be reused for that PC's scan-based reconnects.
    fun shouldInvalidateStaleToken(newHost: String?, tokenInUrl: String?, storedTokenHost: String?): Boolean =
        tokenInUrl == null && newHost != null && storedTokenHost != null && newHost != storedTokenHost

    // True when a recovery scan's captured generation no longer matches the
    // owner's current generation -- navigation, Activity pause, or a newer
    // recovery attempt invalidated it and its result must not be applied.
    fun isStaleScan(capturedGeneration: Int, currentGeneration: Int): Boolean =
        capturedGeneration != currentGeneration
}
