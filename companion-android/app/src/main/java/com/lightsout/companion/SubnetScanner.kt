package com.lightsout.companion

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.NetworkCapabilities
import android.util.Log
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Unicast subnet scan used to recover from the desktop's LAN IP changing
 * between sessions (observed in practice: a machine with two Wi-Fi adapters
 * on the same subnet can advertise either one across restarts). UDP
 * broadcast discovery (see MainActivity.startUdpDiscovery) is the preferred
 * mechanism when it works, but many routers/mesh systems silently drop
 * broadcast traffic between wireless clients ("AP/client isolation") while
 * still routing normal unicast between them just fine -- confirmed against a
 * real network where a raw broadcast probe never arrived, while a direct
 * unicast WebSocket connection to a specific host worked immediately. This
 * scan is the unicast fallback: probe every host in the phone's own /24 for
 * a companion server, bounded to a few seconds by running probes
 * concurrently with a short per-host timeout.
 */
internal object SubnetScanner {
    private const val TAG = "LightsOutScan"
    private const val PROBE_TIMEOUT_MS = 400
    private const val MAX_CONCURRENT = 32
    private const val SCAN_TIMEOUT_SECONDS = 15L
    // The companion page's <title> -- see electron/companion.html. Confirms
    // whatever answered on this port is actually a Lights Out companion
    // server, not some unrelated device/service that happens to share the
    // port number.
    private const val MARKER = "Lights Out"

    // Returns the caller's own IPv4 /24 base ("192.168.0.") or null if it
    // can't be determined (no active network, no IPv4 address, etc.) --
    // callers should treat null as "scan not possible right now," not as an
    // error to surface to the user.
    @Suppress("DEPRECATION") // allNetworks: simplest synchronous way to enumerate candidates; no callback needed here
    private fun ownSubnetBase(context: Context): String? {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return null
            // Prefer a network with the Wi-Fi transport specifically. When a VPN or
            // "private DNS as VPN" profile (Google Fi, NextDNS, MDM, etc.) is active,
            // cm.activeNetwork commonly resolves to the VPN's tunnel interface, whose
            // subnet has nothing to do with the LAN the desktop is actually on -- that
            // would burn the whole scan budget probing the wrong /24 and never find it.
            val network = cm.allNetworks
                .firstOrNull { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true }
                ?: cm.activeNetwork
                ?: return null
            val props: LinkProperties = cm.getLinkProperties(network) ?: return null
            val ipv4 = props.linkAddresses
                .mapNotNull { it.address?.hostAddress }
                .firstOrNull { addr -> !addr.contains(':') && addr.count { it == '.' } == 3 }
                ?: return null
            val parts = ipv4.split(".")
            if (parts.size != 4) return null
            "${parts[0]}.${parts[1]}.${parts[2]}."
        } catch (_: Exception) {
            null
        }
    }

    // Probes a single host for a companion server via a raw HTTP GET,
    // checking the response for MARKER so an unrelated device with something
    // else listening on this port isn't mistaken for the desktop app.
    private fun probe(host: String): Boolean {
        return try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, CompanionUrlNormalizer.DEFAULT_PORT), PROBE_TIMEOUT_MS)
                socket.soTimeout = PROBE_TIMEOUT_MS
                socket.getOutputStream().apply {
                    write("GET / HTTP/1.1\r\nHost: $host\r\nConnection: close\r\n\r\n".toByteArray())
                    flush()
                }
                val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                val buf = CharArray(2048)
                val read = reader.read(buf)
                read > 0 && String(buf, 0, read).contains(MARKER)
            }
        } catch (_: Exception) {
            false
        }
    }

    // Scans the phone's own /24 for a companion server. Calls back with the
    // first match found, or null if nothing responded within the timeout.
    // Does its own threading internally -- safe to call from the UI thread,
    // but `onResult` fires on a background thread, not the caller's thread.
    fun findCompanion(context: Context, onResult: (String?) -> Unit) {
        Thread({
            val base = ownSubnetBase(context)
            if (base == null) {
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
                            val host = "$base$i"
                            if (probe(host)) found.compareAndSet(null, host)
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
            Log.i(TAG, "Subnet scan of ${base}0/24 finished: ${found.get() ?: "no match"}")
            onResult(found.get())
        }, "LightsOutSubnetScan").start()
    }
}
