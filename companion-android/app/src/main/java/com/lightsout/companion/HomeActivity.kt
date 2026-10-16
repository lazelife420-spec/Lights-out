package com.lightsout.companion

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.*
import android.provider.Settings
import android.webkit.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/** Bundled offline UI. The native bridge is never installed in the remote PC WebView. */
class HomeActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private val handler = Handler(Looper.getMainLooper())
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refresh() }
    private val poll = object : Runnable {
        override fun run() { refresh(); handler.postDelayed(this, 500) }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.hide()
        web = WebView(this)
        web.setBackgroundColor(0xff0d0e14.toInt())
        setContentView(web)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.setSupportMultipleWindows(false)
        val assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                return assets.shouldInterceptRequest(request.url) ?: WebResourceResponse("text/plain", "UTF-8", 403,
                    "Blocked", emptyMap(), "".byteInputStream())
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != "appassets.androidplatform.net" || request.url.scheme != "https"
            override fun onPageFinished(view: WebView, url: String) { refresh() }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "phoneNative", setOf("https://appassets.androidplatform.net")) {
                    _, message, origin, mainFrame, _ ->
                if (mainFrame && origin.toString() == "https://appassets.androidplatform.net") {
                    try { handle(JSONObject(message.data ?: "{}")) }
                    catch (e: IllegalArgumentException) { showError(e.message ?: "Check the timer duration.") }
                    catch (_: Exception) { showError("Could not apply that change.") }
                }
            }
        } else {
            web.destroy()
            val text = android.widget.TextView(this)
            text.text = "Update Android System WebView to use Lights Out."
            setContentView(text)
            return
        }
        web.loadUrl("https://appassets.androidplatform.net/assets/phone/index.html")
    }
    private fun handle(msg: JSONObject) {
        when (val action = msg.optString("action")) {
            "pc" -> startActivity(Intent(this, MainActivity::class.java))
            "alerts" -> {
                if (Build.VERSION.SDK_INT >= 33 && !NotificationManagerCompat.from(this).areNotificationsEnabled()) {
                    notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
                }
            }
            "exact" -> if (Build.VERSION.SDK_INT >= 31) {
                startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
            }
            "saveLights", "saveRoutine", "deleteRoutine", "saveRule", "deleteRule" -> {
                PhoneHomeStore.update(this, action, msg)
                PhoneHomeStore.event(this, "Saved on this phone.")
                refresh()
                web.evaluateJavascript("window.phoneHome?.saved(${JSONObject.quote(action)})", null)
            }
            "discoverLights" -> { PhoneHomeStore.event(this, "Looking for WiZ lights…"); PhoneLights.discover(this) }
            "lightCommand" -> {
                val targets = PhoneHomeStore.strings(msg.optJSONArray("targets"))
                require(targets.isNotEmpty() && targets.all { it in PhoneHomeStore.lights(this) }) { "Choose saved lights." }
                PhoneHomeStore.event(this, "Waiting for WiZ acknowledgement…")
                PhoneLights.perform(this, targets, msg.getString("command"), msg.optInt("brightness", 30))
            }
            "startRoutine" -> {
                PhoneTimerStore.finishIfDue(this)
                val profile = PhoneHomeStore.routines(this).find { it.id == msg.optString("id") }
                    ?: throw IllegalArgumentException("Choose a saved routine.")
                val state = PhoneTimerStore.read(this)
                state.command("start", profile.seconds, SystemClock.elapsedRealtime(), System.currentTimeMillis(), PhoneTimerStore.boot(this), "preview")
                startService(Intent(this, PhoneTimerService::class.java).setAction("startRoutine")
                    .putExtra("routineId", profile.id).putExtra("runId", state.runId))
            }
            "start", "pause", "resume", "snooze", "cancel" -> {
                PhoneTimerStore.finishIfDue(this)
                val state = PhoneTimerStore.read(this)
                val seconds = msg.optLong("seconds", 0)
                // Validate synchronously for useful UI errors; service checks again before committing.
                state.command(action, seconds, SystemClock.elapsedRealtime(), System.currentTimeMillis(), PhoneTimerStore.boot(this), "preview")
                // This command comes from a visible Activity. The service promotes
                // itself only if a timer remains active; cancel/finish need no FGS.
                startService(Intent(this, PhoneTimerService::class.java)
                    .setAction(action).putExtra("seconds", seconds).putExtra("runId", state.runId))
                if (action == "start" && Build.VERSION.SDK_INT >= 33 &&
                    !NotificationManagerCompat.from(this).areNotificationsEnabled() &&
                    !getPreferences(MODE_PRIVATE).getBoolean("askedAlerts", false)) {
                    getPreferences(MODE_PRIVATE).edit().putBoolean("askedAlerts", true).apply()
                    notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
                handler.postDelayed({ refresh() }, 150)
            }
        }
    }
    private fun showError(message: String) {
        web.evaluateJavascript("window.phoneUI?.error(${JSONObject.quote(message)})", null)
    }
    private fun refresh() {
        if (!::web.isInitialized) return
        PhoneTimerStore.finishIfDue(this)
        val t = PhoneTimerStore.read(this)
        val j = JSONObject().put("phase", t.phase).put("runId", t.runId)
            .put("remainingSeconds", (PhoneTimerStore.left(this, t) + 999) / 1000).put("totalSeconds", t.totalMs / 1000)
            .put("exact", PhoneTimerStore.exact(this))
            .put("alerts", NotificationManagerCompat.from(this).areNotificationsEnabled())
            .put("label", t.label).put("home", PhoneHomeStore.config(this))
            .put("event", PhoneHomeStore.event(this)).put("upcoming", PhoneCalendar.upcoming(this))
            .put("paired", !getSharedPreferences("lightsout", MODE_PRIVATE).getString("companion_token", null).isNullOrBlank())
        web.evaluateJavascript("window.phoneUI?.update($j)", null)
    }
    override fun onResume() {
        super.onResume()
        val timer = PhoneTimerStore.restore(this)
        PhoneTimerStore.schedule(this, timer)
        PhoneCalendar.schedule(this)
        if (timer.phase in listOf("running", "paused")) {
            startService(Intent(this, PhoneTimerService::class.java))
        }
        handler.post(poll)
    }
    override fun onPause() { handler.removeCallbacks(poll); super.onPause() }
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); web.destroy(); super.onDestroy() }
}
