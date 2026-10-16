package com.lightsout.companion

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Menu
import android.view.MenuItem
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.json.JSONArray

/**
 * Thin WebView wrapper around the Lights Out desktop companion page.
 *
 * The desktop app serves the companion over plain HTTP on the LAN
 * (http://PC-IP:58732/?t=TOKEN). A browser can't install that as a standalone
 * PWA because it isn't a secure context, but a native WebView is not subject to
 * that restriction — it simply loads the URL. The pairing token is persisted by
 * the companion page itself in localStorage (DOM storage is enabled below), so
 * after the first connect the saved URL works even without the token query.
 *
 * 5. **Connection and WebView Failsafes**:
 *   - **Successful Load Preference Protection**: The app now only persists the pairing URL in preferences on a successful load (`onPageFinished` with no errors), preventing broken URLs or offline hosts from corrupting the pairing configuration.
 *   - **Infinite Loop Cooldown**: Added a cooldown tracking registry (`failedConnections`). If a connection to a specific IP fails (due to firewalls, sleep modes, or network blocks), that IP is locked out from automatic reconnection attempts for 30 seconds to prevent battery drain and infinite reconnection loops. Clicking the card manually clears this cooldown.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var connecting: View
    private lateinit var connectingDetail: TextView
    private lateinit var setup: View
    private lateinit var urlInput: EditText
    private var lastRequestedUrl: String? = null
    private var mainFrameLoadFailed = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private val loadTimeout = Runnable {
        if (!mainFrameLoadFailed && connecting.visibility == View.VISIBLE) {
            handleLoadFailure(lastRequestedUrl, "Connection timed out")
        }
    }

    // Auto-discovery properties
    private var udpSocket: java.net.DatagramSocket? = null
    private var udpThread: Thread? = null
    @Volatile private var isListening = false

    private lateinit var autoDetectCard: View
    private lateinit var detectedPcName: TextView
    private lateinit var btnAutoConnect: Button
    private var lastDiscoveredIp: String? = null

    // Failsafe map tracking failed connection attempts per host IP with timestamp to prevent reconnect loops
    private val failedConnections = mutableMapOf<String, Long>()

    // Bounds subnet-scan-based reconnect attempts (see handleLoadFailure) to
    // one per cooldown window, so a wrong/revoked token -- which will keep
    // failing no matter which host answers -- can't turn into a busy loop.
    private var lastScanAttemptAt = 0L

    // Bumped on every user/system-driven navigation (showWeb, showSetup) and
    // on onPause. A subnet scan captures the current value before it starts;
    // if the value has moved on by the time the scan's async callback fires,
    // the scan result is stale -- either the user has since navigated away
    // manually (e.g. opened "Change PC / URL" while a scan from an earlier
    // failure was still running) or the Activity has backgrounded -- and
    // must not be allowed to yank the screen back or touch paused UI state.
    // SubnetScanner itself is untouched here (no early-exit for in-flight
    // probes) -- this guard only prevents the stale result from being acted
    // on once it arrives, which is the correctness bug; cutting the scan
    // short early is a separate efficiency concern for another pass.
    private var scanGeneration = 0

    private val prefs by lazy { getSharedPreferences("lightsout", MODE_PRIVATE) }

    // Scanner returns the pairing URL; persist it and connect.
    private val scanLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val url = CompanionUrlNormalizer.normalize(result.data?.getStringExtra(ScannerActivity.EXTRA_URL))
            if (url != null) {
                showWeb(url)
            } else {
                Toast.makeText(this, R.string.invalid_url, Toast.LENGTH_LONG).show()
            }
        }
    }

    private val cameraPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) launchScanner()
        else Toast.makeText(this, R.string.camera_needed, Toast.LENGTH_LONG).show()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        supportActionBar?.title = "PC controls"
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        webView = findViewById(R.id.webview)
        connecting = findViewById(R.id.connecting)
        connectingDetail = findViewById(R.id.connecting_detail)
        setup = findViewById(R.id.setup)
        urlInput = findViewById(R.id.url_input)
        val connectBtn = findViewById<Button>(R.id.connect_button)
        val scanBtn = findViewById<Button>(R.id.scan_button)
        findViewById<Button>(R.id.connecting_change_pc).setOnClickListener {
            showSetup(lastRequestedUrl ?: prefs.getString(KEY_URL, null))
        }

        // Auto-detect UI hooks
        autoDetectCard = findViewById(R.id.auto_detect_card)
        detectedPcName = findViewById(R.id.detected_pc_name)
        btnAutoConnect = findViewById(R.id.btn_auto_connect)

        btnAutoConnect.setOnClickListener {
            val ip = lastDiscoveredIp
            if (ip != null) {
                failedConnections.remove(ip) // Clear any failed state on manual user intent
                urlInput.setText("http://$ip:${CompanionUrlNormalizer.DEFAULT_PORT}")
                urlInput.requestFocus()
                urlInput.setSelection(urlInput.text?.length ?: 0)
                Toast.makeText(this, "PC IP pre-filled. Enter your pairing code.", Toast.LENGTH_SHORT).show()
                autoDetectCard.visibility = View.GONE
            }
        }

        scanBtn.setOnClickListener {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED
            ) {
                launchScanner()
            } else {
                cameraPermLauncher.launch(Manifest.permission.CAMERA)
            }
        }

        with(webView.settings) {
            javaScriptEnabled = true
            // The companion remembers its pairing token in localStorage.
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
        }
        // Allow inspecting the page from desktop Chrome via chrome://inspect over
        // (wireless) adb. Safe here: this is a single-purpose LAN control app.
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                mainFrameLoadFailed = false
                super.onPageStarted(view, url, favicon)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                mainHandler.removeCallbacks(loadTimeout)
                if (!mainFrameLoadFailed && url != null) {
                    lastRequestedUrl = url
                    // Failsafe: Only save to persistent preferences on successful load to prevent polluting with broken URLs
                    if (url.startsWith("http://") || url.startsWith("https://")) {
                        prefs.edit().putString(KEY_URL, url).apply()
                        // Remove from failed map on successful connection
                        val uri = try { java.net.URI(url) } catch (_: Exception) { null }
                        uri?.host?.let { failedConnections.remove(it) }
                    }
                    // Existing installs saved the pairing token only in the
                    // companion page's localStorage. Mirror it into native
                    // preferences after a successful load so those users also
                    // gain IP-change recovery without having to pair again.
                    capturePersistedPageToken(view, url)
                    showConnectedPage()
                }
                super.onPageFinished(view, url)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    handleLoadFailure(
                        request.url?.toString() ?: lastRequestedUrl,
                        error?.description?.toString()
                    )
                }
                super.onReceivedError(view, request, error)
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: WebResourceResponse?
            ) {
                if (request?.isForMainFrame == true && (errorResponse?.statusCode ?: 0) >= 400) {
                    handleLoadFailure(
                        request.url?.toString() ?: lastRequestedUrl,
                        "HTTP ${errorResponse?.statusCode}"
                    )
                }
                super.onReceivedHttpError(view, request, errorResponse)
            }

            override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
                handleLoadFailure(
                    lastRequestedUrl,
                    if (detail?.didCrash() == true) "WebView renderer crashed" else "WebView renderer exited"
                )
                return true
            }
        }
        // Forward page console output to logcat (tag "LightsOutWeb") so the
        // companion page can be debugged over adb without chrome://inspect.
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                Log.d("LightsOutWeb", "${msg.message()} @${msg.sourceId()}:${msg.lineNumber()}")
                return true
            }
        }

        connectBtn.setOnClickListener {
            val url = CompanionUrlNormalizer.normalize(urlInput.text?.toString())
            if (url == null) {
                Toast.makeText(this, R.string.invalid_url, Toast.LENGTH_LONG).show()
            } else {
                showWeb(url)
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.visibility == View.VISIBLE && webView.canGoBack()) {
                    webView.goBack()
                } else if (connecting.visibility == View.VISIBLE) {
                    showSetup(lastRequestedUrl ?: prefs.getString(KEY_URL, null))
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        val saved = prefs.getString(KEY_URL, null)
        if (saved != null) showWeb(saved) else showSetup(null)
    }

    private fun launchScanner() {
        scanLauncher.launch(Intent(this, ScannerActivity::class.java))
    }

    private fun showWeb(url: String) {
        mainHandler.removeCallbacks(loadTimeout)
        // This call supersedes any subnet scan kicked off by an earlier
        // failure -- whatever it finds is no longer relevant to what's about
        // to be shown. See scanGeneration / handleLoadFailure.
        scanGeneration++
        lastRequestedUrl = url
        mainFrameLoadFailed = false
        // Captured here, at the moment a URL is actually provided (QR scan,
        // manual paste, or an auto-reconnect), rather than read back out of
        // the WebView later -- companion.html strips `?t=` from the address
        // bar via history.replaceState almost immediately after load, so by
        // the time onPageFinished's callback reports a URL, the token is
        // already gone from it. See CompanionUrlNormalizer.extractToken.
        val host = CompanionUrlNormalizer.hostOf(url)
        val tokenInUrl = CompanionUrlNormalizer.extractToken(url)
        if (tokenInUrl != null) {
            prefs.edit().putString(KEY_TOKEN, tokenInUrl).putString(KEY_TOKEN_HOST, host).apply()
        } else if (CompanionUrlNormalizer.shouldInvalidateStaleToken(host, tokenInUrl, prefs.getString(KEY_TOKEN_HOST, null))) {
            // Token-less URL against a host the stored token wasn't captured
            // for (e.g. the bare-host auto-detect flow pairing to a second
            // PC) -- drop it so a later load failure doesn't scan-reconnect
            // this new pairing using a different PC's token.
            prefs.edit().remove(KEY_TOKEN).remove(KEY_TOKEN_HOST).apply()
        }
        showConnecting(R.string.connecting_detail)
        autoDetectCard.visibility = View.GONE
        webView.loadUrl(url)
        mainHandler.postDelayed(loadTimeout, MAIN_FRAME_TIMEOUT_MS)
    }

    private fun showSetup(prefill: String?) {
        mainHandler.removeCallbacks(loadTimeout)
        scanGeneration++ // see showWeb
        webView.visibility = View.GONE
        connecting.visibility = View.GONE
        setup.visibility = View.VISIBLE
        if (prefill != null) urlInput.setText(prefill)
    }

    private fun showConnecting(detailRes: Int) {
        webView.visibility = View.GONE
        setup.visibility = View.GONE
        connectingDetail.setText(detailRes)
        connecting.visibility = View.VISIBLE
    }

    private fun showConnectedPage() {
        connecting.visibility = View.GONE
        setup.visibility = View.GONE
        webView.visibility = View.VISIBLE
    }

    private fun capturePersistedPageToken(view: WebView?, pageUrl: String?) {
        view?.evaluateJavascript(
            "(function(){try{return localStorage.getItem('$PAGE_TOKEN_KEY')||''}catch(e){return ''}})()"
        ) { encodedValue ->
            val token = try {
                JSONArray("[$encodedValue]").optString(0).takeIf { it.isNotBlank() }
            } catch (_: Exception) {
                null
            }
            if (token != null) {
                // KEY_TOKEN_HOST must always describe whichever host KEY_TOKEN
                // was captured for, regardless of which of the two capture
                // paths (a token-bearing URL in showWeb, or this localStorage
                // mirror) actually wrote it -- otherwise shouldInvalidateStaleToken
                // would compare a fresh token against a stale/mismatched host.
                prefs.edit().putString(KEY_TOKEN, token).putString(KEY_TOKEN_HOST, CompanionUrlNormalizer.hostOf(pageUrl)).apply()
            }
        }
    }

    private fun handleLoadFailure(url: String?, detail: String?) {
        if (mainFrameLoadFailed) return
        mainFrameLoadFailed = true
        mainHandler.removeCallbacks(loadTimeout)
        Log.w("LightsOutApp", "Failed to load companion URL ${CompanionUrlNormalizer.redactForLog(url)}: ${detail ?: "unknown error"}")

        // Failsafe: add IP to failed connection registry to trigger cool-down
        val uri = try { url?.let { java.net.URI(it) } } catch (_: Exception) { null }
        val ip = uri?.host
        if (ip != null) {
            failedConnections[ip] = System.currentTimeMillis()
        }

        webView.stopLoading()

        // Most likely cause of a failed load on a previously-working pairing:
        // the desktop's LAN IP changed (observed in practice on a machine
        // with two Wi-Fi adapters on the same subnet). Try a unicast subnet
        // scan for the same token before giving up to the manual setup
        // screen -- but only once per cooldown window, so a genuinely wrong/
        // revoked token (which will keep failing no matter what host answers)
        // can't turn into a busy-loop of scans.
        val token = prefs.getString(KEY_TOKEN, null)
        val now = System.currentTimeMillis()
        if (token != null && now - lastScanAttemptAt > SCAN_COOLDOWN_MS) {
            lastScanAttemptAt = now
            // Keep a truthful, cancellable reconnect surface visible while
            // the bounded subnet recovery scan runs in the background.
            scanGeneration++
            showConnecting(R.string.reconnecting_detail)
            // Captured after entering the reconnect surface, so any later
            // user navigation invalidates this result.
            val myGeneration = scanGeneration
            Toast.makeText(this, R.string.reconnecting, Toast.LENGTH_SHORT).show()
            SubnetScanner.findCompanion(applicationContext) { foundHost ->
                runOnUiThread {
                    if (CompanionUrlNormalizer.isStaleScan(myGeneration, scanGeneration)) return@runOnUiThread
                    if (foundHost != null && foundHost != ip) {
                        Log.i("LightsOutApp", "Subnet scan found companion at $foundHost after $ip failed to load")
                        showWeb(CompanionUrlNormalizer.buildUrl(foundHost, token))
                    } else {
                        fallBackToSetup(url)
                    }
                }
            }
        } else {
            fallBackToSetup(url)
        }
    }

    private fun fallBackToSetup(url: String?) {
        showSetup(url ?: prefs.getString(KEY_URL, null))
        Toast.makeText(this, R.string.connection_failed, Toast.LENGTH_LONG).show()
    }

    override fun onResume() {
        super.onResume()
        startUdpDiscovery()
    }

    override fun onPause() {
        super.onPause()
        scanGeneration++ // a paused Activity's stale scan result must not act later
        stopUdpDiscovery()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(loadTimeout)
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }

    private fun startUdpDiscovery() {
        if (isListening) return
        isListening = true
        udpThread = Thread {
            val buffer = ByteArray(1024)
            while (isListening) {
                try {
                    val socket = udpSocket ?: java.net.DatagramSocket(58733).also { udpSocket = it }
                    socket.soTimeout = 3000
                    val packet = java.net.DatagramPacket(buffer, buffer.size)
                    socket.receive(packet)
                    val message = String(packet.data, 0, packet.length).trim()
                    if (message.startsWith("LIGHTSOUT_FAMILY_V1")) {
                        val parts = message.split("|")
                        if (parts.size >= 2) {
                            val pcName = parts[1]
                            val ip = packet.address?.hostAddress
                            if (ip != null) {
                                runOnUiThread {
                                    onPcDiscovered(pcName, ip)
                                }
                            }
                        }
                    }
                } catch (e: java.net.SocketTimeoutException) {
                    // socket timeout is expected, just loop
                } catch (e: Exception) {
                    Log.d("LightsOutApp", "UDP socket error or closed: ${e.message}")
                    try {
                        udpSocket?.close()
                    } catch (_: Exception) {}
                    udpSocket = null
                    if (isListening) {
                        try { Thread.sleep(2000) } catch (_: Exception) {}
                    }
                }
            }
        }.apply {
            name = "LightsOutUdpDiscovery"
            start()
        }
    }

    private fun stopUdpDiscovery() {
        isListening = false
        try {
            udpSocket?.close()
        } catch (_: Exception) {}
        udpSocket = null
        udpThread = null
    }

    private fun onPcDiscovered(pcName: String, ip: String) {
        if (!isListening) return
        lastDiscoveredIp = ip

        // Failsafe check: if this IP recently failed, enforce 30 seconds cool-down to prevent infinite reconnection loop
        val lastFail = failedConnections[ip] ?: 0L
        if (System.currentTimeMillis() - lastFail < 30000L) {
            return
        }

        // Auto-reconnect on IP change. Uses the token captured directly at
        // pairing time (see showWeb/KEY_TOKEN), not one re-parsed out of the
        // saved URL -- companion.html strips `?t=` from the address bar via
        // history.replaceState almost immediately after load, so by the time
        // a URL gets persisted to KEY_URL, the query string is already gone
        // and this reconnect could never actually fire.
        val token = prefs.getString(KEY_TOKEN, null)
        val saved = prefs.getString(KEY_URL, null)
        if (webView.visibility != View.VISIBLE && token != null && saved != null) {
            val savedHost = try { java.net.URI(saved).host } catch (_: Exception) { null }
            if (savedHost != null && savedHost != ip) {
                Log.i("LightsOutApp", "Auto-discovered PC IP changed from $savedHost to $ip. Attempting auto-reconnect.")
                showWeb(CompanionUrlNormalizer.buildUrl(ip, token))
                return
            }
        }

        if (setup.visibility == View.VISIBLE) {
            detectedPcName.text = pcName
            autoDetectCard.visibility = View.VISIBLE
        }
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == android.R.id.home) { finish(); return true }
        return if (item.itemId == R.id.action_change_pc) {
            showSetup(prefs.getString(KEY_URL, null))
            true
        } else {
            super.onOptionsItemSelected(item)
        }
    }

    companion object {
        private const val KEY_URL = "companion_url"
        private const val KEY_TOKEN = "companion_token"
        private const val KEY_TOKEN_HOST = "companion_token_host"
        private const val PAGE_TOKEN_KEY = "lightsout_pair_token"
        private const val SCAN_COOLDOWN_MS = 20_000L
        private const val MAIN_FRAME_TIMEOUT_MS = 8_000L
    }
}
