package com.lightsout.companion

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
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
    private lateinit var setup: View
    private lateinit var urlInput: EditText

    private val prefs by lazy { getSharedPreferences("lightsout", MODE_PRIVATE) }

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
        setup = findViewById(R.id.setup)
        urlInput = findViewById(R.id.url_input)
        val connectBtn = findViewById<Button>(R.id.connect_button)
        val scanBtn = findViewById<Button>(R.id.scan_button)

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
        webView.webViewClient = WebViewClient()
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
        setup.visibility = View.GONE
        webView.visibility = View.VISIBLE
        webView.loadUrl(url)
    }

    private fun showSetup(prefill: String?) {
        webView.visibility = View.GONE
        setup.visibility = View.VISIBLE
        if (prefill != null) urlInput.setText(prefill)
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
