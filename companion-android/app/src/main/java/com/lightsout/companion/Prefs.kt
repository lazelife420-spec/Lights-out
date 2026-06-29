package com.lightsout.companion

import android.content.Context

/**
 * Single source of truth for persisted settings. Wraps the same SharedPreferences
 * file MainActivity has always used ("lightsout") so the saved companion URL is
 * shared across the app, service, and settings screen.
 */
class Prefs(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    var companionUrl: String?
        get() = prefs.getString(KEY_URL, null)
        set(value) = prefs.edit().putString(KEY_URL, value).apply()

    /** Master switch for background notifications. */
    var notificationsEnabled: Boolean
        get() = prefs.getBoolean(KEY_NOTIFY, true)
        set(value) = prefs.edit().putBoolean(KEY_NOTIFY, value).apply()

    /** Heads-up + sound/vibration for Last Call and completion. */
    var headsUpAlerts: Boolean
        get() = prefs.getBoolean(KEY_HEADSUP, true)
        set(value) = prefs.edit().putBoolean(KEY_HEADSUP, value).apply()

    /** Keep the screen awake while the companion view is open. */
    var keepScreenOn: Boolean
        get() = prefs.getBoolean(KEY_KEEP_AWAKE, false)
        set(value) = prefs.edit().putBoolean(KEY_KEEP_AWAKE, value).apply()

    companion object {
        private const val NAME = "lightsout"
        private const val KEY_URL = "companion_url"
        private const val KEY_NOTIFY = "notifications_enabled"
        private const val KEY_HEADSUP = "headsup_alerts"
        private const val KEY_KEEP_AWAKE = "keep_screen_on"
    }
}
