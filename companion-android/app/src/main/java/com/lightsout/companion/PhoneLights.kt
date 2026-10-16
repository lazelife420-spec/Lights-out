package com.lightsout.companion

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import org.json.JSONObject
import java.net.*
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** Direct WiZ LAN API. No PC, cloud account, pairing token, or WebView networking. */
object PhoneLights {
    private const val PORT = 38899
    private val active = AtomicInteger()
    private val targetLocks = ConcurrentHashMap<String, ReentrantLock>()
    private val main = Handler(Looper.getMainLooper())
    fun request(ip: String, params: JSONObject? = null): JSONObject {
        require(WizAddress.valid(ip)) { "Use a local WiZ IPv4 address." }
        val method = if (params == null) "getPilot" else "setPilot"
        val body = JSONObject().put("method", method).put("params", params ?: JSONObject()).toString().toByteArray(Charsets.UTF_8)
        DatagramSocket().use { socket ->
            val address = InetAddress.getByName(ip)
            socket.send(DatagramPacket(body, body.size, address, PORT))
            val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(1200)
            while (System.nanoTime() < deadline) {
                socket.soTimeout = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime()).toInt().coerceAtLeast(1)
                val packet = DatagramPacket(ByteArray(8193), 8193)
                socket.receive(packet)
                if (packet.address != address || packet.port != PORT || packet.length > 8192) continue
                val result = try { JSONObject(String(packet.data, 0, packet.length, Charsets.UTF_8)) } catch (_: Exception) { continue }
                if (result.optString("method") != method) continue
                if (result.has("error")) throw IllegalStateException("The light rejected the command.")
                val pilot = result.optJSONObject("result") ?: continue
                if (params != null) {
                    check(pilot.opt("success") == true) { "The light did not acknowledge the change." }
                } else check(pilot.opt("state") is Boolean) { "The light returned an invalid status." }
                return pilot
            }
        }
        throw SocketTimeoutException("The light did not respond.")
    }
    fun perform(c: Context, targets: List<String>, action: String, brightness: Int = 30,
                runId: String? = null, done: (() -> Unit)? = null) {
        WizAddress.targets(targets)
        require(action in setOf("status", "on", "off", "warm"))
        require(brightness in 10..100)
        if (targets.isEmpty()) { done?.invoke(); return }
        if (runId == null && active.get() >= 2) throw IllegalArgumentException("Wait for the current light check.")
        active.incrementAndGet()
        val app = c.applicationContext
        val wake = app.getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LightsOut:WiZ")
        wake.acquire(8000)
        Thread({
            val pool = Executors.newFixedThreadPool(targets.size)
            var summary = "WiZ check failed."
            try {
                val futures = targets.map { ip -> pool.submit<String> { targetLocks.getOrPut(ip) { ReentrantLock(true) }.withLock {
                    // Completion must not switch off a newer timer's lights.
                    if (runId != null) {
                        val current = PhoneTimerStore.read(app)
                        val expectedPhase = if (action == "off") current.phase == "finished" else current.phase in setOf("running", "paused")
                        if (current.runId != runId || !expectedPhase) return@withLock "$ip: superseded"
                    }
                    try {
                        val params = when (action) {
                            "off" -> JSONObject().put("state", false)
                            "on" -> JSONObject().put("state", true)
                            "warm" -> JSONObject().put("state", true).put("dimming", brightness).put("temp", 2700)
                            else -> null
                        }
                        val result = request(ip, params)
                        if (action == "status") "$ip: ${if (result.getBoolean("state")) "on" else "off"}"
                        else "$ip: acknowledged"
                    } catch (_: Exception) { "$ip: no acknowledgement — check Wi-Fi and WiZ Local communication" }
                } } }
                summary = futures.joinToString("\n") { it.get(3, TimeUnit.SECONDS) }
            } catch (_: Exception) { summary = "WiZ check timed out. Check the phone's Wi-Fi and WiZ Local communication." }
            finally {
                pool.shutdownNow()
                val resultText = summary
                main.post {
                    if (runId == null || PhoneTimerStore.read(app).runId == runId) PhoneHomeStore.event(app, resultText)
                    done?.invoke()
                }
                if (wake.isHeld) wake.release()
                active.decrementAndGet()
            }
        }, "LightsOut-WiZ").start()
    }
    fun discover(c: Context) {
        if (active.get() >= 2) throw IllegalArgumentException("Wait for the current light check.")
        active.incrementAndGet()
        val app = c.applicationContext
        Thread({
            val found = mutableSetOf<String>()
            try {
                DatagramSocket().use { socket ->
                    socket.broadcast = true
                    val body = "{\"method\":\"getPilot\",\"params\":{}}".toByteArray()
                    val broadcasts = NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }
                        .flatMap { it.interfaceAddresses }.mapNotNull { it.broadcast }.toSet() + InetAddress.getByName("255.255.255.255")
                    broadcasts.forEach { address -> try { socket.send(DatagramPacket(body, body.size, address, PORT)) } catch (_: Exception) {} }
                    val until = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
                    while (System.nanoTime() < until) {
                        socket.soTimeout = TimeUnit.NANOSECONDS.toMillis(until - System.nanoTime()).toInt().coerceAtLeast(1)
                        val packet = DatagramPacket(ByteArray(8193), 8193)
                        try { socket.receive(packet) } catch (_: SocketTimeoutException) { break }
                        val ip = packet.address.hostAddress ?: continue
                        if (packet.port != PORT || packet.length > 8192 || !WizAddress.valid(ip)) continue
                        val j = try { JSONObject(String(packet.data, 0, packet.length, Charsets.UTF_8)) } catch (_: Exception) { continue }
                        val pilot = j.optJSONObject("result") ?: continue
                        if (j.optString("method") == "getPilot" && pilot.opt("state") is Boolean &&
                            pilot.optString("mac").matches(Regex("[0-9a-fA-F]{12}"))) found.add(ip)
                    }
                }
            } catch (_: Exception) { /* Manual IP entry remains available. */ }
            finally {
                main.post {
                    val targets = (PhoneHomeStore.lights(app) + found.sorted()).distinct().take(8)
                    val config = PhoneHomeStore.config(app).put("lights", org.json.JSONArray(targets))
                    PhoneHomeStore.save(app, config)
                    PhoneHomeStore.event(app, if (found.isEmpty()) "No WiZ lights found. Use the same Wi-Fi, enable WiZ Local communication, or enter an IP address." else "Found ${found.size} WiZ light(s). Saved on this phone.")
                }
                active.decrementAndGet()
            }
        }, "LightsOut-WiZ-discovery").start()
    }
}
