package com.lightsout.companion

/** SharedPreferences changes memory before reporting a disk-write failure. */
object PhoneImportCommit {
    fun write(previous: String, next: String, commit: (String) -> Boolean) {
        if(commit(next)) return
        commit(previous) // restores cached authority even when storage stays unavailable
        throw IllegalStateException("Could not save imported routines. Previous settings are still active.")
    }
}
