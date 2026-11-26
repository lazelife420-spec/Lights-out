package com.lightsout.companion

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.util.Log
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Unicast subnet scan used to discover a Lights Out companion on the phone's
 * current private Wi-Fi /24. Results are advisory only: callers must obtain
 * user confirmation before connecting and must never auto-transmit stored
 * pairing tokens to newly discovered hosts.
 */
internal object SubnetScanner {
    private const val TAG = "LightsOutScan"
    private const val PROBE_TIMEOUT_MS = 400
    private const val MAX_CONCURRENT = 32
    private const val SCAN_TIMEOUT_SECONDS = 15L
    private const val MAX_PROBE_CHARS = 4096
    // The companion page's <title> -- see electron/companion.html. Confirms
    // whatever answered on this port is actually a Lights Out companion
    // server, not some unrelated device/service that happens to share the
    // port number.
    private const val MARKER = "Lights Out"

    private data class WifiSubnet(val network: Network, val base: String)

    // Returns the phone's active private Wi-Fi network and IPv4 /24 base
    // ("192.168.0.") or null if Wi-Fi is unavailable or non-private.
    // Never falls back to cellular or VPN activeNetwork interfaces.
    @Suppress("DEPRECATION") // allNetworks: simplest synchronous way to enumerate candidates; no callback needed here
    private fun ownWifiSubnet(context: Context): WifiSubnet? {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return null
            val network = cm.allNetworks
                .firstOrNull { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true }
                ?: return null
            val props: LinkProperties = cm.getLinkProperties(network) ?: return null
            val ipv4 = props.linkAddresses
                .mapNotNull { it.address?.hostAddress }
                .firstOrNull { addr -> !addr.contains(':') && CompanionUrlNormalizer.isPrivateIpv4(addr) && !addr.startsWith("127.") }
                ?: return null
            val parts = ipv4.split(".")
            if (parts.size != 4) return null
            WifiSubnet(network, "${parts[0]}.${parts[1]}.${parts[2]}.")
        } catch (_: Exception) {
            null
        }
    }

    // Probes a single host over the bound Wi-Fi network via a raw HTTP GET,
    // looping reads up to MAX_PROBE_CHARS so TCP header/body splits still match.
    private fun probe(network: Network, host: String): Boolean {
        return try {
            network.socketFactory.createSocket().use { socket ->
                socket.connect(InetSocketAddress(host, CompanionUrlNormalizer.DEFAULT_PORT), PROBE_TIMEOUT_MS)
                socket.soTimeout = PROBE_TIMEOUT_MS
                socket.getOutputStream().apply {
                    write("GET / HTTP/1.1\r\nHost: $host\r\nConnection: close\r\n\r\n".toByteArray())
                    flush()
                }
                val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                val out = StringBuilder()
                val buf = CharArray(1024)
                while (out.length < MAX_PROBE_CHARS) {
                    val remaining = MAX_PROBE_CHARS - out.length
                    val read = reader.read(buf, 0, minOf(buf.size, remaining))
                    if (read <= 0) break
                    out.append(buf, 0, read)
                    if (out.contains(MARKER)) return true
                }
                out.contains(MARKER)
            }
        } catch (_: Exception) {
            false
        }
    }

    // Scans the phone's own private Wi-Fi /24 for a companion server. Calls back
    // with the first match found, or null if nothing responded within the timeout.
    fun findCompanion(context: Context, onResult: (String?) -> Unit) {
        Thread({
            val wifi = ownWifiSubnet(context)
            if (wifi == null) {
                onResult(null)
                return@Thread
            }
            val executor = Executors.newFixedThreadPool(MAX_CONCURRENT)
            val found = AtomicReference<String?>(null)
            val latch = CountDownLatch(254)
            for (i in 1..254) {
                executor.submit {
                    try {
                        if (found.get() == null) {
                            val host = "${wifi.base}$i"
                            if (probe(wifi.network, host)) found.compareAndSet(null, host)
                        }
                    } catch (_: Exception) {
                        // best-effort; one host failing to probe shouldn't sink the scan
                    } finally {
                        latch.countDown()
                    }
                }
            }
            try {
                latch.await(SCAN_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            } catch (_: InterruptedException) {
                // fall through and report whatever was found before the interrupt
            }
            executor.shutdownNow()
            Log.i(TAG, "Subnet scan of ${wifi.base}0/24 finished: ${found.get() ?: "no match"}")
            onResult(found.get())
        }, "LightsOutSubnetScan").start()
    }
}
