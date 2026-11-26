package com.lightsout.companion

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.*
import android.provider.Settings
import android.view.ViewGroup
import android.webkit.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** Bundled offline UI. The native bridge is never installed in the remote PC WebView. */
class HomeActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private val handler = Handler(Looper.getMainLooper())
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refresh() }
    private var openRequest: String? = null
    private var saveRequest: Pair<String,String>? = null
    private var handoffScanRequest:String?=null
    private var pageReady = false
    private val handoffScanner=registerForActivityResult(ActivityResultContracts.StartActivityForResult()){ result ->
        if(!ReleaseGates.HANDOFF_PAIRING){handoffScanRequest=null;return@registerForActivityResult}
        val id=handoffScanRequest ?: return@registerForActivityResult;handoffScanRequest=null
        val link=result.data?.getStringExtra(ScannerActivity.EXTRA_URL)
        if(result.resultCode!=RESULT_OK||link==null)transferReply(id,null,"Scan cancelled. No device was enrolled.")
        else HandoffController.get(this).handle("open",JSONObject().put("link",link)){ reply -> handler.post { transferReply(id,reply) } }
    }
    private val handoffCamera=registerForActivityResult(ActivityResultContracts.RequestPermission()){ granted ->
        if(!ReleaseGates.HANDOFF_PAIRING){handoffScanRequest=null;return@registerForActivityResult}
        if(granted)handoffScanner.launch(Intent(this,ScannerActivity::class.java).putExtra(ScannerActivity.EXTRA_MODE,"routine-handoff"))
        else {val id=handoffScanRequest;handoffScanRequest=null;if(id!=null)transferReply(id,null,"Camera permission is needed to scan. You can paste the invitation instead.")}
    }
    private val openRoutineFile = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val id = openRequest ?: return@registerForActivityResult; openRequest = null
        try {
            if(uri == null) transferReply(id,JSONObject().put("cancelled",true)) else {
                val bytes = contentResolver.openInputStream(uri)?.use { input ->
                    val output = java.io.ByteArrayOutputStream();val buffer = ByteArray(4096)
                    while(true) { val n = input.read(buffer);if(n < 0)break;require(output.size()+n <= PortableRoutineChecks.MAX_BYTES) { "Choose a routine file up to 256 KiB." };output.write(buffer,0,n) };output.toByteArray()
                } ?: throw IllegalArgumentException("Could not open this routine file.")
                val text = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
                RoutineInterchange.parse(text);transferReply(id,JSONObject().put("text",text))
            }
        } catch(e: Exception) { transferReply(id,null, if(e is IllegalArgumentException) e.message else "Choose a valid UTF-8 routine JSON file.") }
    }
    private val saveRoutineFile = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val request = saveRequest ?: return@registerForActivityResult;saveRequest = null
        try {
            if(uri == null) transferReply(request.first,JSONObject().put("cancelled",true)) else {
                val bytes = request.second.toByteArray(Charsets.UTF_8)
                val descriptor = contentResolver.openFileDescriptor(uri,"rwt") ?: throw IllegalArgumentException("Could not write the selected routine file.")
                ParcelFileDescriptor.AutoCloseOutputStream(descriptor).use { output -> output.write(bytes);output.flush();output.fd.sync() }
                val verified = contentResolver.openInputStream(uri)?.use { input ->
                    val output = java.io.ByteArrayOutputStream();val buffer = ByteArray(4096)
                    while(true) { val n=input.read(buffer);if(n<0)break;require(output.size()+n <= bytes.size) { "Export verification failed." };output.write(buffer,0,n) };output.toByteArray()
                }
                check(verified != null && verified.contentEquals(bytes)) { "Export verification failed." }
                transferReply(request.first,JSONObject().put("saved",true))
            }
        } catch(_: Exception) { transferReply(request.first,null,"Could not save the routine file. Try another location.") }
    }
    private val poll = object : Runnable {
        override fun run() { refresh(); handler.postDelayed(this, 500) }
    }
    @SuppressLint("SetJavaScriptEnabled")
    private fun createBundledWebView(): WebView {
        pageReady = false
        val view = WebView(this)
        view.setBackgroundColor(0xff0d0e14.toInt())
        ViewCompat.setOnApplyWindowInsetsListener(view) { target, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            target.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.settings.allowFileAccess = false
        view.settings.allowContentAccess = false
        view.settings.javaScriptCanOpenWindowsAutomatically = false
        view.settings.setSupportMultipleWindows(false)
        val assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse? {
                return assets.shouldInterceptRequest(request.url) ?: WebResourceResponse("text/plain", "UTF-8", 403,
                    "Blocked", emptyMap(), "".byteInputStream())
            }
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean =
                request.url.host != "appassets.androidplatform.net" || request.url.scheme != "https"
            override fun onPageFinished(v: WebView, url: String) { pageReady = true; refresh(); showHandoffInvitation() }
            override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean {
                // Recover gracefully without letting Android terminate the app process.
                try {
                    (v.parent as? ViewGroup)?.removeView(v)
                    v.destroy()
                } catch (_: Exception) {}
                if (!isFinishing && !isDestroyed) {
                    web = createBundledWebView()
                    setContentView(web)
                    web.loadUrl("https://appassets.androidplatform.net/assets/phone/index.html")
                }
                return true
            }
        }
        WebViewCompat.addWebMessageListener(view, "phoneNative", setOf("https://appassets.androidplatform.net")) {
                _, message, origin, mainFrame, _ ->
            if (mainFrame && origin.toString() == "https://appassets.androidplatform.net") {
                try { handle(JSONObject(message.data ?: "{}")) }
                catch (e: IllegalArgumentException) { showError(e.message ?: "Check the timer duration.") }
                catch (_: Exception) { showError("Could not apply that change.") }
            }
        }
        return view
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.hide()
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            val text = android.widget.TextView(this)
            text.text = "Update Android System WebView to use Lights Out."
            setContentView(text)
            return
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web = createBundledWebView()
        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/assets/phone/index.html")
    }
    private fun handle(msg: JSONObject) {
        if(msg.optString("action")=="handoff"){
            val id=msg.optString("requestId");if(!id.matches(Regex("[a-zA-Z0-9-]{1,64}"))||msg.toString().length>16384)return
            if(!ReleaseGates.HANDOFF_PAIRING){transferReply(id,null,ReleaseGates.HANDOFF_UNAVAILABLE_MESSAGE);return}
            val operation=msg.optString("operation")
            if(operation=="scan"){if(handoffScanRequest!=null){transferReply(id,null,"Finish the current scanner first.");return};handoffScanRequest=id;handoffCamera.launch(Manifest.permission.CAMERA)}
            else HandoffController.get(this).handle(operation,msg.optJSONObject("options") ?: JSONObject()){ reply -> handler.post { transferReply(id,reply) } }
            return
        }
        if(msg.optString("action").startsWith("routineFile")) { handleTransfer(msg);return }
        if(msg.optString("action")=="lightExperience"){
            val id=msg.optString("requestId");if(!id.matches(Regex("[a-zA-Z0-9-]{1,64}")))return
            try{val result=when(msg.optString("operation")){
                "status"->PhoneLightExperience.publicConfig(this)
                "save"->PhoneLightExperience.save(this,msg.getJSONObject("settings"))
                "access"->{startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));PhoneLightExperience.publicConfig(this)}
                else->throw IllegalArgumentException("Unknown light mode operation.")
            };transferReply(id,result)}catch(e:Exception){transferReply(id,null,if(e is IllegalArgumentException||e is IllegalStateException)e.message else "Could not apply light settings.")};return
        }
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
            "saveLights", "saveRoutine", "deleteRoutine", "saveRule", "deleteRule", "saveFirstLight" -> {
                PhoneHomeStore.update(this, action, msg)
                PhoneHomeStore.event(this, "Saved on this phone.")
                refresh()
                web.evaluateJavascript("window.phoneHome?.saved(${JSONObject.quote(action)})", null)
                // The wake reminder is a notification: in reminder-only mode it is First
                // Light's only output, so ask once (like timer start) when it is enabled.
                if (action == "saveFirstLight" && msg.optJSONObject("firstLight")?.optBoolean("enabled", false) == true) {
                    askNotificationsOnce("askedFirstLightAlerts")
                }
            }
            "stopFirstLight" -> {
                // Stops the light ramp only; the wake reminder still fires at the wake time.
                val wasActive = PhoneFirstLight.stopSunriseByUser(this)
                if (wasActive) {
                    safeStartService(Intent(this, PhoneTimerService::class.java).setAction("firstLightStop"))
                }
                refresh()
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
                safeStartService(Intent(this, PhoneTimerService::class.java).setAction("startRoutine")
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
                safeStartService(Intent(this, PhoneTimerService::class.java)
                    .setAction(action).putExtra("seconds", seconds).putExtra("runId", state.runId))
                if (action == "start") askNotificationsOnce("askedAlerts")
                handler.postDelayed({ refresh() }, 150)
            }
        }
    }
    /** Asks for POST_NOTIFICATIONS at most once per [askedKey] on API 33+ when notifications are off. */
    private fun askNotificationsOnce(askedKey: String) {
        if (Build.VERSION.SDK_INT >= 33 &&
            !NotificationManagerCompat.from(this).areNotificationsEnabled() &&
            !getPreferences(MODE_PRIVATE).getBoolean(askedKey, false)) {
            getPreferences(MODE_PRIVATE).edit().putBoolean(askedKey, true).apply()
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    private fun safeStartService(intent: Intent) {
        try {
            startService(intent)
        } catch (_: Exception) {
            showError("Could not start the timer service right now. Try again.")
        }
    }
    private fun transferReply(id: String, result: JSONObject?, error: String? = null) {
        if (!::web.isInitialized) return
        val reply = JSONObject().put("ok",error == null).put("result",result ?: JSONObject.NULL).put("error",error ?: JSONObject.NULL)
        web.evaluateJavascript("window.phoneTransferReply?.(${JSONObject.quote(id)},$reply)",null)
    }
    override fun onNewIntent(intent:Intent){super.onNewIntent(intent);setIntent(intent);showHandoffInvitation()}
    private fun showHandoffInvitation(){
        if(!ReleaseGates.HANDOFF_PAIRING || !pageReady)return
        val link=intent?.data?.toString() ?: return
        try {RoutineHandoff.parseInvitation(link)}catch(_:Exception){return}
        // Clear consumed deep link so subsequent page reloads do not replay it.
        intent?.data = null
        if(::web.isInitialized)web.evaluateJavascript("window.handoffUI?.prefill(${JSONObject.quote(link)});document.querySelector('[data-tab=routines]')?.click();(()=>{const el=document.getElementById('handoff-pairing');if(el){el.hidden=false;el.open=true;}})();",null)
    }
    private fun handleTransfer(msg: JSONObject) {
        val id = msg.optString("requestId")
        if(!id.matches(Regex("[a-zA-Z0-9-]{1,64}"))) return
        try {
            val result = when(msg.getString("action")) {
                "routineFileList" -> RoutineInterchange.list(this)
                "routineFilePreview" -> RoutineInterchange.preview(this,msg.getString("text"))
                "routineFileImport" -> RoutineInterchange.importFile(this,msg.getString("text"),msg.getString("policy"))
                "routineFileAdopt" -> RoutineInterchange.adopt(this,msg.getJSONObject("options"))
                "routineFileDelete" -> RoutineInterchange.deleteDraft(this,msg.getString("id"))
                "routineFileOpen" -> {
                    require(openRequest == null && saveRequest == null) { "Finish the current file picker first." }
                    openRequest = id;openRoutineFile.launch(arrayOf("application/json","text/plain","application/octet-stream"));return
                }
                "routineFileExport" -> {
                    require(openRequest == null && saveRequest == null) { "Finish the current file picker first." }
                    val text = RoutineInterchange.export(this,msg.getJSONArray("selection")).toString(2)
                    saveRequest = id to text;saveRoutineFile.launch("lights-out-routines.json");return
                }
                else -> throw IllegalArgumentException("Unknown routine file operation.")
            }
            transferReply(id,result);refresh()
        } catch(e: Exception) { transferReply(id,null, if(e is IllegalArgumentException || e is IllegalStateException) e.message else "Could not apply this routine file. Check its format and values.") }
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
            .put("routineOutcomes", PhoneRoutineOutcomes.display(this))
            .put("firstLight", PhoneFirstLight.statusJson(this))
            .put("handoffPairing", ReleaseGates.HANDOFF_PAIRING)
            .put("paired", !getSharedPreferences("lightsout", MODE_PRIVATE).getString("companion_token", null).isNullOrBlank())
        web.evaluateJavascript("window.phoneUI?.update($j)", null)
    }
    override fun onResume() {
        super.onResume()
        val timer = PhoneTimerStore.restore(this)
        PhoneTimerStore.schedule(this, timer)
        PhoneCalendar.schedule(this)
        PhoneFirstLight.schedule(this)
        try { PhoneFirstLight.noteInterruptedRamp(this) } catch (_: Exception) {}
        if (timer.phase in listOf("running", "paused")) {
            safeStartService(Intent(this, PhoneTimerService::class.java))
        }
        handler.post(poll)
    }
    override fun onPause() { handler.removeCallbacks(poll); super.onPause() }
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); if (::web.isInitialized) web.destroy(); super.onDestroy() }
}
