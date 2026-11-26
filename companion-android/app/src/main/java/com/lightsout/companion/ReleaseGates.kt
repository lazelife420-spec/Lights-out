package com.lightsout.companion

/**
 * Release gates for features whose source ships in the tree but which are not
 * qualified for a public release.
 *
 * HANDOFF_PAIRING (LO-SDH-1 secured device routine pairing): the native
 * Android-to-Electron TLS handshake does not have a complete local PASS
 * (docs/SECURED_DEVICE_PAIRING_V1.md). Until it is qualified, the phone exposes
 * no pairing UI, no `lightsout-handoff://` deep link, and the native bridge
 * refuses every handoff operation. Flip this only in a release that carries
 * its own LO-SDH-1 qualification evidence (and restore the manifest
 * intent-filter at the same time).
 */
object ReleaseGates {
    const val HANDOFF_PAIRING = false
    const val HANDOFF_UNAVAILABLE_MESSAGE = "Secure routine pairing is not available in this release."
}
