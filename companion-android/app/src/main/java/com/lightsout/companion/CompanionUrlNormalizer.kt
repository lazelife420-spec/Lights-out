package com.lightsout.companion

import java.net.URI

internal object CompanionUrlNormalizer {
    const val DEFAULT_PORT = 58732

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

            val host = parsed.host?.trim().orEmpty()
            if (host.isEmpty()) return null

            val port = when {
                parsed.port != -1 -> parsed.port
                scheme == "http" -> DEFAULT_PORT
                else -> -1
            }
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
    fun buildUrl(host: String, token: String): String =
        "http://$host:$DEFAULT_PORT/?t=$token"

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
