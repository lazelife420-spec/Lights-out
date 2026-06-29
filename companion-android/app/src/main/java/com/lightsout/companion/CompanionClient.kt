package com.lightsout.companion

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Native WebSocket client for the desktop companion control plane. Connects to
 * ws://PC-IP:58732/?t=TOKEN (derived from the saved http link), parses timer
 * state frames, sends commands, and transparently reconnects with backoff.
 *
 * Runs independently of the WebView's own connection; both are valid clients of
 * the same companion server (which caps connections, so two is fine).
 */
class CompanionClient(
    private val httpUrl: String,
    private val listener: Listener
) {
    interface Listener {
        fun onConnected() {}
        fun onDisconnected() {}
        fun onState(state: TimerState) {}
    }

    private val http = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)   // keep the LAN socket alive
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS) // never time out a live socket
        .build()

    private val main = Handler(Looper.getMainLooper())
    @Volatile private var ws: WebSocket? = null
    @Volatile private var stopped = false
    @Volatile private var connected = false
    private var backoffMs = INITIAL_BACKOFF_MS

    fun start() {
        stopped = false
        open()
    }

    fun stop() {
        stopped = true
        main.removeCallbacksAndMessages(null)
        try { ws?.close(1000, "client stopping") } catch (_: Exception) {}
        ws = null
        connected = false
    }

    val isConnected: Boolean get() = connected

    // ── Commands ────────────────────────────────────────────────────────────
    fun start(durationSeconds: Int, timerAction: String) = send(
        JSONObject()
            .put("action", "start")
            .put("durationSeconds", durationSeconds)
            .put("timerAction", timerAction)
    )

    fun togglePause() = send(JSONObject().put("action", "togglePause"))
    fun snooze(seconds: Int) = send(JSONObject().put("action", "snooze").put("seconds", seconds))
    fun cancel() = send(JSONObject().put("action", "cancel"))

    private fun send(obj: JSONObject): Boolean =
        ws?.send(obj.toString()) ?: false

    // ── Connection lifecycle ──────────────────────────────────────────────────
    private fun open() {
        if (stopped) return
        val wsUrl = toWsUrl(httpUrl) ?: run {
            Log.w(TAG, "Cannot derive ws URL from $httpUrl")
            return
        }
        val request = Request.Builder().url(wsUrl).build()
        ws = http.newWebSocket(request, socketListener)
    }

    private fun scheduleReconnect() {
        if (stopped) return
        connected = false
        main.postDelayed({ open() }, backoffMs)
        backoffMs = (backoffMs * 2).coerceAtMost(MAX_BACKOFF_MS)
    }

    private val socketListener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            backoffMs = INITIAL_BACKOFF_MS
            connected = true
            main.post { listener.onConnected() }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val state = try {
                TimerState.fromJson(JSONObject(text))
            } catch (e: Exception) {
                null
            }
            if (state != null) main.post { listener.onState(state) }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            try { webSocket.close(1000, null) } catch (_: Exception) {}
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (connected) main.post { listener.onDisconnected() }
            scheduleReconnect()
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (connected) main.post { listener.onDisconnected() }
            scheduleReconnect()
        }
    }

    companion object {
        private const val TAG = "CompanionClient"
        private const val INITIAL_BACKOFF_MS = 1_000L
        private const val MAX_BACKOFF_MS = 30_000L

        /** http://host:port/?t=TOK -> ws://host:port/?t=TOK (https -> wss). */
        fun toWsUrl(httpUrl: String?): String? {
            if (httpUrl.isNullOrBlank()) return null
            return try {
                val uri = Uri.parse(httpUrl.trim())
                val scheme = when (uri.scheme?.lowercase()) {
                    "https" -> "wss"
                    "http" -> "ws"
                    "ws", "wss" -> uri.scheme
                    else -> return null
                }
                val authority = uri.encodedAuthority ?: return null
                val path = uri.encodedPath?.ifEmpty { "/" } ?: "/"
                val query = uri.encodedQuery?.let { "?$it" } ?: ""
                "$scheme://$authority$path$query"
            } catch (e: Exception) {
                null
            }
        }
    }
}
