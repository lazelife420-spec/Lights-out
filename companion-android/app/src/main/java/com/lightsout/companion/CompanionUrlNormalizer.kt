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
}
