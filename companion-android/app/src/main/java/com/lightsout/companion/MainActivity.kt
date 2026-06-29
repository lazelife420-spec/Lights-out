package com.lightsout.companion

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import java.net.URL

/**
 * Thin WebView wrapper around the Lights Out desktop companion page.
 *
 * The desktop app serves the companion over plain HTTP on the LAN
 * (http://PC-IP:58732/?t=TOKEN). A browser can't install that as a standalone
 * PWA because it isn't a secure context, but a native WebView is not subject to
 * that restriction — it simply loads the URL. The pairing token is persisted by
 * the companion page itself in localStorage (DOM storage is enabled below), so
 * after the first connect the saved URL works even without the token query.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var swipe: SwipeRefreshLayout
    private lateinit var errorView: View
    private lateinit var setup: View
    private lateinit var urlInput: EditText

    private val prefs by lazy { getSharedPreferences("lightsout", MODE_PRIVATE) }
    private val prefsHelper by lazy { Prefs(this) }
    private var loadFailed = false

    private val notifyPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* Notifications are best-effort; the connection still works without them. */ }

    // Scanner returns the pairing URL; persist it and connect.
    private val scanLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val url = normalizeUrl(result.data?.getStringExtra(ScannerActivity.EXTRA_URL))
            if (url != null) {
                prefs.edit().putString(KEY_URL, url).apply()
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
        swipe = findViewById(R.id.swipe)
        errorView = findViewById(R.id.error_view)
        setup = findViewById(R.id.setup)
        urlInput = findViewById(R.id.url_input)
        val connectBtn = findViewById<Button>(R.id.connect_button)
        val scanBtn = findViewById<Button>(R.id.scan_button)
        val retryBtn = findViewById<Button>(R.id.retry_button)

        swipe.setColorSchemeColors(ContextCompat.getColor(this, R.color.accent))
        swipe.setOnRefreshListener { reload() }
        retryBtn.setOnClickListener { reload() }

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
        }
        // Allow inspecting the page from desktop Chrome via chrome://inspect over
        // (wireless) adb. Safe here: this is a single-purpose LAN control app.
        WebView.setWebContentsDebuggingEnabled(true)
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                loadFailed = false
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    loadFailed = true
                    showError()
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                swipe.isRefreshing = false
                if (!loadFailed) {
                    errorView.visibility = View.GONE
                    swipe.visibility = View.VISIBLE
                }
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
            val url = normalizeUrl(urlInput.text?.toString())
            if (url == null) {
                Toast.makeText(this, R.string.invalid_url, Toast.LENGTH_LONG).show()
            } else {
                prefs.edit().putString(KEY_URL, url).apply()
                showWeb(url)
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (swipe.visibility == View.VISIBLE && webView.canGoBack()) {
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
        setup.visibility = View.GONE
        errorView.visibility = View.GONE
        swipe.visibility = View.VISIBLE
        loadFailed = false
        webView.loadUrl(url)
        ensureNotificationPermission()
        CompanionService.start(this, url)
        applyKeepScreenOn()
    }

    private fun showSetup(prefill: String?) {
        swipe.visibility = View.GONE
        errorView.visibility = View.GONE
        setup.visibility = View.VISIBLE
        if (prefill != null) urlInput.setText(prefill)
        CompanionService.stop(this)
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun showError() {
        swipe.isRefreshing = false
        swipe.visibility = View.GONE
        errorView.visibility = View.VISIBLE
    }

    private fun reload() {
        val url = prefs.getString(KEY_URL, null)
        if (url == null) { showSetup(null); return }
        loadFailed = false
        errorView.visibility = View.GONE
        swipe.visibility = View.VISIBLE
        webView.loadUrl(url)
    }

    private fun applyKeepScreenOn() {
        if (prefsHelper.keepScreenOn) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (!prefsHelper.notificationsEnabled) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            notifyPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    override fun onResume() {
        super.onResume()
        if (swipe.visibility == View.VISIBLE) applyKeepScreenOn()
    }

    /**
     * Accepts a full link (as encoded in the desktop QR) or a bare host[:port].
     * Returns a normalized http(s) URL, or null if it can't be parsed.
     */
    private fun normalizeUrl(raw: String?): String? {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isEmpty()) return null
        val withScheme = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            trimmed
        } else {
            "http://$trimmed"
        }
        return try {
            val parsed = URL(withScheme)
            if (parsed.host.isNullOrEmpty()) null else withScheme
        } catch (e: Exception) {
            null
        }
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            R.id.action_change_pc -> {
                showSetup(prefs.getString(KEY_URL, null))
                true
            }
            R.id.action_settings -> {
                startActivity(Intent(this, SettingsActivity::class.java))
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    companion object {
        private const val KEY_URL = "companion_url"
    }
}
