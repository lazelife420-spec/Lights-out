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
    private val handoffScanner=registerForActivityResult(ActivityResultContracts.StartActivityForResult()){ result ->
        val id=handoffScanRequest ?: return@registerForActivityResult;handoffScanRequest=null
        val link=result.data?.getStringExtra(ScannerActivity.EXTRA_URL)
        if(result.resultCode!=RESULT_OK||link==null)transferReply(id,null,"Scan cancelled. No device was enrolled.")
        else HandoffController.get(this).handle("open",JSONObject().put("link",link)){ reply -> handler.post { transferReply(id,reply) } }
    }
    private val handoffCamera=registerForActivityResult(ActivityResultContracts.RequestPermission()){ granted ->
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
            override fun onPageFinished(view: WebView, url: String) { refresh();showHandoffInvitation() }
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
        if(msg.optString("action")=="handoff"){
            val id=msg.optString("requestId");if(!id.matches(Regex("[a-zA-Z0-9-]{1,64}"))||msg.toString().length>16384)return
            val operation=msg.optString("operation")
            if(operation=="scan"){if(handoffScanRequest!=null){transferReply(id,null,"Finish the current scanner first.");return};handoffScanRequest=id;handoffCamera.launch(Manifest.permission.CAMERA)}
            else HandoffController.get(this).handle(operation,msg.optJSONObject("options") ?: JSONObject()){ reply -> handler.post { transferReply(id,reply) } }
            return
        }
        if(msg.optString("action").startsWith("routineFile")) { handleTransfer(msg);return }
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
    private fun transferReply(id: String, result: JSONObject?, error: String? = null) {
        val reply = JSONObject().put("ok",error == null).put("result",result ?: JSONObject.NULL).put("error",error ?: JSONObject.NULL)
        web.evaluateJavascript("window.phoneTransferReply?.(${JSONObject.quote(id)},$reply)",null)
    }
    override fun onNewIntent(intent:Intent){super.onNewIntent(intent);setIntent(intent);showHandoffInvitation()}
    private fun showHandoffInvitation(){
        val link=intent?.data?.toString() ?: return
        try {RoutineHandoff.parseInvitation(link)}catch(_:Exception){return}
        if(::web.isInitialized)web.evaluateJavascript("window.handoffUI?.prefill(${JSONObject.quote(link)});document.querySelector('[data-tab=routines]')?.click();document.getElementById('handoff-pairing').open=true;",null)
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
