# Lights Out — Android Companion (WebView wrapper)

A thin native Android app that loads the Lights Out desktop **companion page** in a
WebView, so you get a real installed app icon on your phone instead of a browser
shortcut.

## Why a wrapper (and not a PWA / Play-Store TWA)

The desktop app serves the companion over **plain HTTP on your LAN**
(`http://PC-IP:58732/?t=TOKEN`). Browsers refuse to install that as a standalone
PWA — and a Trusted Web Activity (TWA) refuses to wrap it — because installability
requires a **secure context (HTTPS)**, which a rotating LAN IP can't provide. A
native WebView is not subject to that rule: it just loads the URL. The companion
page persists its pairing token in `localStorage`, which the WebView keeps
(DOM storage is enabled), so after the first connect you don't need the token again.

This app does **not** transmit anything off your LAN and stores only the companion
URL locally.

## Background notifications & reliability

The app is more than a WebView now. Alongside the page, a native **foreground
service** opens its own WebSocket to the companion server and mirrors the desktop
timer to your phone's notification shade — so you get alerts even when the app is
backgrounded or the screen is off:

- **Ongoing status** notification (low-priority) shows the live countdown, phase,
  and connection state, with **Snooze 5m** and **Cancel** action buttons that send
  commands straight to the desktop.
- **Heads-up alerts** (sound + vibration, configurable) fire on **Last Call** and
  when the timer **completes**; a quieter alert marks the **wind-down** phase.
- **Auto-reconnect** with exponential backoff (1s→30s) keeps the connection alive
  across Wi-Fi blips.

Reliability touches in the WebView itself: **pull-to-refresh**, and an
**"Can't reach your PC"** screen with a **Retry** button when the page fails to
load (instead of a blank WebView).

Tune behavior under **⋮ menu → Settings**:

- **Background notifications** — master switch for the service/notifications.
- **Loud alerts for Last Call** — heads-up + sound/vibration vs. silent.
- **Keep screen on** — hold the screen awake while the companion is open.

On Android 13+ the app requests the **POST_NOTIFICATIONS** permission on first
connect. The service uses a `dataSync` foreground type.

## Prerequisites

- **Android Studio** (Koala/2024.1+) — or a standalone JDK 17 + Android SDK with
  `cmdline-tools`.
- The desktop app running with **Remote Control enabled** (Settings → Remote
  Control). That's what starts the companion server and mints the pairing token.

## Build

### Option A — Android Studio (simplest)
1. **Open** the `companion-android/` folder as a project. Let Gradle sync (it
   downloads the matching Gradle/AGP automatically).
2. **Run** (▶) onto your device, or **Build → Build APK(s)**.

### Option B — command line
This scaffold ships without the Gradle wrapper JAR (a binary). Generate it once,
then build:

```bash
cd companion-android
gradle wrapper            # needs a local Gradle install; creates ./gradlew + jar
./gradlew assembleDebug   # on Windows: gradlew.bat assembleDebug
```

Point Gradle at your SDK if it isn't auto-detected — create `local.properties`:

```
sdk.dir=C:\\Users\\YOU\\AppData\\Local\\Android\\Sdk
```

The debug APK lands at:

```
app/build/outputs/apk/debug/app-debug.apk
```

## Release build (signed)

Signing is read from a gitignored `keystore.properties` at the `companion-android/`
root (see `app/build.gradle`). Without it, `assembleRelease` falls back to debug
signing so the project still builds for anyone who clones it.

Generate a keystore once, then point `keystore.properties` at it:

```bash
keytool -genkeypair -v -keystore lightsout-release.jks -alias lightsout \
  -keyalg RSA -keysize 2048 -validity 10000

# companion-android/keystore.properties  (gitignored — never commit)
# storeFile=lightsout-release.jks
# storePassword=…
# keyAlias=lightsout
# keyPassword=…

gradlew.bat assembleRelease
```

The signed APK lands at `app/build/outputs/apk/release/app-release.apk`. Because the
release and debug keys differ, uninstall any debug build before installing the
release one (`adb uninstall com.lightsout.companion`).

> `keystore.properties`, `*.jks`, and `*.keystore` are already in `.gitignore`.
> Keep your keystore + passwords backed up: losing them means you can't ship
> signed updates that overwrite an existing install.

## Install over wireless ADB

On the phone: **Developer options → Wireless debugging → on**. Then, from the PC:

```bash
# Android 11+ pairing (one time): use the "Pair device with pairing code" screen
adb pair PHONE-IP:PAIR-PORT          # enter the 6-digit code it shows
adb connect PHONE-IP:DEBUG-PORT      # the port under "Wireless debugging"

adb install -r app/build/outputs/apk/debug/app-debug.apk
```

(If you built in Android Studio with the device already connected via wireless
ADB, just hit Run and skip the manual install.)

## First run

1. Open **Lights Out** on the phone.
2. In the desktop app, enable **Remote Control** (it shows a pairing QR).
3. Tap **Scan QR code** and point the camera at it — the app pairs and connects
   automatically. (Or paste/type the `http://PC-IP:58732/?t=TOKEN` link and tap
   **Connect**.)
4. To repoint at a different PC later: **⋮ menu → Change PC / URL**.

QR scanning uses CameraX + on-device ML Kit barcode scanning (no network, no
Play Services dependency). Camera permission is requested on first scan.

> Note: ML Kit's bundled native libraries aren't 16 KB-page aligned, so on
> Android 15 a debuggable build shows a one-time "App Compatibility" warning. It
> is harmless on current devices and does not appear in release builds.

## Debugging

WebView contents debugging is enabled, so with the phone on wireless ADB you can
open desktop Chrome → `chrome://inspect` → **inspect** the WebView to see the
companion page's console, network, and WebSocket frames.

## Notes / limits

- Phone and PC must be on the **same Wi-Fi** (no cloud relay; won't work on
  cellular).
- Cleartext HTTP is allowed via `res/xml/network_security_config.xml` because the
  companion is LAN-only. If you later put the companion behind HTTPS, tighten that.
- `applicationId` is `com.lightsout.companion`; bump `versionCode`/`versionName` in
  `app/build.gradle` for updates.
