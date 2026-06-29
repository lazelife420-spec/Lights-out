package com.lightsout.companion

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat

/** Companion notification + behavior toggles, persisted via [Prefs]. */
class SettingsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        val prefs = Prefs(this)
        val notifications = findViewById<SwitchCompat>(R.id.switch_notifications)
        val headsUp = findViewById<SwitchCompat>(R.id.switch_headsup)
        val keepAwake = findViewById<SwitchCompat>(R.id.switch_keep_awake)

        notifications.isChecked = prefs.notificationsEnabled
        headsUp.isChecked = prefs.headsUpAlerts
        keepAwake.isChecked = prefs.keepScreenOn

        fun syncHeadsUpEnabled() { headsUp.isEnabled = notifications.isChecked }
        syncHeadsUpEnabled()

        notifications.setOnCheckedChangeListener { _, checked ->
            prefs.notificationsEnabled = checked
            syncHeadsUpEnabled()
        }
        headsUp.setOnCheckedChangeListener { _, checked -> prefs.headsUpAlerts = checked }
        keepAwake.setOnCheckedChangeListener { _, checked -> prefs.keepScreenOn = checked }
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }
}
