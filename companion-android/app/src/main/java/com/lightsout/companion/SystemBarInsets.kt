package com.lightsout.companion

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * targetSdk 36 is always edge-to-edge on Android 15+, so a window draws behind the
 * status bar, navigation bar and display cutout. This pads a layout root by exactly
 * the system-bar / cutout (and optionally IME, replacing adjustResize) insets that
 * actually reach it, on top of its own XML padding. Whatever the AppCompat decor
 * already consumed arrives here as zero, so it never double-pads; the applied part is
 * consumed so child views (e.g. a WebView) do not inset a second time.
 */
object SystemBarInsets {
    /** The root view of the layout passed to setContentView. */
    fun contentRoot(activity: Activity): View? =
        activity.findViewById<ViewGroup>(android.R.id.content)?.getChildAt(0)

    fun pad(root: View, includeIme: Boolean = false) {
        val baseLeft = root.paddingLeft
        val baseTop = root.paddingTop
        val baseRight = root.paddingRight
        val baseBottom = root.paddingBottom
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val bottom = if (includeIme) maxOf(bars.bottom, insets.getInsets(WindowInsetsCompat.Type.ime()).bottom) else bars.bottom
            view.setPadding(baseLeft + bars.left, baseTop + bars.top, baseRight + bars.right, baseBottom + bottom)
            insets.inset(bars.left, bars.top, bars.right, bottom)
        }
        ViewCompat.requestApplyInsets(root)
    }
}
