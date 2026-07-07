package com.lightsout.companion

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Bundle
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
    private lateinit var setup: View
    private lateinit var urlInput: EditText
    private var lastRequestedUrl: String? = null
    private var mainFrameLoadFailed = false

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

        webView = findViewById(R.id.webview)
        setup = findViewById(R.id.setup)
        urlInput = findViewById(R.id.url_input)
        val connectBtn = findViewById<Button>(R.id.connect_button)
        val scanBtn = findViewById<Button>(R.id.scan_button)

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
        WebView.setWebContentsDebuggingEnabled(true)
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                mainFrameLoadFailed = false
                super.onPageStarted(view, url, favicon)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                if (!mainFrameLoadFailed && url != null) {
                    lastRequestedUrl = url
                    // Failsafe: Only save to persistent preferences on successful load to prevent polluting with broken URLs
                    if (url.startsWith("http://") || url.startsWith("https://")) {
                        prefs.edit().putString(KEY_URL, url).apply()
                        // Remove from failed map on successful connection
                        val uri = try { java.net.URI(url) } catch (_: Exception) { null }
                        uri?.host?.let { failedConnections.remove(it) }
                    }
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
        lastRequestedUrl = url
        mainFrameLoadFailed = false
        setup.visibility = View.GONE
        webView.visibility = View.VISIBLE
        autoDetectCard.visibility = View.GONE
        webView.loadUrl(url)
    }

    private fun showSetup(prefill: String?) {
        webView.visibility = View.GONE
        setup.visibility = View.VISIBLE
        if (prefill != null) urlInput.setText(prefill)
    }

    private fun handleLoadFailure(url: String?, detail: String?) {
        if (mainFrameLoadFailed) return
        mainFrameLoadFailed = true
        Log.w("LightsOutApp", "Failed to load companion URL ${url ?: "(unknown)"}: ${detail ?: "unknown error"}")

        // Failsafe: add IP to failed connection registry to trigger cool-down
        val uri = try { url?.let { java.net.URI(it) } } catch (_: Exception) { null }
        val ip = uri?.host
        if (ip != null) {
            failedConnections[ip] = System.currentTimeMillis()
        }

        webView.stopLoading()
        showSetup(url ?: prefs.getString(KEY_URL, null))
        Toast.makeText(this, R.string.connection_failed, Toast.LENGTH_LONG).show()
    }

    override fun onResume() {
        super.onResume()
        startUdpDiscovery()
    }

    override fun onPause() {
        super.onPause()
        stopUdpDiscovery()
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

        // Auto-reconnect on IP change
        val saved = prefs.getString(KEY_URL, null)
        if (webView.visibility != View.VISIBLE && saved != null) {
            val uri = try { java.net.URI(saved) } catch (_: Exception) { null }
            val query = uri?.rawQuery
            if (query != null && query.contains("t=")) {
                val tokenParam = query.split("&").firstOrNull { it.startsWith("t=") }
                if (tokenParam != null) {
                    val newUrl = "http://$ip:${CompanionUrlNormalizer.DEFAULT_PORT}/?$tokenParam"
                    if (uri.host != ip) {
                        Log.i("LightsOutApp", "Auto-discovered PC IP changed from ${uri.host} to $ip. Attempting auto-reconnect.")
                        showWeb(newUrl)
                        return
                    }
                }
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
        return if (item.itemId == R.id.action_change_pc) {
            showSetup(prefs.getString(KEY_URL, null))
            true
        } else {
            super.onOptionsItemSelected(item)
        }
    }

    companion object {
        private const val KEY_URL = "companion_url"
    }
}
