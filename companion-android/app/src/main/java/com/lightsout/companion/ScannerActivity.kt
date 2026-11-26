package com.lightsout.companion

import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

/**
 * Full-screen camera that scans the desktop app's pairing QR and returns the
 * encoded companion URL (http://PC-IP:58732/?t=TOKEN) to MainActivity.
 *
 * The caller (MainActivity) is responsible for holding CAMERA permission before
 * launching this activity.
 */
class ScannerActivity : AppCompatActivity() {

    private val analysisExecutor = Executors.newSingleThreadExecutor()
    private var barcodeScanner: BarcodeScanner? = null
    @Volatile private var handled = false

    @ExperimentalGetImage
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_scanner)
        // Edge-to-edge (targetSdk 36): keep the bottom scan hint above the navigation bar.
        SystemBarInsets.contentRoot(this)?.let { SystemBarInsets.pad(it) }
        val requestedHandoff=intent.getStringExtra(EXTRA_MODE)=="routine-handoff"
        if(requestedHandoff && !ReleaseGates.HANDOFF_PAIRING){setResult(RESULT_CANCELED);finish();return}
        val routineHandoff=ReleaseGates.HANDOFF_PAIRING && requestedHandoff
        title = if(routineHandoff)"Scan routine pairing invitation" else getString(R.string.scan_title)
        if(routineHandoff)findViewById<android.widget.TextView>(R.id.scan_instruction).text="Scan the other device’s public routine-pairing invitation. This does not grant timer control."

        val previewView = findViewById<PreviewView>(R.id.preview)
        val scannerOptions = BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .build()
        val scanner = BarcodeScanning.getClient(scannerOptions).also { barcodeScanner = it }
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            if (isFinishing || isDestroyed) return@addListener
            try {
                val provider = providerFuture.get()
                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(analysisExecutor) { proxy ->
                    val media = proxy.image
                    if (media == null || handled) { proxy.close(); return@setAnalyzer }
                    try {
                        val image = InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees)
                        scanner.process(image)
                            .addOnSuccessListener { codes ->
                                val url = codes.asSequence()
                                    .mapNotNull { it.rawValue }
                                    .firstOrNull { if(routineHandoff)it.startsWith("lightsout-handoff://enroll/v1?") else it.startsWith("http://") || it.startsWith("https://") }
                                if (url != null && !handled) { handled = true; returnUrl(url) }
                            }
                            .addOnCompleteListener { proxy.close() }
                    } catch (_: Exception) {
                        proxy.close()
                    }
                }
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            } catch (e: Exception) {
                Toast.makeText(this, e.message ?: "Camera unavailable", Toast.LENGTH_LONG).show()
                finish()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun returnUrl(url: String) {
        runOnUiThread {
            setResult(RESULT_OK, intent.putExtra(EXTRA_URL, url))
            finish()
        }
    }

    override fun onDestroy() {
        try { barcodeScanner?.close() } catch (_: Exception) {}
        barcodeScanner = null
        analysisExecutor.shutdown()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_URL = "scanned_url"
        const val EXTRA_MODE = "scan_mode"
    }
}
