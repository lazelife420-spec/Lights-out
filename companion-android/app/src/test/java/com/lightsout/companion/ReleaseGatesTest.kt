package com.lightsout.companion

import org.junit.Assert.*
import org.junit.Test
import java.io.File

class ReleaseGatesTest {
    @Test fun handoffPairingIsGatedOffByDefault() {
        assertFalse(ReleaseGates.HANDOFF_PAIRING)
        assertTrue(ReleaseGates.HANDOFF_UNAVAILABLE_MESSAGE.isNotBlank())
    }

    @Test fun gatedOffBuildHidesHandoffUiAndOmitsDeepLink() {
        if (ReleaseGates.HANDOFF_PAIRING) return
        val manifest = File("src/main/AndroidManifest.xml")
        assertTrue("Expected AndroidManifest.xml in Gradle app test cwd", manifest.isFile)
        assertFalse(
            "Manifest must not register lightsout-handoff scheme while HANDOFF_PAIRING is false",
            manifest.readText().contains("""android:scheme="lightsout-handoff"""")
        )

        val indexHtml = File("src/main/assets/phone/index.html")
        assertTrue("Expected bundled phone index.html", indexHtml.isFile)
        assertTrue(
            "#handoff-pairing must start hidden in index.html",
            Regex("""<details\b[^>]*id="handoff-pairing"[^>]*\bhidden\b""").containsMatchIn(indexHtml.readText())
        )

        val homeJs = File("src/main/assets/phone/home.js")
        assertTrue("Expected bundled phone home.js", homeJs.isFile)
        val homeSrc = homeJs.readText()
        assertTrue("home.js must gate HandoffUI mount on state.handoffPairing === true", homeSrc.contains("syncHandoffGate(state.handoffPairing === true)"))
        assertTrue("home.js must initialize handoff gate closed", homeSrc.contains("syncHandoffGate(false)"))

        val homeActivity = File("src/main/java/com/lightsout/companion/HomeActivity.kt")
        assertTrue("Expected HomeActivity.kt", homeActivity.isFile)
        val activitySrc = homeActivity.readText()
        assertTrue("HomeActivity.refresh must publish handoffPairing gate", activitySrc.contains(""".put("handoffPairing", ReleaseGates.HANDOFF_PAIRING)"""))
        assertTrue(
            "HomeActivity.handle must refuse handoff calls when gated off",
            Regex("""if\s*\(\s*!ReleaseGates\.HANDOFF_PAIRING\s*\)\s*\{\s*transferReply\(id,\s*null,\s*ReleaseGates\.HANDOFF_UNAVAILABLE_MESSAGE\)""").containsMatchIn(activitySrc)
        )
        assertTrue(
            "HomeActivity.showHandoffInvitation must check ReleaseGates.HANDOFF_PAIRING",
            Regex("""fun showHandoffInvitation\(\)\s*\{\s*if\s*\(\s*!ReleaseGates\.HANDOFF_PAIRING""").containsMatchIn(activitySrc)
        )

        val scannerActivity = File("src/main/java/com/lightsout/companion/ScannerActivity.kt")
        assertTrue("Expected ScannerActivity.kt", scannerActivity.isFile)
        val scannerSrc = scannerActivity.readText()
        assertTrue(
            "ScannerActivity must gate routine-handoff mode behind ReleaseGates.HANDOFF_PAIRING",
            scannerSrc.contains("!ReleaseGates.HANDOFF_PAIRING") && scannerSrc.contains("ReleaseGates.HANDOFF_PAIRING && requestedHandoff")
        )
    }
}
